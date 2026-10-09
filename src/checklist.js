export const DEFAULT_STARTING = 2200

export function money2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function defaultBudgetNote() {
  const main = [600, 360, 100, 250, 500, 167, 60, 89].map((amount, i) => ({
    id: `pay-${i + 1}`,
    name: '',
    amount,
    paid: false,
    separate: false,
  }))
  const separate = [
    { id: 'sep-prime', name: 'Prime', amount: 50, paid: false, separate: true },
    { id: 'sep-credit-one', name: 'Credit One', amount: '', paid: false, separate: true },
    { id: 'sep-capital-one', name: 'Capital One', amount: '', paid: false, separate: true },
    { id: 'sep-apple', name: 'Apple Card', amount: '', paid: false, separate: true },
    { id: 'sep-chevron', name: 'Chevron Card', amount: '', paid: false, separate: true },
    { id: 'sep-45', name: '', amount: 45, paid: false, separate: true },
    { id: 'sep-40', name: '', amount: 40, paid: false, separate: true },
  ]
  return {
    title: 'Budget Note',
    starting: DEFAULT_STARTING,
    items: [...main, ...separate],
  }
}

export function itemAmount(item) {
  if (item?.amount === '' || item?.amount == null) return null
  const n = Number(item.amount)
  return Number.isFinite(n) ? money2(Math.max(0, n)) : null
}

export function remainingAfterPaid(starting, items) {
  const start = money2(Math.max(0, Number(starting) || 0))
  let left = start
  for (const item of items || []) {
    if (item.separate || !item.paid) continue
    const amount = itemAmount(item)
    if (amount == null) continue
    left = money2(left - amount)
  }
  return left
}

export function plannedRemaining(starting, items) {
  const start = money2(Math.max(0, Number(starting) || 0))
  let left = start
  for (const item of items || []) {
    if (item.separate) continue
    const amount = itemAmount(item)
    if (amount == null) continue
    left = money2(left - amount)
  }
  return left
}

export function runningSteps(starting, items) {
  const start = money2(Math.max(0, Number(starting) || 0))
  let left = start
  const steps = []
  for (const item of items || []) {
    if (item.separate) continue
    const amount = itemAmount(item)
    if (amount == null) continue
    const before = left
    left = money2(left - amount)
    steps.push({
      id: item.id,
      name: item.name || '',
      amount,
      before,
      after: left,
      paid: !!item.paid,
    })
  }
  return { starting: start, steps, remaining: left }
}

export function newItemId() {
  return `item-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
