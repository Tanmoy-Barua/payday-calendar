import test from 'node:test'
import assert from 'node:assert/strict'
import { finishDate, planFromPayments } from './debt.js'

test('a finished debt has no finish date left', () => {
  assert.deepEqual(
    finishDate({ remaining: 0, payment: 200, everyDays: 14, today: '2026-10-08' }),
    { done: true, day: null, paymentsLeft: 0 },
  )
})

test('finish date counts remaining payments from today', () => {
  const result = finishDate({
    remaining: 850,
    payment: 200,
    everyDays: 14,
    today: '2026-10-08',
  })
  assert.equal(result.done, false)
  assert.equal(result.paymentsLeft, 5)
  assert.equal(result.day, '2026-12-03')
})

test('finish date continues from the last payment', () => {
  const result = finishDate({
    remaining: 400,
    payment: 200,
    everyDays: 14,
    today: '2026-10-08',
    lastPaid: '2026-10-06',
  })
  assert.equal(result.paymentsLeft, 2)
  assert.equal(result.day, '2026-11-03')
})

test('payment history suggests an average plan', () => {
  const plan = planFromPayments([
    { day: '2026-10-01', amount: 200 },
    { day: '2026-10-15', amount: 200 },
  ])
  assert.equal(plan.payment, 200)
  assert.equal(plan.everyDays, 14)
})
