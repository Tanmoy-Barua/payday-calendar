import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import initSqlJs from 'sql.js'
import { P, diff } from '../src/dates.js'
import { defaultBudgetNote } from '../src/checklist.js'

const require = createRequire(import.meta.url)
let sqlPromise

function sqlJs() {
  if (!sqlPromise) {
    const wasm = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
    sqlPromise = initSqlJs({ wasmBinary: wasm })
  }
  return sqlPromise
}

function wrap(raw, file) {
  let depth = 0
  function persist() {
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, Buffer.from(raw.export()))
    fs.renameSync(tmp, file)
  }
  return {
    exec(sql) {
      const text = String(sql).trim()
      raw.exec(sql)
      if (/^BEGIN\b/i.test(text)) depth += 1
      else if (/^COMMIT\b/i.test(text) || /^END\b/i.test(text)) {
        depth = Math.max(0, depth - 1)
        if (depth === 0) persist()
      } else if (/^ROLLBACK\b/i.test(text)) depth = Math.max(0, depth - 1)
      else if (depth === 0) persist()
    },
    prepare(sql) {
      return {
        all(...params) {
          const stmt = raw.prepare(sql)
          if (params.length) stmt.bind(params)
          const rows = []
          while (stmt.step()) rows.push(stmt.getAsObject())
          stmt.free()
          return rows
        },
        get(...params) {
          return this.all(...params)[0]
        },
        run(...params) {
          if (params.length) raw.run(sql, params)
          else raw.run(sql)
          if (depth === 0) persist()
        },
      }
    },
  }
}

const FREQS = new Set(['weekly', 'biweekly', 'biweeklyThu', 'semimonthly', 'monthly'])

export async function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const SQL = await sqlJs()
  const raw = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database()
  const db = wrap(raw, file)
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      freq TEXT NOT NULL,
      anchor TEXT NOT NULL,
      week_end TEXT NOT NULL DEFAULT 'sun',
      lag INTEGER NOT NULL DEFAULT 0,
      rate REAL,
      color INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      job_id TEXT NOT NULL,
      hours REAL NOT NULL,
      amount REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entries_day ON entries(day);
    CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      total REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      opened TEXT NOT NULL,
      payment REAL,
      every_days INTEGER NOT NULL DEFAULT 14,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS debt_payments (
      id TEXT PRIMARY KEY,
      debt_id TEXT NOT NULL,
      day TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS debt_payments_debt ON debt_payments(debt_id);
  `)
  migrateCompany(db)
  ensureDebtColumns(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      pin_hash TEXT,
      cred_id TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      expires REAL NOT NULL
    );
  `)
  if (!db.prepare('SELECT id FROM app_lock WHERE id = 1').get()) {
    db.prepare('INSERT INTO app_lock (id, enabled) VALUES (1, 0)').run()
  }
  ensureBudgetTables(db)
  return db
}

function ensureBudgetTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS budget_notes (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      title TEXT NOT NULL DEFAULT 'Budget Note',
      starting REAL NOT NULL DEFAULT 2200,
      paycheck_date TEXT NOT NULL DEFAULT '',
      paycheck_label TEXT NOT NULL DEFAULT '',
      job_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS budget_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      amount REAL,
      paid INTEGER NOT NULL DEFAULT 0,
      separate INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'other',
      debt_id TEXT NOT NULL DEFAULT '',
      debt_payment_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS budget_history (
      id TEXT PRIMARY KEY,
      paycheck_date TEXT NOT NULL DEFAULT '',
      paycheck_label TEXT NOT NULL DEFAULT '',
      job_id TEXT NOT NULL DEFAULT '',
      starting REAL NOT NULL,
      remaining REAL NOT NULL,
      closed_at TEXT NOT NULL,
      items_json TEXT NOT NULL,
      paid_json TEXT NOT NULL DEFAULT '[]'
    );
  `)
  const cols = db.prepare('PRAGMA table_info(budget_notes)').all().map(row => row.name)
  if (!cols.includes('paycheck_date')) db.exec(`ALTER TABLE budget_notes ADD COLUMN paycheck_date TEXT NOT NULL DEFAULT ''`)
  if (!cols.includes('paycheck_label')) db.exec(`ALTER TABLE budget_notes ADD COLUMN paycheck_label TEXT NOT NULL DEFAULT ''`)
  if (!cols.includes('job_id')) db.exec(`ALTER TABLE budget_notes ADD COLUMN job_id TEXT NOT NULL DEFAULT ''`)
  const itemCols = db.prepare('PRAGMA table_info(budget_items)').all().map(row => row.name)
  if (!itemCols.includes('category')) db.exec(`ALTER TABLE budget_items ADD COLUMN category TEXT NOT NULL DEFAULT 'other'`)
  if (!itemCols.includes('debt_id')) db.exec(`ALTER TABLE budget_items ADD COLUMN debt_id TEXT NOT NULL DEFAULT ''`)
  if (!itemCols.includes('debt_payment_id')) db.exec(`ALTER TABLE budget_items ADD COLUMN debt_payment_id TEXT NOT NULL DEFAULT ''`)
}

function ensureDebtColumns(db) {
  const cols = db.prepare('PRAGMA table_info(debts)').all().map(row => row.name)
  if (!cols.includes('payment')) db.exec('ALTER TABLE debts ADD COLUMN payment REAL')
  if (!cols.includes('every_days')) db.exec('ALTER TABLE debts ADD COLUMN every_days INTEGER NOT NULL DEFAULT 14')
}

function onCompanyThursdays(anchor) {
  if (!anchor) return false
  return P(anchor).getUTCDay() === 4 && Math.abs(diff('2026-10-01', anchor)) % 14 === 0
}

function migrateCompany(db) {
  const jobs = db.prepare('SELECT id, freq, anchor, lag FROM jobs').all()
  const update = db.prepare(`UPDATE jobs SET freq = 'biweeklyThu', anchor = '2026-10-01', week_end = 'sun', lag = 0 WHERE id = ?`)
  for (const j of jobs) {
    if (j.freq === 'biweekly' && !(Number(j.lag) > 0) && onCompanyThursdays(j.anchor)) update.run(j.id)
  }
}

export function companySchedule() {
  return { id: 'company', name: 'My company', freq: 'biweeklyThu', anchor: '2026-10-01', weekEnd: 'sun', lag: 0, rate: '', color: 0 }
}

function seedIfEmpty(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM jobs').get()
  if (row.n > 0) return
  saveJobs(db, [companySchedule()])
}

function jobFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    freq: row.freq,
    anchor: row.anchor,
    weekEnd: row.week_end === 'sat' ? 'sat' : 'sun',
    lag: Number(row.lag) || 0,
    rate: row.rate == null ? '' : row.rate,
    color: Number(row.color) || 0,
  }
}

function money2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function debtFromRow(row, payments) {
  const paid = money2(payments.reduce((sum, p) => sum + p.amount, 0))
  const total = money2(row.total)
  const payment = row.payment == null || row.payment === '' ? '' : money2(row.payment)
  const everyDays = Math.max(1, Number(row.every_days) || 14)
  return {
    id: row.id,
    name: row.name,
    total,
    note: row.note || '',
    opened: row.opened,
    payment,
    everyDays,
    paid,
    remaining: money2(Math.max(0, total - paid)),
    payments,
  }
}

export function getState(db) {
  seedIfEmpty(db)
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY position ASC, name ASC').all().map(jobFromRow)
  const rows = db.prepare('SELECT id, day, job_id, hours, amount FROM entries ORDER BY day ASC').all()
  const months = {}
  for (const row of rows) {
    const mk = row.day.slice(0, 7)
    const month = months[mk] || (months[mk] = { days: {} })
    const list = month.days[row.day] || (month.days[row.day] = [])
    list.push({ id: row.id, job: row.job_id, hours: row.hours, amount: row.amount })
  }
  const payRows = db.prepare('SELECT id, debt_id, day, amount, note FROM debt_payments ORDER BY day ASC, id ASC').all()
  const paymentsByDebt = {}
  for (const row of payRows) {
    const list = paymentsByDebt[row.debt_id] || (paymentsByDebt[row.debt_id] = [])
    list.push({ id: row.id, day: row.day, amount: money2(row.amount), note: row.note || '' })
  }
  const debts = db.prepare('SELECT * FROM debts ORDER BY position ASC, name ASC').all()
    .map(row => debtFromRow(row, paymentsByDebt[row.id] || []))
  return { jobs, months, debts, budget: getBudget(db) }
}

function budgetItemFromRow(row) {
  const category = row.category === 'debt' && !row.separate ? 'debt' : 'other'
  return {
    id: row.id,
    name: row.name || '',
    amount: row.amount == null ? '' : money2(row.amount),
    paid: !!row.paid,
    separate: !!row.separate,
    category,
    debtId: category === 'debt' ? (row.debt_id || '') : '',
    debtPaymentId: row.debt_payment_id || '',
  }
}

function historyFromRow(row) {
  let items = []
  let paid = []
  try { items = JSON.parse(row.items_json || '[]') } catch { items = [] }
  try { paid = JSON.parse(row.paid_json || '[]') } catch { paid = [] }
  return {
    id: row.id,
    paycheckDate: row.paycheck_date || '',
    paycheckLabel: row.paycheck_label || '',
    jobId: row.job_id || '',
    starting: money2(row.starting),
    remaining: money2(row.remaining),
    closedAt: row.closed_at || '',
    items: Array.isArray(items) ? items : [],
    paid: Array.isArray(paid) ? paid : [],
  }
}

export function getBudget(db) {
  ensureBudgetTables(db)
  const note = db.prepare('SELECT * FROM budget_notes WHERE id = 1').get()
  const count = db.prepare('SELECT COUNT(*) AS n FROM budget_items').get()
  if (!note || !count?.n) {
    const seeded = defaultBudgetNote()
    saveBudget(db, seeded)
    return seeded
  }
  const items = db.prepare('SELECT * FROM budget_items ORDER BY separate ASC, position ASC, id ASC').all()
    .map(budgetItemFromRow)
  const history = db.prepare('SELECT * FROM budget_history ORDER BY closed_at DESC, id DESC').all()
    .map(historyFromRow)
  return {
    title: note.title || 'Budget Note',
    starting: money2(note.starting),
    paycheckDate: note.paycheck_date || '',
    paycheckLabel: note.paycheck_label || '',
    jobId: note.job_id || '',
    items,
    history,
  }
}

function cleanBudgetItem(item, position) {
  const raw = item?.amount
  const amount = raw === '' || raw == null || Number.isNaN(Number(raw))
    ? null
    : money2(Math.max(0, Number(raw)))
  const separate = item?.separate ? 1 : 0
  const category = !separate && item?.category === 'debt' ? 'debt' : 'other'
  return {
    id: String(item?.id || '').slice(0, 40) || `item-${position}`,
    name: String(item?.name || '').trim().slice(0, 60),
    amount,
    paid: item?.paid ? 1 : 0,
    separate,
    position,
    category,
    debtId: category === 'debt' ? String(item?.debtId || '').slice(0, 40) : '',
    debtPaymentId: String(item?.debtPaymentId || '').slice(0, 40),
  }
}

function cleanHistoryEntry(entry) {
  const id = String(entry?.id || '').slice(0, 40) || newItemIdSafe()
  const closedAt = /^\d{4}-\d{2}-\d{2}$/.test(entry?.closedAt || '') ? entry.closedAt : '2026-10-01'
  const paycheckDate = /^\d{4}-\d{2}-\d{2}$/.test(entry?.paycheckDate || '') ? entry.paycheckDate : closedAt
  return {
    id,
    paycheckDate,
    paycheckLabel: String(entry?.paycheckLabel || 'Paycheck').trim().slice(0, 120) || 'Paycheck',
    jobId: String(entry?.jobId || '').slice(0, 40),
    starting: money2(Math.max(0, Number(entry?.starting) || 0)),
    remaining: money2(Number(entry?.remaining) || 0),
    closedAt,
    itemsJson: JSON.stringify(Array.isArray(entry?.items) ? entry.items : []),
    paidJson: JSON.stringify(Array.isArray(entry?.paid) ? entry.paid : []),
  }
}

function newItemIdSafe() {
  return `hist-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function saveBudget(db, budget) {
  ensureBudgetTables(db)
  const title = String(budget?.title || 'Budget Note').trim().slice(0, 60) || 'Budget Note'
  const startingRaw = budget?.starting
  const starting = startingRaw === '' || startingRaw == null || Number.isNaN(Number(startingRaw))
    ? 2200
    : money2(Math.max(0, Number(startingRaw)))
  const paycheckDate = /^\d{4}-\d{2}-\d{2}$/.test(budget?.paycheckDate || '') ? budget.paycheckDate : ''
  const paycheckLabel = String(budget?.paycheckLabel || '').trim().slice(0, 120)
  const jobId = String(budget?.jobId || '').slice(0, 40)
  const list = Array.isArray(budget?.items) ? budget.items : []
  const history = Array.isArray(budget?.history) ? budget.history : []
  const insert = db.prepare(`
    INSERT INTO budget_items (id, name, amount, paid, separate, position, category, debt_id, debt_payment_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertHistory = db.prepare(`
    INSERT INTO budget_history
      (id, paycheck_date, paycheck_label, job_id, starting, remaining, closed_at, items_json, paid_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM budget_notes')
    db.prepare(`
      INSERT INTO budget_notes (id, title, starting, paycheck_date, paycheck_label, job_id)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(title, starting, paycheckDate, paycheckLabel, jobId)
    db.exec('DELETE FROM budget_items')
    const seen = new Set()
    list.forEach((item, i) => {
      const row = cleanBudgetItem(item, i)
      if (seen.has(row.id)) return
      seen.add(row.id)
      insert.run(
        row.id,
        row.name,
        row.amount,
        row.paid,
        row.separate,
        row.position,
        row.category,
        row.debtId,
        row.debtPaymentId,
      )
    })
    db.exec('DELETE FROM budget_history')
    const seenHist = new Set()
    history.forEach(entry => {
      const row = cleanHistoryEntry(entry)
      if (seenHist.has(row.id)) return
      seenHist.add(row.id)
      insertHistory.run(
        row.id,
        row.paycheckDate,
        row.paycheckLabel,
        row.jobId,
        row.starting,
        row.remaining,
        row.closedAt,
        row.itemsJson,
        row.paidJson,
      )
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function cleanJob(job, position) {
  const freq = FREQS.has(job.freq) ? job.freq : 'biweeklyThu'
  const rate = job.rate === '' || job.rate == null || Number.isNaN(Number(job.rate)) ? null : Number(job.rate)
  return {
    id: String(job.id || '').slice(0, 40) || 'job',
    name: String(job.name || 'My job').trim().slice(0, 40) || 'My job',
    freq,
    anchor: /^\d{4}-\d{2}-\d{2}$/.test(job.anchor || '') ? job.anchor : '2026-10-01',
    weekEnd: job.weekEnd === 'sat' ? 'sat' : 'sun',
    lag: Math.max(0, Math.min(30, parseInt(job.lag, 10) || 0)),
    rate,
    color: Math.max(0, Math.min(5, Number(job.color) || 0)),
    position,
  }
}

export function saveJobs(db, jobs) {
  const list = Array.isArray(jobs) ? jobs : []
  const insert = db.prepare(`
    INSERT INTO jobs (id, name, freq, anchor, week_end, lag, rate, color, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM jobs')
    const seen = new Set()
    list.forEach((job, i) => {
      const row = cleanJob(job, i)
      if (seen.has(row.id)) return
      seen.add(row.id)
      insert.run(row.id, row.name, row.freq, row.anchor, row.weekEnd, row.lag, row.rate, row.color, row.position)
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function saveMonth(db, ym, days) {
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('bad month')
  const insert = db.prepare('INSERT INTO entries (id, day, job_id, hours, amount) VALUES (?, ?, ?, ?, ?)')
  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM entries WHERE day >= ? AND day < ?`).run(ym + '-01', nextMonth(ym) + '-01')
    const seen = new Set()
    for (const day of Object.keys(days || {})) {
      if (!day.startsWith(ym + '-')) continue
      for (const entry of days[day] || []) {
        const id = String(entry.id || '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        insert.run(id, day, String(entry.job || ''), Number(entry.hours) || 0, Math.round((Number(entry.amount) || 0) * 100) / 100)
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function nextMonth(ym) {
  let [y, m] = ym.split('-').map(Number)
  m += 1
  if (m > 12) { m = 1; y += 1 }
  return `${y}-${String(m).padStart(2, '0')}`
}

function cleanDebt(debt, position) {
  const opened = /^\d{4}-\d{2}-\d{2}$/.test(debt.opened || '') ? debt.opened : '2026-10-01'
  const rawPay = debt.payment
  const payment = rawPay === '' || rawPay == null || Number.isNaN(Number(rawPay))
    ? null
    : money2(Math.max(0, Number(rawPay)))
  const everyDays = [7, 14, 30].includes(Number(debt.everyDays))
    ? Number(debt.everyDays)
    : 14
  return {
    id: String(debt.id || '').slice(0, 40) || 'debt',
    name: String(debt.name || 'Debt').trim().slice(0, 60) || 'Debt',
    total: money2(Math.max(0, Number(debt.total) || 0)),
    note: String(debt.note || '').trim().slice(0, 200),
    opened,
    payment,
    everyDays,
    position,
    payments: Array.isArray(debt.payments) ? debt.payments : [],
  }
}

function cleanPayment(payment, debtId) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(payment.day || '') ? payment.day : null
  const id = String(payment.id || '')
  if (!id || !day) return null
  return {
    id: id.slice(0, 40),
    debtId,
    day,
    amount: money2(Math.max(0, Number(payment.amount) || 0)),
    note: String(payment.note || '').trim().slice(0, 200),
  }
}

export function saveDebts(db, debts) {
  const list = Array.isArray(debts) ? debts : []
  const insertDebt = db.prepare(`
    INSERT INTO debts (id, name, total, note, opened, payment, every_days, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertPay = db.prepare(`
    INSERT INTO debt_payments (id, debt_id, day, amount, note)
    VALUES (?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM debt_payments')
    db.exec('DELETE FROM debts')
    const seenDebts = new Set()
    const seenPays = new Set()
    list.forEach((debt, i) => {
      const row = cleanDebt(debt, i)
      if (seenDebts.has(row.id)) return
      seenDebts.add(row.id)
      insertDebt.run(row.id, row.name, row.total, row.note, row.opened, row.payment, row.everyDays, row.position)
      for (const payment of row.payments) {
        const pay = cleanPayment(payment, row.id)
        if (!pay || seenPays.has(pay.id)) continue
        seenPays.add(pay.id)
        insertPay.run(pay.id, pay.debtId, pay.day, pay.amount, pay.note)
      }
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
