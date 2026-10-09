import { add, diff, P, S } from './dates.js'

export const PAY_EVERY = [
  { id: 7, label: 'Every week' },
  { id: 14, label: 'Every 2 weeks' },
  { id: 30, label: 'Every month' },
]

export const DEFAULT_EVERY_DAYS = 14
export const MONTHLY_PAY_KEY = 'payday-debt-monthly-pay'

function money2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function monthsToFinish(remaining, monthlyPay, today) {
  const owed = money2(remaining)
  const pay = money2(monthlyPay)
  if (owed <= 0) return { done: true, months: 0, day: null }
  if (!(pay > 0)) return { done: false, months: null, day: null }
  const months = Math.ceil(owed / pay)
  const start = /^\d{4}-\d{2}-\d{2}$/.test(today || '') ? P(today) : P('2026-10-01')
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()))
  return { done: false, months, day: S(end) }
}

export function finishDate({ remaining, payment, everyDays, today, lastPaid }) {
  const owed = money2(remaining)
  if (owed <= 0) return { done: true, day: null, paymentsLeft: 0 }
  const pay = money2(payment)
  const every = Math.max(1, Math.round(Number(everyDays) || 0))
  if (!(pay > 0) || !(every > 0)) return { done: false, day: null, paymentsLeft: null }

  const paymentsLeft = Math.ceil(owed / pay)
  let next = today
  if (lastPaid && /^\d{4}-\d{2}-\d{2}$/.test(lastPaid)) {
    next = add(lastPaid, every)
    if (next < today) next = today
  }
  return {
    done: false,
    day: add(next, every * (paymentsLeft - 1)),
    paymentsLeft,
  }
}

export function planFromPayments(payments) {
  const list = Array.isArray(payments) ? payments : []
  if (!list.length) return null
  const avg = money2(list.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) / list.length)
  if (!(avg > 0)) return null
  let everyDays = DEFAULT_EVERY_DAYS
  if (list.length >= 2) {
    const gaps = []
    for (let i = 1; i < list.length; i += 1) {
      const gap = diff(list[i - 1].day, list[i].day)
      if (gap > 0) gaps.push(gap)
    }
    if (gaps.length) everyDays = Math.max(1, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length))
  }
  return { payment: avg, everyDays }
}

export function everyLabel(days) {
  const row = PAY_EVERY.find(item => item.id === Number(days))
  return row ? row.label.toLowerCase() : `every ${days} days`
}
