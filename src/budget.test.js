import test from 'node:test'
import assert from 'node:assert/strict'
import { splitEarnings } from './budget.js'

test('a $4,000 month follows the earnings formula', () => {
  const rows = splitEarnings(4000)
  const byName = Object.fromEntries(rows.map(row => [row.name, row.amount]))
  assert.equal(byName['Essentials/Dad'], 2000)
  assert.equal(byName.Debt, 1200)
  assert.equal(byName.Savings, 200)
  assert.equal(byName.Investment, 200)
  assert.equal(byName.Wants, 200)
  assert.equal(byName['Emergency buffer'], 200)
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 4000)
})

test('paycheck cents still add up to the earnings', () => {
  const rows = splitEarnings(2111.38)
  const total = Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100
  assert.equal(total, 2111.38)
  assert.equal(rows[0].amount, 1055.69)
  assert.equal(rows[1].amount, 633.41)
})
