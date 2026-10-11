import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import { createServer as createViteServer } from 'vite'
import { openDb, getState, saveJobs, saveMonth, saveDebts, saveBudget } from './db.js'
import {
  disableLockAuth,
  getAuthStatus,
  loginLock,
  logoutLock,
  requireAuth,
  setupLock,
  touchAuth,
} from './auth.js'
import { isAllowedCalendarUrl, parseIcsEvents } from '../src/ics.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const PORT = Number(process.env.PORT) || 3000
const dbFile = process.env.PAYDAY_DB || path.join(root, 'data', 'payday.sqlite')
const db = await openDb(dbFile)
console.log(`Payday Calendar database ${dbFile}`)

const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/api/auth/status', (req, res) => {
  res.json(getAuthStatus(db, req))
})

app.post('/api/auth/setup', (req, res) => {
  try {
    res.json(setupLock(db, req, res, req.body || {}))
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not set up lock' })
  }
})

app.post('/api/auth/login', (req, res) => {
  try {
    res.json(loginLock(db, req, res, req.body || {}))
  } catch (err) {
    res.status(401).json({ error: err.message || 'Could not unlock' })
  }
})

app.post('/api/auth/logout', (req, res) => {
  res.json(logoutLock(db, req, res))
})

app.post('/api/auth/touch', (req, res) => {
  const result = touchAuth(db, req, res)
  res.status(result.ok ? 200 : 401).json(result)
})

app.post('/api/auth/disable', (req, res) => {
  try {
    res.json(disableLockAuth(db, req, res, req.body || {}))
  } catch (err) {
    res.status(401).json({ error: err.message || 'Could not turn off lock' })
  }
})

app.get('/api/state', (req, res) => {
  if (!requireAuth(db, req, res)) return
  res.json(getState(db))
})

app.put('/api/jobs', (req, res) => {
  if (!requireAuth(db, req, res)) return
  try {
    saveJobs(db, req.body?.jobs || [])
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not save' })
  }
})

app.put('/api/months/:ym', (req, res) => {
  if (!requireAuth(db, req, res)) return
  try {
    saveMonth(db, req.params.ym, req.body?.days || {})
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not save' })
  }
})

app.put('/api/debts', (req, res) => {
  if (!requireAuth(db, req, res)) return
  try {
    saveDebts(db, req.body?.debts || [])
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not save' })
  }
})

app.put('/api/budget', (req, res) => {
  if (!requireAuth(db, req, res)) return
  try {
    saveBudget(db, req.body?.budget || {})
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not save' })
  }
})

app.post('/api/calendar/fetch', async (req, res) => {
  if (!requireAuth(db, req, res)) return
  const url = String(req.body?.url || '').trim()
  if (!isAllowedCalendarUrl(url)) {
    res.status(400).json({ error: 'Paste the https Connecteam calendar URL from Connecteam Settings.' })
    return
  }
  try {
    const upstream = await fetch(url, {
      redirect: 'follow',
      headers: { Accept: 'text/calendar, text/plain, */*' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!upstream.ok) {
      res.status(502).json({ error: `Connecteam calendar returned ${upstream.status}` })
      return
    }
    const text = await upstream.text()
    if (text.length > 2_000_000) {
      res.status(400).json({ error: 'Calendar file is too large' })
      return
    }
    if (!/BEGIN:VCALENDAR/i.test(text) && !/BEGIN:VEVENT/i.test(text)) {
      res.status(400).json({ error: 'That link did not return a calendar feed' })
      return
    }
    const shifts = parseIcsEvents(text)
    res.json({ ok: true, count: shifts.length, shifts })
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not download calendar' })
  }
})

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')))
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))
} else {
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Payday Calendar http://localhost:${PORT}`)
})
