import { isAllowedCalendarUrl, parseIcsEvents } from './ics.js'

export const CONNECTEAM_URL_KEY = 'payday-connecteam-calendar-url'
export const CONNECTEAM_JOB_KEY = 'payday-connecteam-job-id'

export function loadConnecteamUrl(storage = localStorage) {
  return String(storage.getItem(CONNECTEAM_URL_KEY) || '').trim()
}

export function saveConnecteamUrl(url, storage = localStorage) {
  const next = String(url || '').trim()
  if (!next) {
    storage.removeItem(CONNECTEAM_URL_KEY)
    return ''
  }
  if (!isAllowedCalendarUrl(next)) {
    throw new Error('Use the https Connecteam calendar link from Connecteam Settings.')
  }
  storage.setItem(CONNECTEAM_URL_KEY, next)
  return next
}

export function loadConnecteamJobId(storage = localStorage) {
  return String(storage.getItem(CONNECTEAM_JOB_KEY) || '').trim()
}

export function saveConnecteamJobId(jobId, storage = localStorage) {
  const next = String(jobId || '').trim()
  if (!next) storage.removeItem(CONNECTEAM_JOB_KEY)
  else storage.setItem(CONNECTEAM_JOB_KEY, next)
  return next
}

function money2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function entryIdFor(uid) {
  const safe = String(uid || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
  return `cteam-${safe || Date.now().toString(36)}`
}

export function isConnecteamEntry(entry, jobId = '') {
  if (!entry) return false
  if (jobId && entry.job !== jobId) return false
  if (entry.source === 'connecteam') return true
  return String(entry.id || '').startsWith('cteam-')
}

/** Drop duplicate ICS rows (same uid, or same day/start/end/hours). */
export function dedupeShifts(shifts) {
  const seen = new Set()
  const out = []
  for (const shift of shifts || []) {
    if (!shift?.day || !(Number(shift.hours) > 0)) continue
    const uidKey = String(shift.uid || '').trim()
    const spanKey = `${shift.day}|${shift.start || ''}|${shift.end || ''}|${shift.hours}`
    const key = uidKey ? `uid:${uidKey}` : `span:${spanKey}`
    if (seen.has(key) || seen.has(`span:${spanKey}`)) continue
    seen.add(key)
    seen.add(`span:${spanKey}`)
    out.push(shift)
  }
  return out
}

/**
 * Apply Connecteam shifts for a job.
 * On any day that appears in the feed, replace ALL hours for that job (so sync
 * does not stack on top of earlier manual logs). Other jobs / other days stay.
 */
export function applyConnecteamShifts(months, shifts, { jobId, rate } = {}) {
  if (!jobId) throw new Error('Pick a pay schedule to attach Connecteam shifts to.')
  const unique = dedupeShifts(shifts)
  const syncDays = new Set(unique.map(shift => shift.day))

  const next = {}
  for (const [mk, month] of Object.entries(months || {})) {
    const days = {}
    for (const [day, entries] of Object.entries(month?.days || {})) {
      days[day] = (entries || []).filter(e => {
        if (e.job !== jobId) return true
        if (syncDays.has(day)) return false
        return !isConnecteamEntry(e, jobId)
      })
      if (!days[day].length) delete days[day]
    }
    next[mk] = { days }
  }

  let added = 0
  const hourly = Number(rate) || 0
  for (const shift of unique) {
    const mk = shift.day.slice(0, 7)
    if (!next[mk]) next[mk] = { days: {} }
    const days = next[mk].days
    const list = [...(days[shift.day] || [])]
    list.push({
      id: entryIdFor(shift.uid),
      job: jobId,
      hours: Number(shift.hours),
      amount: money2((Number(shift.hours) || 0) * hourly),
    })
    days[shift.day] = list
    added += 1
  }
  return {
    months: next,
    added,
    shifts: unique.length,
    days: syncDays.size,
  }
}

export function shiftsFromIcs(text) {
  return parseIcsEvents(text)
}
