import test from 'node:test'
import assert from 'node:assert/strict'
import { payOnOrAfter, payBefore, periodFor, lagOf } from './pay.js'
import { totals } from './calc.js'

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

test('saturday week end delays the check by 5 days', () => {
  const job = { ...company, weekEnd: 'sat' }
  const per = periodFor(job, '2026-10-15')
  assert.equal(lagOf(job), 5)
  assert.equal(per.start, '2026-09-27')
  assert.equal(per.end, '2026-10-10')
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
