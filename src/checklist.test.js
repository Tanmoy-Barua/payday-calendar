import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_COMPANIES_ID,
  applyPaycheckSource,
  closePaycheckBudget,
  defaultBudgetNote,
  money2,
  plannedRemaining,
  remainingAfterPaid,
  runningSteps,
  syncDebtsWithChecklist,
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

test('paid card and side notes reduce remaining and the all-mains leftover', () => {
  const note = defaultBudgetNote()
  // Default side amounts: Prime 50, circled 45, circled 40 → 135 when paid.
  for (const item of note.items) {
    if (item.separate) item.paid = true
  }
  assert.equal(remainingAfterPaid(note.starting, note.items), 2065)
  assert.equal(plannedRemaining(note.starting, note.items), money2(74 - 135))
})

test('running steps match the corrected notepad chain', () => {
  const note = defaultBudgetNote()
  const { steps, remaining } = runningSteps(note.starting, note.items)
  assert.deepEqual(steps.map(step => step.amount), [600, 360, 100, 250, 500, 167, 60, 89])
  assert.deepEqual(steps.map(step => step.after), [1600, 1240, 1140, 890, 390, 223, 163, 74])
  assert.equal(remaining, 74)
})

test('starting amount defaults to all companies over 2 weeks', () => {
  const jobs = [
    {
      id: 'company',
      name: 'APS-SECURITY COMPANY',
      freq: 'biweeklyThu',
      anchor: '2026-10-01',
      weekEnd: 'sun',
      lag: 0,
    },
    {
      id: 'flex',
      name: 'Amazon Flex',
      freq: 'weekly',
      anchor: '2026-10-08',
      cardTotal: 'month',
    },
    {
      id: 'uber',
      name: 'Uber',
      freq: 'daily',
      anchor: '2026-10-01',
      cardTotal: 'month',
    },
  ]
  const months = {
    '2026-09': {
      days: {
        '2026-09-28': [{ id: 'a', job: 'company', hours: 8, amount: 147.52 }],
        '2026-09-29': [{ id: 'b', job: 'company', hours: 8, amount: 147.52 }],
      },
    },
    '2026-10': {
      days: {
        '2026-10-05': [{ id: 'c', job: 'flex', hours: 0, amount: 80 }],
        '2026-10-08': [{ id: 'd', job: 'uber', hours: 0, amount: 40 }],
      },
    },
  }
  const checks = upcomingPaychecks(jobs, months, '2026-10-11')
  assert.equal(checks.length, 1)
  assert.equal(checks[0].jobId, ALL_COMPANIES_ID)
  assert.equal(checks[0].range.span, 14)
  assert.equal(checks[0].range.start, '2026-09-28')
  assert.equal(checks[0].range.end, '2026-10-11')
  assert.equal(checks[0].amount, 415.04)
  assert.match(checks[0].label, /All companies · 2 weeks/)
  assert.deepEqual(checks[0].breakdown, [
    { jobId: 'company', jobName: 'APS-SECURITY COMPANY', amount: 295.04 },
    { jobId: 'flex', jobName: 'Amazon Flex', amount: 80 },
    { jobId: 'uber', jobName: 'Uber', amount: 40 },
  ])
  const note = applyPaycheckSource(defaultBudgetNote(), checks[0])
  assert.equal(note.starting, 415.04)
  assert.equal(note.jobId, ALL_COMPANIES_ID)
  assert.equal(note.earningsSource, 'all')
  assert.match(note.paycheckLabel, /All companies/)
  const again = applyPaycheckSource({ ...note, starting: 2200 }, checks[0])
  assert.equal(again.starting, 415.04)
})

test('checklist earnings follow Last 14 days when the schedule asks for it', () => {
  const jobs = [{
    id: 'flex',
    name: 'Amazon Flex',
    freq: 'weekly',
    anchor: '2026-10-08',
    cardTotal: '14',
  }]
  const months = {
    '2026-10': {
      days: {
        '2026-10-01': [{ id: 'a', job: 'flex', hours: 0, amount: 50 }],
        '2026-10-10': [{ id: 'b', job: 'flex', hours: 0, amount: 80 }],
      },
    },
  }
  const checks = upcomingPaychecks(jobs, months, '2026-10-11')
  assert.equal(checks.length, 1)
  assert.equal(checks[0].jobId, ALL_COMPANIES_ID)
  assert.equal(checks[0].range.span, 14)
  assert.equal(checks[0].range.start, '2026-09-28')
  assert.equal(checks[0].amount, 130)
})

