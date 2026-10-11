import { add } from './dates.js'

export const entriesOn = (months, s) => months[s.slice(0, 7)]?.days?.[s] || []

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

export function workDays(months, from, to, jobId) {
  let n = 0
  for (let d = from; d <= to; d = add(d, 1)) {
    if (entriesOn(months, d).some(e => !jobId || e.job === jobId)) n++
  }
  return n
}
