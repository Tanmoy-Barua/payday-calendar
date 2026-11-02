import test from 'node:test'
import assert from 'node:assert/strict'
import { payOnOrAfter, payBefore, periodFor, lagOf, listPastPaychecks, cardTotalRange, normalizeCardTotal, sharedPayOnOrAfter, sharedPeriodFor } from './pay.js'
import { totals, workDays, workShifts, monthRange, halfMonthRanges } from './calc.js'

const company = { id: 'company', freq: 'biweeklyThu', anchor: '2026-10-01', weekEnd: 'sun', lag: 0 }

test('company paycheck covers Sep 28 through Oct 11 and pays Oct 15', () => {
  const today = '2026-10-06'
  const next = payOnOrAfter(company, today)
  assert.equal(next, '2026-10-15')
  assert.equal(payBefore(company, next), '2026-10-01')
  assert.equal(lagOf(company), 4)
  const per = periodFor(company, next)
  assert.deepEqual(per, { start: '2026-09-28', end: '2026-10-11', payday: '2026-10-15' })
})

test('all jobs share the later Thursday payday', () => {
  const jobs = [
    { id: 'company', name: 'APS', freq: 'biweeklyThu', anchor: '2026-10-15', weekEnd: 'sun' },
    { id: 'flex', name: 'Amazon Flex', freq: 'weekly', anchor: '2026-10-01' },
    { id: 'uber', name: 'Uber', freq: 'weekly', anchor: '2026-10-01' },
  ]
  assert.equal(payOnOrAfter(jobs[1], '2026-10-31'), '2026-11-05')
  assert.equal(payOnOrAfter(jobs[0], '2026-10-31'), '2026-11-12')
  assert.equal(sharedPayOnOrAfter(jobs, '2026-10-31'), '2026-11-12')
  assert.equal(sharedPayOnOrAfter(jobs, '2026-11-13', '2026-10-31'), '2026-11-26')
  assert.equal(sharedPayOnOrAfter(jobs, '2026-09-27', '2026-10-31'), '2026-10-01')
  assert.equal(sharedPayOnOrAfter(jobs, '2026-10-02', '2026-10-31'), '2026-10-15')
  assert.deepEqual(sharedPeriodFor(jobs, '2026-11-26', '2026-10-31'), {
    start: '2026-11-09',
    end: '2026-11-22',
    payday: '2026-11-26',
  })
  assert.deepEqual(sharedPeriodFor(jobs, '2026-11-12', '2026-10-31'), {
    start: '2026-10-26',
    end: '2026-11-08',
    payday: '2026-11-12',
  })
})

test('offset Flex paydays do not move the company PAY marks', () => {
  const jobs = [
    { id: 'company', name: 'APS', freq: 'biweeklyThu', anchor: '2026-10-15', weekEnd: 'sun' },
    { id: 'flex', name: 'Amazon Flex', freq: 'biweeklyThu', anchor: '2026-10-08', weekEnd: 'sun' },
  ]
  assert.equal(payOnOrAfter(jobs[1], '2026-10-31'), '2026-11-05')
  assert.equal(sharedPayOnOrAfter(jobs, '2026-10-31', '2026-10-31'), '2026-11-12')
  assert.equal(sharedPayOnOrAfter(jobs, '2026-09-27', '2026-10-31'), '2026-10-01')
  assert.equal(sharedPayOnOrAfter(jobs, '2026-10-09', '2026-10-31'), '2026-10-15')
})

test('saturday week end delays the check by 5 days', () => {
  const job = { ...company, weekEnd: 'sat' }
  const per = periodFor(job, '2026-10-15')
  assert.equal(lagOf(job), 5)
  assert.equal(per.start, '2026-09-27')
  assert.equal(per.end, '2026-10-10')
})

test('cardTotalRange can use this month or last N days for the top total', () => {
  const job = { id: 'uber', freq: 'daily', anchor: '2026-10-01', cardTotal: 'month' }
  const month = cardTotalRange(job, '2026-10-11')
  assert.equal(month.mode, 'month')
  assert.equal(month.start, '2026-10-01')
  assert.equal(month.end, '2026-10-31')
  assert.equal(month.title, 'This month')
  const fifteen = cardTotalRange({ ...job, cardTotal: '15' }, '2026-10-11')
  assert.equal(fifteen.start, '2026-09-27')
  assert.equal(fifteen.end, '2026-10-11')
  assert.equal(normalizeCardTotal('nope'), 'paycheck')
})