test('closing a paycheck keeps history and clears the checklist', () => {
  const note = defaultBudgetNote()
  note.items[0].paid = true
  note.items[0].name = 'Rent'
  note.paycheckDate = '2026-10-15'
  note.paycheckLabel = 'All companies · 2 weeks'
  note.jobId = ALL_COMPANIES_ID
  const nextPay = {
    jobId: ALL_COMPANIES_ID,
    jobName: 'All companies',
    payday: '2026-10-29',
    amount: 400,
    label: 'All companies · 2 weeks',
  }
  const { budget, entry } = closePaycheckBudget(note, { closedAt: '2026-10-16', nextPaycheck: nextPay })
  assert.equal(entry.starting, 2200)
  assert.equal(entry.remaining, 1600)
  assert.equal(entry.paid[0].name, 'Rent')
  assert.equal(entry.paid[0].amount, 600)
  assert.equal(budget.history.length, 1)
  assert.equal(budget.items.length, 0)
  assert.equal(budget.starting, 400)
  assert.equal(budget.paycheckDate, '2026-10-29')
})

test('marking a debt checklist item paid adds that amount to the debt', () => {
  const debts = [{ id: 'car', name: 'Car loan', total: 4200, opened: '2026-01-01', payments: [] }]
  const prev = [{
    id: 'pay-1',
    name: 'Car loan',
    amount: 200,
    paid: false,
    separate: false,
    category: 'debt',
    debtId: 'car',
    debtPaymentId: '',
  }]
  const next = [{ ...prev[0], paid: true }]
  const synced = syncDebtsWithChecklist(debts, prev, next, { today: '2026-10-10' })
  assert.equal(synced.debts[0].payments.length, 1)
  assert.equal(synced.debts[0].payments[0].amount, 200)
  assert.equal(synced.debts[0].payments[0].day, '2026-10-10')
  assert.match(synced.debts[0].payments[0].note, /Checklist/)
  assert.equal(synced.items[0].debtPaymentId, synced.debts[0].payments[0].id)
})

test('unchecking a debt checklist item removes the linked debt payment', () => {
  const debts = [{
    id: 'car',
    name: 'Car loan',
    total: 4200,
    opened: '2026-01-01',
    payments: [{ id: 'link-1', day: '2026-10-10', amount: 200, note: 'Checklist · Car loan' }],
  }]
  const prev = [{
    id: 'pay-1',
    name: 'Car loan',
    amount: 200,
    paid: true,
    separate: false,
    category: 'debt',
    debtId: 'car',
    debtPaymentId: 'link-1',
  }]
  const next = [{ ...prev[0], paid: false }]
  const synced = syncDebtsWithChecklist(debts, prev, next, { today: '2026-10-10' })
  assert.equal(synced.debts[0].payments.length, 0)
  assert.equal(synced.items[0].debtPaymentId, '')
})

test('changing the paid debt amount updates the linked payment', () => {
  const debts = [{
    id: 'car',
    name: 'Car loan',
    total: 4200,
    opened: '2026-01-01',
    payments: [{ id: 'link-1', day: '2026-10-09', amount: 200, note: 'Checklist · Car loan' }],
  }]
  const prev = [{
    id: 'pay-1',
    name: 'Car loan',
    amount: 200,
    paid: true,
    separate: false,
    category: 'debt',
    debtId: 'car',
    debtPaymentId: 'link-1',
  }]
  const next = [{ ...prev[0], amount: 250 }]
  const synced = syncDebtsWithChecklist(debts, prev, next, { today: '2026-10-10' })
  assert.equal(synced.debts[0].payments.length, 1)
  assert.equal(synced.debts[0].payments[0].id, 'link-1')
  assert.equal(synced.debts[0].payments[0].amount, 250)
  assert.equal(synced.debts[0].payments[0].day, '2026-10-09')
})
