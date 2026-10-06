import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import initSqlJs from 'sql.js'
import { P, diff } from '../src/dates.js'

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
  `)
  migrateCompany(db)
  return db
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
  return { jobs, months }
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
