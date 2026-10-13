import { add, lastDom, P, ymd } from './dates.js'

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

/** One point per calendar day from `from` through `to` (inclusive). */
export function dailySeries(months, from, to, jobId) {
  if (!from || !to || from > to) return []
  const series = []
  for (let day = from; day <= to; day = add(day, 1)) {
    const entries = entriesOn(months, day).filter(e => !jobId || e.job === jobId)
    let amount = 0
    let hours = 0
    const parts = {}
    for (const e of entries) {
      const pay = Number(e.amount) || 0
      const hrs = Number(e.hours) || 0
      amount += pay
      hours += hrs
      const id = e.job || '_'
      parts[id] = (parts[id] || 0) + pay
    }
    series.push({ date: day, amount, hours, parts })
  }
  return series
}

/** Sunday–Saturday buckets clipped to `[from, to]`. */
export function weekBuckets(from, to) {
  if (!from || !to || from > to) return []
  const weeks = []
  for (let cursor = from; cursor <= to;) {
    const remaining = 6 - P(cursor).getUTCDay()
    const weekEnd = add(cursor, remaining)
    const end = weekEnd > to ? to : weekEnd
    weeks.push({ start: cursor, end })
    cursor = add(end, 1)
  }
  return weeks
}

/** Daily pay rolled into calendar weeks, still split by job in `parts`. */
export function weeklySeries(months, from, to, jobId) {
  const days = dailySeries(months, from, to, jobId)
  return weekBuckets(from, to).map(week => {
    let amount = 0
    let hours = 0
    const parts = {}
    for (const point of days) {
      if (point.date < week.start || point.date > week.end) continue
      amount += point.amount
      hours += point.hours
      for (const [id, pay] of Object.entries(point.parts)) {
        parts[id] = (parts[id] || 0) + pay
      }
    }
    return { start: week.start, end: week.end, amount, hours, parts }
  })
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
