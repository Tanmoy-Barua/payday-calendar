import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import { createServer as createViteServer } from 'vite'
import { openDb, getState, saveJobs, saveMonth } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const PORT = Number(process.env.PORT) || 3000
const dbFile = process.env.PAYDAY_DB || path.join(root, 'data', 'payday.sqlite')
const db = openDb(dbFile)

const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/api/state', (_req, res) => {
  res.json(getState(db))
})

app.put('/api/jobs', (req, res) => {
  try {
    saveJobs(db, req.body?.jobs || [])
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not save' })
  }
})

app.put('/api/months/:ym', (req, res) => {
  try {
    saveMonth(db, req.params.ym, req.body?.days || {})
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
