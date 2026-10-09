import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPaycheckSource,
  closePaycheckBudget,
  defaultBudgetNote,
  plannedRemaining,
  remainingAfterPaid,
  runningSteps,
  upcomingPaychecks,
} from './checklist.js'

test('notepad budget ends at $74 when every main payment is planned', () => {
  const note = defaultBudgetNote()
  assert.equal(note.starting, 2200)
  assert.equal(plannedRemaining(note.starting, note.items), 74)
})

test('remaining drops only for paid main checklist items', () => {
  const note = defaultBudgetNote()
  const first = note.items.find(item => !item.separate)
  first.paid = true
  assert.equal(remainingAfterPaid(note.starting, note.items), 1600)
  for (const item of note.items) {
    if (!item.separate) item.paid = true
  }
  assert.equal(remainingAfterPaid(note.starting, note.items), 74)
})

test('separate notepad items do not change the main remaining math', () => {
  const note = defaultBudgetNote()
  for (const item of note.items) {
    if (item.separate) item.paid = true
  }
  assert.equal(remainingAfterPaid(note.starting, note.items), 2200)
  assert.equal(plannedRemaining(note.starting, note.items), 74)
})

test('running steps match the corrected notepad chain', () => {
  const note = defaultBudgetNote()
  const { steps, remaining } = runningSteps(note.starting, note.items)
  assert.deepEqual(steps.map(step => step.amount), [600, 360, 100, 250, 500, 167, 60, 89])
  assert.deepEqual(steps.map(step => step.after), [1600, 1240, 1140, 890, 390, 223, 163, 74])
  assert.equal(remaining, 74)
})

test('starting amount can follow the next paycheck', () => {
  const jobs = [{
    id: 'company',
    name: 'APS-SECURITY COMPANY',
    freq: 'biweeklyThu',
    anchor: '2026-10-01',
    weekEnd: 'sun',
    lag: 0,
  }]
  const months = {
    '2026-09': {
      days: {
        '2026-09-28': [{ id: 'a', job: 'company', hours: 8, amount: 147.52 }],
        '2026-09-29': [{ id: 'b', job: 'company', hours: 8, amount: 147.52 }],
      },
    },
  }
  const checks = upcomingPaychecks(jobs, months, '2026-10-09')
  assert.equal(checks[0].payday, '2026-10-15')
  assert.equal(checks[0].amount, 295.04)
  const note = applyPaycheckSource(defaultBudgetNote(), checks[0])
  assert.equal(note.starting, 295.04)
  assert.equal(note.paycheckDate, '2026-10-15')
  assert.match(note.paycheckLabel, /APS-SECURITY COMPANY/)
})

test('closing a paycheck keeps history and resets paid marks', () => {
  const note = defaultBudgetNote()
  note.items[0].paid = true
  note.items[0].name = 'Rent'
  note.paycheckDate = '2026-10-15'
  note.paycheckLabel = 'APS-SECURITY COMPANY · Thursday, October 15, 2026'
  note.jobId = 'company'
  const nextPay = {
    jobId: 'company',
    jobName: 'APS-SECURITY COMPANY',
    payday: '2026-10-29',
    amount: 400,
    label: 'APS-SECURITY COMPANY · Thursday, October 29, 2026',
  }
  const { budget, entry } = closePaycheckBudget(note, { closedAt: '2026-10-16', nextPaycheck: nextPay })
  assert.equal(entry.starting, 2200)
  assert.equal(entry.remaining, 1600)
  assert.equal(entry.paid[0].name, 'Rent')
  assert.equal(entry.paid[0].amount, 600)
  assert.equal(budget.history.length, 1)
  assert.equal(budget.items[0].paid, false)
  assert.equal(budget.starting, 400)
  assert.equal(budget.paycheckDate, '2026-10-29')
})
