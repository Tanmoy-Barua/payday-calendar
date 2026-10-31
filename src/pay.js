import { P, add, diff, fmtMonth, lastDom, ymd } from './dates.js'
import { monthRange, totals, workDays, workShifts } from './calc.js'

export const FREQ = {
  daily: 'Every day',
  biweeklyThu: 'Every 2 weeks, paid Thursday of 3rd week',
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  semimonthly: '15th & last day',
  monthly: 'Once a month',
}

/** What the top paycheck card total covers for this schedule. */
export const CARD_TOTALS = {
  paycheck: 'Next paycheck period',
  month: 'This calendar month',
  '14': 'Last 14 days (2 weeks)',
  '15': 'Last 15 days',
  '30': 'Last 30 days',
  '7': 'Last 7 days',
}

export function normalizeCardTotal(value) {
  const key = String(value || 'paycheck')
  return Object.prototype.hasOwnProperty.call(CARD_TOTALS, key) ? key : 'paycheck'
}

/** Range + labels for the big total on a job card. */
export function cardTotalRange(job, today) {
  const mode = normalizeCardTotal(job?.cardTotal)
  if (mode === 'month') {
    const ym = String(today).slice(0, 7)
    const [y, m] = ym.split('-').map(Number)
    const range = monthRange(ym)
    return {
      mode,
      start: range.start,
      end: range.end,
      title: 'This month',
      subtitle: fmtMonth(y, m),
    }
  }
  if (mode === '7' || mode === '14' || mode === '15' || mode === '30') {
    const n = Number(mode)
    return {
      mode,
      start: add(today, -(n - 1)),
      end: today,
      title: n === 14 ? 'Last 2 weeks' : `Last ${n} days`,
      subtitle: n === 14 ? '14-day total' : `${n}-day total`,
    }
  }
  const next = payOnOrAfter(job, today)
  const per = periodFor(job, next)
  return {
    mode: 'paycheck',
    start: per.start,
    end: per.end,
    payday: next,
    title: 'Next paycheck',
    subtitle: null,
  }
}

export const lagOf = job => job.freq === 'biweeklyThu' ? (job.weekEnd === 'sat' ? 5 : 4) : (Number(job.lag) || 0)

export function isPayday(job, day) {
  if (!job || !day) return false
  if (job.freq === 'daily') return true
  return payOnOrAfter(job, day) === day
}

function payStep(job) {
  if (job?.freq === 'weekly') return 7
  if (job?.freq === 'daily') return 1
  return 14
}

/** Company biweekly payday leads; weekly Flex/Uber follow that date. */
export function paydayLeadJob(jobs, today) {
  const scheduled = (jobs || []).filter(job => job && job.freq !== 'daily')
  if (!scheduled.length) return null
  const biweekly = scheduled.filter(job => job.freq === 'biweekly' || job.freq === 'biweeklyThu')
  const pool = biweekly.length ? biweekly : scheduled
  const day = today || pool[0].anchor
  return [...pool].sort((a, b) => {
    const pa = payOnOrAfter(a, day) || ''
    const pb = payOnOrAfter(b, day) || ''
    if (pa !== pb) return pb.localeCompare(pa)
    const step = payStep(b) - payStep(a)
    if (step) return step
    return String(a.name || '').localeCompare(String(b.name || ''))
  })[0]
}

/** Next payday on the shared company cycle (Nov 12, not Flex’s Nov 5). */
export function sharedPayOnOrAfter(jobs, start, today = start) {
  const lead = paydayLeadJob(jobs, today)
  if (!lead) return start
  return payOnOrAfter(lead, start)
}

export function payOnOrAfter(job, s) {
  const a = job.anchor
  if (job.freq === 'daily') return s
  if (job.freq === 'weekly' || job.freq === 'biweekly' || job.freq === 'biweeklyThu') {
    const step = job.freq === 'weekly' ? 7 : 14
    return add(a, Math.ceil(diff(a, s) / step) * step)
  }
  const d = P(s)
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth()
  for (let i = 0; i < 3; i++) {
    let cands
    if (job.freq === 'semimonthly') cands = [ymd(y, m, 15), ymd(y, m, lastDom(y, m))]
    else {
      const dom = P(a).getUTCDate()
      cands = [ymd(y, m, Math.min(dom, lastDom(y, m)))]
    }
    for (const c of cands) if (c >= s) return c
    m++
    if (m > 11) { m = 0; y++ }
  }
}

export function payBefore(job, p) {
  if (job.freq === 'daily') return add(p, -1)
  if (job.freq === 'weekly') return add(p, -7)
  if (job.freq === 'biweekly' || job.freq === 'biweeklyThu') return add(p, -14)
  const d = P(p)
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth()
  if (job.freq === 'semimonthly') {
    if (d.getUTCDate() === 15) {
      m--
      if (m < 0) { m = 11; y-- }
      return ymd(y, m, lastDom(y, m))
    }
    return ymd(y, m, 15)
  }
  m--
  if (m < 0) { m = 11; y-- }
  const dom = P(job.anchor).getUTCDate()
  return ymd(y, m, Math.min(dom, lastDom(y, m)))
}

export function periodFor(job, payday) {
  const lag = lagOf(job)
  return { start: add(payBefore(job, payday), -lag + 1), end: add(payday, -lag), payday }
}

export function periodContaining(job, day) {
  const p = payOnOrAfter(job, add(day, lagOf(job)))
  return periodFor(job, p)
}

function earliestLoggedDay(months, jobId) {
  let earliest = ''
  for (const month of Object.values(months || {})) {
    for (const [day, entries] of Object.entries(month?.days || {})) {
      if (!(entries || []).some(e => !jobId || e.job === jobId)) continue
      if (!earliest || day < earliest) earliest = day
    }
  }
  return earliest
}

/**
 * Past paydays (before today) with hours/pay from logged work.
 * Walks backward from the last completed payday for each schedule.
 */
export function listPastPaychecks(jobs, months, today, { jobId = '', limit = 36 } = {}) {
  const list = []
  const selected = (jobs || []).filter(job => !jobId || job.id === jobId)
  for (const job of selected) {
    const firstLog = earliestLoggedDay(months, job.id)
    if (!firstLog) continue
    let payday = payBefore(job, payOnOrAfter(job, today))
    // If today is exactly a payday, payBefore already steps back one cycle.
    let guard = 0
    while (payday && payday < today && guard++ < 80) {
      const period = periodFor(job, payday)
      if (period.end < firstLog && period.start < firstLog) {
        // Entire period is before any logged work — stop for this job.
        if (payday < firstLog) break
      }
      const sum = totals(months, period.start, period.end, job.id)
      if (sum.h > 0 || sum.a > 0) {
        list.push({
          id: `${job.id}-${payday}`,
          jobId: job.id,
          jobName: job.name,
          color: job.color,
          payday,
          start: period.start,
          end: period.end,
          hours: sum.h,
          amount: Math.round((sum.a || 0) * 100) / 100,
          days: workDays(months, period.start, period.end, job.id),
          shifts: workShifts(months, period.start, period.end, job.id),
          periodDays: diff(period.start, period.end) + 1,
          rate: sum.h > 0 ? Math.round((sum.a / sum.h) * 100) / 100 : 0,
        })
      }
      const prev = payBefore(job, payday)
      if (!prev || prev >= payday) break
      payday = prev
      if (period.end < firstLog) break
    }
  }
  return list
    .sort((a, b) => b.payday.localeCompare(a.payday) || a.jobName.localeCompare(b.jobName))
    .slice(0, limit)
}
