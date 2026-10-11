import { P, add, diff, lastDom, ymd } from './dates.js'

export const FREQ = {
  biweeklyThu: 'Every 2 weeks, paid Thursday of 3rd week',
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  semimonthly: '15th & last day',
  monthly: 'Once a month',
}

export const lagOf = job => job.freq === 'biweeklyThu' ? (job.weekEnd === 'sat' ? 5 : 4) : (Number(job.lag) || 0)

export function payOnOrAfter(job, s) {
  const a = job.anchor
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
