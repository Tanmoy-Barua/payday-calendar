import test from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedCalendarUrl, parseIcsEvents, unfoldIcs } from './ics.js'
import { applyConnecteamShifts, dedupeShifts } from './connecteam.js'

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

test('applyConnecteamShifts replaces that job on sync days so hours are not doubled', () => {
  const months = {
    '2026-10': {
      days: {
        '2026-10-10': [
          { id: 'manual', job: 'company', hours: 8, amount: 147.52 },
          { id: 'cteam-old', job: 'company', hours: 8, amount: 147.52 },
          { id: 'other', job: 'weekend', hours: 3, amount: 60 },
        ],
        '2026-10-12': [
          { id: 'keep', job: 'company', hours: 5, amount: 90 },
        ],
      },
    },
  }
  const shifts = parseIcsEvents(SAMPLE)
  const { months: next, added } = applyConnecteamShifts(months, shifts, { jobId: 'company', rate: 18.44 })
  assert.equal(added, 2)
  const day = next['2026-10'].days['2026-10-10']
  assert.equal(day.filter(e => e.job === 'company').length, 1)
  assert.equal(day.find(e => e.job === 'company').hours, 8)
  assert.equal(day.find(e => e.job === 'weekend').hours, 3)
  assert.equal(next['2026-10'].days['2026-10-11'][0].hours, 8)
  // Day not in the feed keeps its manual company hours.
  assert.equal(next['2026-10'].days['2026-10-12'][0].hours, 5)
})

test('duplicate ICS events for the same shift are collapsed', () => {
  const shifts = dedupeShifts([
    { uid: 'a', day: '2026-10-10', hours: 8, start: 'x', end: 'y' },
    { uid: 'a', day: '2026-10-10', hours: 8, start: 'x', end: 'y' },
    { uid: 'b', day: '2026-10-10', hours: 8, start: 'x', end: 'y' },
  ])
  assert.equal(shifts.length, 1)
})
