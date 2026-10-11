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
