/** Unfold ICS content lines (RFC 5545). */
export function unfoldIcs(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '')
}

function splitProps(block) {
  const props = {}
  for (const line of block.split('\n')) {
    if (!line || line.startsWith('BEGIN:') || line.startsWith('END:')) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const left = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const semi = left.indexOf(';')
    const key = (semi < 0 ? left : left.slice(0, semi)).toUpperCase()
    const params = semi < 0 ? '' : left.slice(semi + 1)
    props[key] = { value, params }
  }
  return props
}

function clockFromParts(hs, mins) {
  return `${String(hs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function clockFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return clockFromParts(date.getHours(), date.getMinutes())
}

function parseIcsDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (/^\d{8}$/.test(raw)) {
    const y = Number(raw.slice(0, 4))
    const m = Number(raw.slice(4, 6))
    const d = Number(raw.slice(6, 8))
    return {
      day: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
      date: new Date(y, m - 1, d, 0, 0, 0),
      time: null,
    }
  }
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (!m) return null
  const [, ys, ms, ds, hs, mins, ss] = m
  const day = `${ys}-${ms}-${ds}`
  // Wall-clock components for duration; day comes from the ICS date itself.
  const date = new Date(+ys, +ms - 1, +ds, +hs, +mins, +ss)
  return { day, date, time: clockFromParts(hs, mins) }
}

function hoursBetween(start, end) {
  const ms = end.getTime() - start.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round((ms / 3_600_000) * 100) / 100
}

/** Parse RFC 5545 DURATION (e.g. PT8H, PT8H30M, P1DT2H). */
export function parseDurationHours(value) {
  const raw = String(value || '').trim().toUpperCase()
  const m = raw.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/)
  if (!m) return 0
  const days = Number(m[1] || 0)
  const hours = Number(m[2] || 0)
  const mins = Number(m[3] || 0)
  const secs = Number(m[4] || 0)
  const total = days * 24 + hours + mins / 60 + secs / 3600
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.round(total * 100) / 100
}

/** Parse VEVENT blocks into shift rows. */
export function parseIcsEvents(text) {
  const unfolded = unfoldIcs(text)
  const events = []
  const re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/gi
  let match
  while ((match = re.exec(unfolded))) {
    const props = splitProps(match[1])
    const start = parseIcsDate(props.DTSTART?.value)
    if (!start) continue
    const end = parseIcsDate(props.DTEND?.value)
    let hours = 0
    let endDate = end?.date || null
    if (endDate) {
      hours = hoursBetween(start.date, endDate)
    } else if (props.DURATION?.value) {
      hours = parseDurationHours(props.DURATION.value)
      if (hours > 0) endDate = new Date(start.date.getTime() + hours * 3_600_000)
    }
    if (hours <= 0 || !endDate) continue
    const uid = String(props.UID?.value || `${start.day}-${hours}`).trim()
    const startTime = start.time || clockFromDate(start.date)
    const endTime = end?.time || clockFromDate(endDate)
    events.push({
      uid,
      day: start.day,
      hours,
      summary: String(props.SUMMARY?.value || 'Shift').replace(/\\,/g, ',').replace(/\\n/g, ' '),
      start: start.date.toISOString(),
      end: endDate.toISOString(),
      startTime,
      endTime,
    })
  }
  return events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

const BLOCKED_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\])/i

/** Allow only https calendar feed URLs (Connecteam / S3 / .ics). */
export function isAllowedCalendarUrl(url) {
  let parsed
  try { parsed = new URL(String(url || '').trim()) } catch { return false }
  if (parsed.protocol !== 'https:') return false
  if (BLOCKED_HOST.test(parsed.hostname)) return false
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname.toLowerCase()
  if (host.includes('amazonaws.com')) return true
  if (host.includes('connecteam.com')) return true
  if (host.includes('onefid.')) return true
  if (path.endsWith('.ics')) return true
  return false
}
