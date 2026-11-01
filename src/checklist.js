import { add, diff, fmtShort, localToday, uid } from './dates.js'
import { payOnOrAfter, periodFor, sharedPayBefore, sharedPayOnOrAfter, sharedPeriodFor } from './pay.js'
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
    category,
    debtId: category === 'debt' ? String(item.debtId || '') : '',
    debtPaymentId: String(item.debtPaymentId || ''),
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate || '') ? item.dueDate : '',
  }
}

export function dueInDays(dueDate, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate || '')) return null
  return diff(today, dueDate)
}

export function dueLeftLabel(days) {
  if (days == null) return ''
  if (days === 0) return 'Due today'
  if (days === 1) return '1 day left'
  if (days > 1) return `${days} days left`
  if (days === -1) return '1 day late'
  return `${-days} days late`
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
    earningsEnd: '',
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
    // Main payments and card/side notes both reduce remaining once marked paid.
    if (!item.paid) continue
    const amount = itemAmount(item)
    if (amount == null) continue
    left = money2(left - amount)
  }
  return left
}

/**
 * Plan leftover after every main payment, then minus any card/side bills
 * already marked paid (so checking those rows updates this number).
 */
export function plannedRemaining(starting, items) {
  const start = money2(Math.max(0, Number(starting) || 0))
  let left = start
  for (const item of items || []) {
    if (item.separate && !item.paid) continue
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
    const shouldLink = item.category === 'debt' && item.paid

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

/** Synthetic source: total earned from every schedule in the last 14 days. */
export const ALL_COMPANIES_ID = 'all'

export function twoWeekWindow(today) {
  const end = today
  const start = add(today, -13)
  return { start, end, span: 14 }
}

export function allCompaniesTwoWeeks(jobs, months, today) {
  const range = twoWeekWindow(today)
  const sum = totals(months, range.start, range.end)
  const payday = sharedPayOnOrAfter(jobs, today) || range.end
  const rangeText = `${fmtShort(range.start)}–${fmtShort(range.end)}`
  const breakdown = (jobs || []).map(job => {
    const part = totals(months, range.start, range.end, job.id)
    return {
      jobId: job.id,
      jobName: job.name,
      amount: money2(part.a),
    }
  }).filter(row => row.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.jobName.localeCompare(b.jobName))
  return {
    jobId: ALL_COMPANIES_ID,
    jobName: 'All companies',
    payday,
    amount: money2(sum.a),
    period: { start: range.start, end: range.end, payday },
    range,
    cardMode: '14',
    isAllCompanies: true,
    breakdown,
    label: `All companies · 2 weeks ${rangeText}`,
  }
}

export function upcomingPaychecks(jobs, months, today) {
  if (!(jobs || []).length) return []
  return [allCompaniesTwoWeeks(jobs, months, today)]
}

export function applyPaycheckSource(budget, paycheck) {
  if (!paycheck) return budget
  return {
    ...budget,
    paycheckDate: paycheck.payday,
    paycheckLabel: paycheck.label,
    jobId: paycheck.jobId,
    earningsSource: paycheck.jobId === ALL_COMPANIES_ID ? 'all' : 'job',
    earningsEnd: '',
  }
}

export function allJobsOnPayday(jobs, months, payday, today = payday) {
  const list = jobs || []
  const range = sharedPeriodFor(jobs, payday, today)
  const current = totals(months, range.start, range.end)
  const periodOpen = !today || range.end >= today
  let amountRange = range
  let estimated = false
  if (!(current.a > 0 || current.h > 0) && periodOpen) {
    const prevPayday = sharedPayBefore(jobs, payday, today)
    const prev = sharedPeriodFor(jobs, prevPayday, today)
    const prevTotal = totals(months, prev.start, prev.end)
    if (prevTotal.a > 0 || prevTotal.h > 0) {
      amountRange = prev
      estimated = true
    }
  }
  const breakdown = list.map(job => {
    const part = totals(months, amountRange.start, amountRange.end, job.id)
    return {
      jobId: job.id,
      jobName: job.name,
      amount: money2(part.a),
      estimated,
      range: { start: range.start, end: range.end, payday },
    }
  }).sort((a, b) => b.amount - a.amount || a.jobName.localeCompare(b.jobName))
  const amount = money2(breakdown.reduce((sum, row) => sum + row.amount, 0))
  return {
    jobId: ALL_COMPANIES_ID,
    jobName: 'All companies',
    payday,
    amount,
    estimated,
    range: { start: range.start, end: range.end, payday },
    period: { start: range.start, end: range.end, payday },
    cardMode: 'paycheck',
    isAllCompanies: true,
    breakdown,
    label: `All jobs · payday ${fmtShort(payday)}`,
  }
}

export function paycheckForJob(job, months, payday) {
  if (!job || !payday) return null
  const per = periodFor(job, payday)
  const amount = money2(totals(months, per.start, per.end, job.id).a)
  return {
    jobId: job.id,
    jobName: job.name,
    payday: per.payday,
    amount,
    range: { start: per.start, end: per.end, payday: per.payday },
    period: per,
    isAllCompanies: false,
    breakdown: amount > 0 ? [{ jobId: job.id, jobName: job.name, amount }] : [],
    label: `${job.name} · payday ${fmtShort(per.payday)}`,
  }
}

export function upcomingJobPaychecks(jobs, months, today, { afterPayday = '', cycles = 1 } = {}) {
  const after = /^\d{4}-\d{2}-\d{2}$/.test(afterPayday) ? afterPayday : add(today, -1)
  const list = []
  for (const job of jobs || []) {
    let payday = payOnOrAfter(job, add(after, 1))
    for (let i = 0; i < cycles; i++) {
      const row = paycheckForJob(job, months, payday)
      if (row) list.push(row)
      payday = payOnOrAfter(job, add(payday, 1))
    }
  }
  return list.sort((a, b) => a.payday.localeCompare(b.payday) || a.jobName.localeCompare(b.jobName))
}

/** Next scheduled job paycheck after `afterPayday`, preferring one that still has earnings. */
export function nextPaycheckAfter(jobs, months, today, { afterPayday = '', history = [] } = {}) {
  if (!jobs?.length) return null
  const closed = new Set((history || []).map(entry => `${entry.jobId}:${entry.paycheckDate}`))
  const list = upcomingJobPaychecks(jobs, months, today, { afterPayday, cycles: 4 })
    .filter(row => !closed.has(`${row.jobId}:${row.payday}`))
  return list.find(row => row.amount > 0) || list[0] || null
}

/**
 * Open notepad: all jobs last 14 days.
 * After close (or when locked to a job): the next real payday from the calendar.
 */
export function activeChecklistPaycheck(jobs, months, today, budget) {
  if (!jobs?.length) return null
  const items = Array.isArray(budget?.items) ? budget.items : []
  const history = Array.isArray(budget?.history) ? budget.history : []
  const onJob = budget?.jobId && budget.jobId !== ALL_COMPANIES_ID
  const closed = items.length === 0 && history.length > 0
  if (closed) {
    const closedDates = new Set(history.map(entry => entry.paycheckDate).filter(Boolean))
    let payday = sharedPayOnOrAfter(jobs, today)
    for (let i = 0; i < 8 && closedDates.has(payday); i++) {
      payday = sharedPayOnOrAfter(jobs, add(payday, 1), today)
    }
    return allJobsOnPayday(jobs, months, payday, today)
  }
  if (onJob && /^\d{4}-\d{2}-\d{2}$/.test(budget.paycheckDate || '')) {
    return allJobsOnPayday(jobs, months, sharedPayOnOrAfter(jobs, budget.paycheckDate) || budget.paycheckDate, today)
  }
  return allCompaniesTwoWeeks(jobs, months, today)
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
  const kept = items.map(item => {
    const row = normalizeBudgetItem(item)
    if (!row.paid) return row
    return { ...row, paid: false, debtPaymentId: '' }
  })
  let next = {
    ...budget,
    items: kept,
    history: [entry, ...(Array.isArray(budget?.history) ? budget.history : [])],
  }
  if (nextPaycheck) next = applyPaycheckSource(next, nextPaycheck)
  return { budget: next, entry }
}

export function deleteHistoryEntry(budget, entryId) {
  const history = Array.isArray(budget?.history) ? budget.history : []
  return {
    ...budget,
    history: history.filter(entry => entry.id !== entryId),
  }
}