test('daily pay treats each day as its own paycheck', () => {
  const job = { id: 'gig', name: 'Daily gig', freq: 'daily', anchor: '2026-10-01', lag: 0 }
  assert.equal(payOnOrAfter(job, '2026-10-11'), '2026-10-11')
  assert.equal(payBefore(job, '2026-10-11'), '2026-10-10')
  assert.deepEqual(periodFor(job, '2026-10-11'), {
    start: '2026-10-11',
    end: '2026-10-11',
    payday: '2026-10-11',
  })
  const lagJob = { ...job, lag: 1 }
  assert.deepEqual(periodFor(lagJob, '2026-10-11'), {
    start: '2026-10-10',
    end: '2026-10-10',
    payday: '2026-10-11',
  })
})

test('month and half-month ranges cover the calendar month', () => {
  assert.deepEqual(monthRange('2026-10'), { start: '2026-10-01', end: '2026-10-31' })
  const halves = halfMonthRanges('2026-10')
  assert.deepEqual(halves.first, { start: '2026-10-01', end: '2026-10-15', label: '1st – 15th' })
  assert.deepEqual(halves.second, { start: '2026-10-16', end: '2026-10-31', label: '16th – end' })
  assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' })
})

test('workDays counts unique days with hours, matching totals range scan', () => {
  const months = {
    '2026-09': {
      days: {
        '2026-09-14': [{ id: 'a', job: 'company', hours: 8, amount: 160 }],
        // Two shifts same day still count as one day worked.
        '2026-09-15': [
          { id: 'b1', job: 'company', hours: 4, amount: 80 },
          { id: 'b2', job: 'company', hours: 4, amount: 80 },
        ],
        // Zero-hour row does not count.
        '2026-09-16': [{ id: 'c', job: 'company', hours: 0, amount: 0 }],
        // Other job does not count.
        '2026-09-17': [{ id: 'd', job: 'other', hours: 8, amount: 100 }],
      },
    },
  }
  assert.equal(workDays(months, '2026-09-14', '2026-09-17', 'company'), 2)
  assert.equal(workShifts(months, '2026-09-14', '2026-09-17', 'company'), 3)
})

test('totals add hours and pay across month files', () => {
  const months = {
    '2026-09': { days: { '2026-09-28': [{ id: 'a', job: 'company', hours: 8, amount: 147.52 }] } },
    '2026-10': { days: { '2026-10-06': [{ id: 'b', job: 'company', hours: 4, amount: 73.76 }] } },
  }
  const sum = totals(months, '2026-09-28', '2026-10-11', 'company')
  assert.equal(sum.h, 12)
  assert.equal(Math.round(sum.a * 100) / 100, 221.28)
})

test('listPastPaychecks returns closed checks with hours and pay', () => {
  const job = { id: 'company', name: 'My company', freq: 'biweeklyThu', anchor: '2026-10-01', weekEnd: 'sun', color: 0 }
  const months = {
    '2026-09': {
      days: {
        '2026-09-28': [{ id: 'a', job: 'company', hours: 8, amount: 160 }],
        '2026-09-29': [{ id: 'b', job: 'company', hours: 8, amount: 160 }],
      },
    },
    '2026-10': {
      days: {
        '2026-10-06': [{ id: 'c', job: 'company', hours: 8, amount: 160 }],
      },
    },
  }
  // Oct 15 is still the upcoming payday on Oct 12 — past list should be empty for that cycle.
  assert.equal(listPastPaychecks([job], months, '2026-10-12').length, 0)
  // After Oct 15, that cycle is past and should appear with 24h / $480.
  const past = listPastPaychecks([job], months, '2026-10-16')
  assert.equal(past.length, 1)
  assert.equal(past[0].payday, '2026-10-15')
  assert.equal(past[0].hours, 24)
  assert.equal(past[0].amount, 480)
  assert.equal(past[0].start, '2026-09-28')
  assert.equal(past[0].end, '2026-10-11')
  assert.equal(past[0].days, 3)
  assert.equal(past[0].periodDays, 14)
})
