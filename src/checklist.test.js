import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultBudgetNote,
  plannedRemaining,
  remainingAfterPaid,
  runningSteps,
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
