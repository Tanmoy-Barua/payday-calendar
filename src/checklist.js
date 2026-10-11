import { add, fmtTodayLine, localToday, uid } from './dates.js'
import { payOnOrAfter, periodFor } from './pay.js'
import { totals } from './calc.js'

export const DEFAULT_STARTING = 2200

export const ITEM_CATEGORIES = [
  { id: 'other', label: 'Other' },
  { id: 'debt', label: 'Debt' },
]

export function money2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function normalizeBudgetItem(item = {}) {
  const category = item.category === 'debt' ? 'debt' : 'other'
  return {
    id: item.id,
    name: item.name || '',
    amount: item.amount === '' || item.amount == null ? '' : item.amount,
    paid: !!item.paid,
    separate: !!item.separate,
    category: item.separate ? 'other' : category,
    debtId: category === 'debt' && !item.separate ? String(item.debtId || '') : '',
    debtPaymentId: String(item.debtPaymentId || ''),
  }
}

function blankItemFields(amount = '', separate = false) {
  return normalizeBudgetItem({
    id: '',
    name: '',
    amount,
    paid: false,
    separate,
    category: 'other',
    debtId: '',
    debtPaymentId: '',
  })
}

export function defaultBudgetNote() {
  const main = [600, 360, 100, 250, 500, 167, 60, 89].map((amount, i) => ({
    ...blankItemFields(amount, false),
    id: `pay-${i + 1}`,
  }))
  const separate = [
    { id: 'sep-prime', name: 'Prime', amount: 50 },
    { id: 'sep-credit-one', name: 'Credit One', amount: '' },
    { id: 'sep-capital-one', name: 'Capital One', amount: '' },
    { id: 'sep-apple', name: 'Apple Card', amount: '' },
    { id: 'sep-chevron', name: 'Chevron Card', amount: '' },
    { id: 'sep-45', name: '', amount: 45 },
    { id: 'sep-40', name: '', amount: 40 },
  ].map(row => ({ ...blankItemFields(row.amount, true), id: row.id, name: row.name }))
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
      category: item.category === 'debt' ? 'debt' : 'other',
      debtId: item.debtId || '',
    }))
    .filter(row => row.amount != null)
}

function cloneDebts(debts) {
  return (debts || []).map(debt => ({
    ...debt,
    payments: [...(debt.payments || [])],
  }))
}

function removeLinkedPayment(debts, paymentId) {
  if (!paymentId) return debts
  return debts.map(debt => ({
    ...debt,
    payments: (debt.payments || []).filter(pay => pay.id !== paymentId),
  }))
}

function upsertLinkedPayment(debts, item, { today, paymentId }) {
  const amount = itemAmount(item)
  const id = paymentId || uid()
  if (!item.debtId || amount == null || !(amount > 0)) {
    return { debts: removeLinkedPayment(debts, id), paymentId: '' }
  }
  if (!debts.some(debt => debt.id === item.debtId)) {
    return { debts: removeLinkedPayment(debts, id), paymentId: '' }
  }
  const note = item.name?.trim() ? `Checklist · ${item.name.trim()}` : 'Checklist payment'
  let keptDay = today
  for (const debt of debts) {
    const existing = (debt.payments || []).find(pay => pay.id === id)
    if (existing?.day) {
      keptDay = existing.day
      break
    }
  }
  const cleared = removeLinkedPayment(debts, id)
  const next = cleared.map(debt => (
    debt.id === item.debtId
      ? {
          ...debt,
          payments: [...(debt.payments || []), { id, day: keptDay, amount, note }],
        }
      : debt
  ))
  return { debts: next, paymentId: id }
}

/** Keep Debt page payments in sync when checklist debt rows are paid / unpaid / changed. */
export function syncDebtsWithChecklist(debts, prevItems, nextItems, { today = localToday() } = {}) {
  let nextDebts = cloneDebts(debts)
  const prevMap = new Map((prevItems || []).map(item => [item.id, normalizeBudgetItem(item)]))
  const nextNormalized = (nextItems || []).map(item => normalizeBudgetItem(item))
  const nextIds = new Set(nextNormalized.map(item => item.id))

  for (const prev of prevMap.values()) {
    if (nextIds.has(prev.id)) continue
    if (prev.debtPaymentId) nextDebts = removeLinkedPayment(nextDebts, prev.debtPaymentId)
  }

  const syncedItems = nextNormalized.map(item => {
    const prev = prevMap.get(item.id) || normalizeBudgetItem({ id: item.id })
    const wasLinked = prev.category === 'debt' && prev.paid && prev.debtPaymentId
    const shouldLink = item.category === 'debt' && item.paid && !item.separate

    if (!shouldLink) {
      if (wasLinked) nextDebts = removeLinkedPayment(nextDebts, prev.debtPaymentId)
      return { ...item, debtPaymentId: '' }
    }

    const paymentId = prev.debtPaymentId || item.debtPaymentId || uid()
    const result = upsertLinkedPayment(nextDebts, item, { today, paymentId })
    nextDebts = result.debts
    return { ...item, debtPaymentId: result.paymentId }
  })

  return { debts: nextDebts, items: syncedItems }
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
    items: items.map(item => {
      const row = normalizeBudgetItem(item)
      return {
        ...row,
        amount: row.amount === '' || row.amount == null ? '' : money2(row.amount),
      }
    }),
    paid: paidBreakdown(items),
  }
  const resetItems = items.map(item => ({
    ...normalizeBudgetItem(item),
    paid: false,
    debtPaymentId: '',
  }))
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
