import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { openDb, getState, saveJobs, saveMonth, saveDebts, saveBudget } from './db.js'

test('sqlite stores schedules and month entries', async () => {
  const file = path.join(os.tmpdir(), `payday-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = await openDb(file)
  const seeded = getState(db)
  assert.equal(seeded.jobs.length, 1)
  assert.equal(seeded.jobs[0].id, 'company')
  assert.equal(seeded.jobs[0].freq, 'biweeklyThu')
  assert.equal(seeded.jobs[0].anchor, '2026-10-01')
  assert.deepEqual(seeded.debts, [])

  saveMonth(db, '2026-10', {
    '2026-10-06': [{ id: 'e1', job: 'company', hours: 8, amount: 147.52 }],
  })
  saveJobs(db, [
    seeded.jobs[0],
    { id: 'weekend', name: 'Weekend', freq: 'weekly', anchor: '2026-10-02', weekEnd: 'sun', lag: 0, rate: 20, color: 1 },
  ])

  const again = await openDb(file)
  const state = getState(again)
  assert.equal(state.jobs[1].name, 'Weekend')
  assert.equal(state.jobs[1].rate, 20)
  assert.equal(state.months['2026-10'].days['2026-10-06'][0].amount, 147.52)

  saveMonth(again, '2026-10', {})
  const cleared = getState(again)
  assert.equal(cleared.months['2026-10'], undefined)
  fs.rmSync(file, { force: true })
  fs.rmSync(file + '-wal', { force: true })
  fs.rmSync(file + '-shm', { force: true })
})

test('sqlite stores debts and payment notes', async () => {
  const file = path.join(os.tmpdir(), `payday-debt-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = await openDb(file)
  saveDebts(db, [{
    id: 'car',
    name: 'Car loan',
    total: 1200,
    note: 'Monthly payment',
    opened: '2026-10-01',
    payment: 200,
    everyDays: 14,
    payments: [
      { id: 'p1', day: '2026-10-06', amount: 200, note: 'First payment' },
      { id: 'p2', day: '2026-10-15', amount: 150, note: '' },
    ],
  }])

  const again = await openDb(file)
  const state = getState(again)
  assert.equal(state.debts.length, 1)
  assert.equal(state.debts[0].name, 'Car loan')
  assert.equal(state.debts[0].total, 1200)
  assert.equal(state.debts[0].payment, 200)
  assert.equal(state.debts[0].everyDays, 14)
  assert.equal(state.debts[0].paid, 350)
  assert.equal(state.debts[0].remaining, 850)
  assert.equal(state.debts[0].payments[0].note, 'First payment')
  assert.equal(state.debts[0].payments[1].amount, 150)

  saveDebts(again, [])
  assert.deepEqual(getState(again).debts, [])
  fs.rmSync(file, { force: true })
})

test('sqlite stores budget checklist paid state', async () => {
  const file = path.join(os.tmpdir(), `payday-budget-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = await openDb(file)
  const seeded = getState(db).budget
  assert.equal(seeded.starting, 2200)
  assert.equal(seeded.items.filter(item => !item.separate).length, 8)
  assert.equal(seeded.items.find(item => item.name === 'Prime')?.amount, 50)

  const next = {
    ...seeded,
    paycheckDate: '2026-10-15',
    paycheckLabel: 'APS-SECURITY COMPANY · Thursday, October 15, 2026',
    jobId: 'company',
    items: seeded.items.map((item, i) => (i === 0 ? { ...item, paid: true, name: 'Rent' } : item)),
    history: [{
      id: 'hist-1',
      paycheckDate: '2026-10-01',
      paycheckLabel: 'APS-SECURITY COMPANY · Thursday, October 1, 2026',
      jobId: 'company',
      starting: 2200,
      remaining: 74,
      closedAt: '2026-10-08',
      items: seeded.items,
      paid: [{ id: 'pay-1', name: 'Rent', amount: 600, separate: false }],
    }],
  }
  saveBudget(db, next)
  const again = getState(await openDb(file)).budget
  assert.equal(again.items[0].paid, true)
  assert.equal(again.items[0].name, 'Rent')
  assert.equal(again.items[0].amount, 600)
  assert.equal(again.paycheckDate, '2026-10-15')
  assert.equal(again.history.length, 1)
  assert.equal(again.history[0].paid[0].amount, 600)
  fs.rmSync(file, { force: true })
})
