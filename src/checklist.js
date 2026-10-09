import { add, fmtTodayLine, localToday } from './dates.js'
import { payOnOrAfter, periodFor } from './pay.js'
import { totals } from './calc.js'

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
    paycheckDate: '',
    paycheckLabel: '',
    jobId: '',
    items: [...main, ...separate],
    history: [],
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

export function paidBreakdown(items) {
  return (items || [])
    .filter(item => item.paid)
    .map(item => ({
      id: item.id,
      name: item.name || (item.separate ? 'Side note' : 'Payment'),
      amount: itemAmount(item),
      separate: !!item.separate,
    }))
    .filter(row => row.amount != null)
}

export function newItemId(prefix = 'item') {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function upcomingPaychecks(jobs, months, today) {
  return (jobs || []).map(job => {
    const payday = payOnOrAfter(job, today)
    const period = periodFor(job, payday)
    const sum = totals(months, period.start, period.end, job.id)
    return {
      jobId: job.id,
      jobName: job.name,
      payday,
      amount: money2(sum.a),
      period,
      label: `${job.name} · ${fmtTodayLine(payday)}`,
    }
  }).sort((a, b) => a.payday.localeCompare(b.payday) || a.jobName.localeCompare(b.jobName))
}

export function applyPaycheckSource(budget, paycheck) {
  if (!paycheck) return budget
  return {
    ...budget,
    starting: money2(paycheck.amount),
    paycheckDate: paycheck.payday,
    paycheckLabel: paycheck.label,
    jobId: paycheck.jobId,
  }
}

export function closePaycheckBudget(budget, { closedAt = localToday(), nextPaycheck = null } = {}) {
  const starting = money2(Math.max(0, Number(budget?.starting) || 0))
  const items = Array.isArray(budget?.items) ? budget.items : []
  const remaining = remainingAfterPaid(starting, items)
  const entry = {
    id: newItemId('hist'),
    paycheckDate: budget?.paycheckDate || closedAt,
    paycheckLabel: budget?.paycheckLabel || 'Paycheck',
    jobId: budget?.jobId || '',
    starting,
    remaining,
    closedAt,
    items: items.map(item => ({
      id: item.id,
      name: item.name || '',
      amount: item.amount === '' || item.amount == null ? '' : money2(item.amount),
      paid: !!item.paid,
      separate: !!item.separate,
    })),
    paid: paidBreakdown(items),
  }
  const resetItems = items.map(item => ({ ...item, paid: false }))
  let next = {
    ...budget,
    items: resetItems,
    history: [entry, ...(budget?.history || [])],
  }
  if (nextPaycheck) next = applyPaycheckSource(next, nextPaycheck)
  return { budget: next, entry }
}

export function nextPaycheckAfter(jobs, months, payday, jobId) {
  const job = (jobs || []).find(row => row.id === jobId) || (jobs || [])[0]
  if (!job || !payday) return upcomingPaychecks(jobs, months, localToday())[0] || null
  const following = payOnOrAfter(job, add(payday, 1))
  const period = periodFor(job, following)
  const sum = totals(months, period.start, period.end, job.id)
  return {
    jobId: job.id,
    jobName: job.name,
    payday: following,
    amount: money2(sum.a),
    period,
    label: `${job.name} · ${fmtTodayLine(following)}`,
  }
}
