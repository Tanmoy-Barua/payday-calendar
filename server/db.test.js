import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { openDb, getState, saveJobs, saveMonth } from './db.js'

test('sqlite stores schedules and month entries', async () => {
  const file = path.join(os.tmpdir(), `payday-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = await openDb(file)
  const seeded = getState(db)
  assert.equal(seeded.jobs.length, 1)
  assert.equal(seeded.jobs[0].id, 'company')
  assert.equal(seeded.jobs[0].freq, 'biweeklyThu')
  assert.equal(seeded.jobs[0].anchor, '2026-10-01')

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
