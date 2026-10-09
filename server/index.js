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
} from './auth.js'

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
