import { lastDom, ymd } from './dates.js'

export const entriesOn = (months, s) => months[s.slice(0, 7)]?.days?.[s] || []

/** Full calendar month for a YYYY-MM view key. */
export function monthRange(ym) {
  const [y, m] = String(ym || '').split('-').map(Number)
  if (!y || !m) return { start: '', end: '' }
  return {
    start: ymd(y, m - 1, 1),
    end: ymd(y, m - 1, lastDom(y, m - 1)),
  }
}

/**
 * Half-month windows for a YYYY-MM view:
 * first = 1st–15th, second = 16th–last day.
 */
export function halfMonthRanges(ym) {
  const [y, m] = String(ym || '').split('-').map(Number)
  if (!y || !m) return { first: null, second: null }
  const last = lastDom(y, m - 1)
  return {
    first: {
      start: ymd(y, m - 1, 1),
      end: ymd(y, m - 1, Math.min(15, last)),
      label: '1st – 15th',
    },
    second: last <= 15 ? null : {
      start: ymd(y, m - 1, 16),
      end: ymd(y, m - 1, last),
      label: '16th – end',
    },
  }
}

export function totals(months, from, to, jobId) {
  let h = 0
  let a = 0
  for (const mk in months) {
    const days = months[mk].days || {}
    for (const d in days) {
      if (d < from || d > to) continue
      for (const e of days[d]) {
        if (!jobId || e.job === jobId) {
          h += Number(e.hours) || 0
          a += Number(e.amount) || 0
        }
      }
    }
  }
  return { h, a }
}

/** Unique calendar days in range with hours logged for the job. */
export function workDays(months, from, to, jobId) {
  const seen = new Set()
  for (const month of Object.values(months || {})) {
    for (const [day, entries] of Object.entries(month?.days || {})) {
      if (day < from || day > to || seen.has(day)) continue
      const worked = (entries || []).some(e => (
        (!jobId || e.job === jobId) && (Number(e.hours) || 0) > 0
      ))
      if (worked) seen.add(day)
    }
  }
  return seen.size
}

/** Number of hour entries (shifts) in range for the job. */
export function workShifts(months, from, to, jobId) {
  let n = 0
  for (const month of Object.values(months || {})) {
    for (const [day, entries] of Object.entries(month?.days || {})) {
      if (day < from || day > to) continue
      for (const e of entries || []) {
        if ((!jobId || e.job === jobId) && (Number(e.hours) || 0) > 0) n += 1
      }
    }
  }
  return n
}
