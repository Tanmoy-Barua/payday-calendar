import test from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedCalendarUrl, parseIcsEvents, unfoldIcs } from './ics.js'
import { applyConnecteamShifts } from './connecteam.js'

const SAMPLE = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:shift-1@connecteam
DTSTART:20261010T090000
DTEND:20261010T170000
SUMMARY:Morning shift
END:VEVENT
BEGIN:VEVENT
UID:shift-2@connecteam
DTSTART:20261011T130000
DTEND:20261011T210000
SUMMARY:Evening
END:VEVENT
END:VCALENDAR`

test('unfolds folded ICS lines', () => {
  // Leading space/tab on the continuation line is the fold marker and is removed.
  assert.equal(unfoldIcs('SUMMARY:Hello\n world'), 'SUMMARY:Helloworld')
  assert.equal(unfoldIcs('SUMMARY:Hello \n world'), 'SUMMARY:Hello world')
})

test('parses Connecteam-style shift events into hours by day', () => {
  const events = parseIcsEvents(SAMPLE)
  assert.equal(events.length, 2)
  assert.equal(events[0].day, '2026-10-10')
  assert.equal(events[0].hours, 8)
  assert.equal(events[1].day, '2026-10-11')
  assert.equal(events[1].hours, 8)
})

test('calendar URL allowlist accepts Connecteam/S3 https feeds only', () => {
  assert.equal(
    isAllowedCalendarUrl('https://s3.eu-central-1.amazonaws.com/onefid.content.abc/feed.ics'),
    true,
  )
  assert.equal(isAllowedCalendarUrl('http://example.com/x.ics'), false)
  assert.equal(isAllowedCalendarUrl('https://127.0.0.1/secret.ics'), false)
  assert.equal(isAllowedCalendarUrl('https://evil.example/x'), false)
})

test('applyConnecteamShifts replaces prior Connecteam rows and keeps manual logs', () => {
  const months = {
    '2026-10': {
      days: {
        '2026-10-10': [
          { id: 'manual', job: 'company', hours: 2, amount: 40 },
          { id: 'cteam-old', job: 'company', hours: 4, amount: 80, source: 'connecteam' },
        ],
      },
    },
  }
  const shifts = parseIcsEvents(SAMPLE)
  const { months: next, added } = applyConnecteamShifts(months, shifts, { jobId: 'company', rate: 20 })
  assert.equal(added, 2)
  const day = next['2026-10'].days['2026-10-10']
  assert.equal(day.some(e => e.id === 'manual'), true)
  assert.equal(day.filter(e => String(e.id).startsWith('cteam-')).length, 1)
  assert.equal(day.find(e => String(e.id).startsWith('cteam-')).hours, 8)
  assert.equal(day.find(e => String(e.id).startsWith('cteam-')).amount, 160)
  assert.equal(next['2026-10'].days['2026-10-11'][0].hours, 8)
})
