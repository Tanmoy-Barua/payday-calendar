import crypto from 'node:crypto'

const COOKIE = 'payday_session'
const PBKDF2_ROUNDS = 120_000

export function sessionIdleMs() {
  const raw = Number(process.env.PAYDAY_SESSION_IDLE_MS)
  if (Number.isFinite(raw) && raw > 0) return raw
  return 60 * 60 * 1000
}

export function ensureAuthTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      pin_hash TEXT,
      cred_id TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      expires REAL NOT NULL
    );
  `)
  const row = db.prepare('SELECT id FROM app_lock WHERE id = 1').get()
  if (!row) db.prepare('INSERT INTO app_lock (id, enabled) VALUES (1, 0)').run()
}

function hashPin(pin, salt = crypto.randomBytes(16)) {
  const hash = crypto.pbkdf2Sync(String(pin), salt, PBKDF2_ROUNDS, 32, 'sha256')
  return `pbkdf2:${PBKDF2_ROUNDS}:${salt.toString('hex')}:${hash.toString('hex')}`
}

function verifyPin(pin, stored) {
  if (!stored || !String(pin || '')) return false
  const parts = String(stored).split(':')
  if (parts[0] === 'pbkdf2' && parts.length === 4) {
    const rounds = Number(parts[1])
    const salt = Buffer.from(parts[2], 'hex')
    const expected = Buffer.from(parts[3], 'hex')
    const hash = crypto.pbkdf2Sync(String(pin), salt, rounds, expected.length, 'sha256')
    if (hash.length !== expected.length) return false
    return crypto.timingSafeEqual(hash, expected)
  }
  // Legacy scrypt format from earlier drafts: salt:hash
  if (parts.length === 2) {
    const [saltHex, hashHex] = parts
    if (!saltHex || !hashHex) return false
    const hash = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32)
    const expected = Buffer.from(hashHex, 'hex')
    if (hash.length !== expected.length) return false
    return crypto.timingSafeEqual(hash, expected)
  }
  return false
}

function cleanPin(pin) {
  const value = String(pin || '').trim()
  if (!/^\d{4,12}$/.test(value)) throw new Error('Passcode must be 4 to 12 digits')
  return value
}

export function getAuthStatus(db, req) {
  const lock = db.prepare('SELECT enabled, cred_id FROM app_lock WHERE id = 1').get() || { enabled: 0, cred_id: null }
  const enabled = !!lock.enabled
  const authenticated = enabled ? !!readSession(db, req, { touch: false }) : true
  return {
    lockEnabled: enabled,
    authenticated,
    hasServerCred: !!lock.cred_id,
    idleMs: sessionIdleMs(),
  }
}

function readCookie(req, name) {
  const header = req.headers?.cookie || ''
  const parts = header.split(';')
  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

function readSession(db, req, { touch = false } = {}) {
  const token = readCookie(req, COOKIE)
  if (!token) return null
  const now = Date.now()
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(now)
  const row = db.prepare('SELECT token, expires FROM sessions WHERE token = ? AND expires >= ?').get(token, now)
  if (!row) return null
  if (touch) {
    const expires = now + sessionIdleMs()
    db.prepare('UPDATE sessions SET expires = ? WHERE token = ?').run(expires, token)
    return { token, expires }
  }
  return { token, expires: row.expires }
}

function createSession(db) {
  const token = crypto.randomBytes(24).toString('hex')
  const expires = Date.now() + sessionIdleMs()
  db.prepare('INSERT INTO sessions (token, expires) VALUES (?, ?)').run(token, expires)
  return { token, expires }
}

function sessionCookie(token, expires, secure) {
  const maxAge = Math.max(0, Math.floor((expires - Date.now()) / 1000))
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

function clearCookie(secure) {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

function isSecure(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https'
}

function writeSessionCookie(req, res, session) {
  res.setHeader('Set-Cookie', sessionCookie(session.token, session.expires, isSecure(req)))
}

export function requireAuth(db, req, res) {
  const status = getAuthStatus(db, req)
  if (!status.lockEnabled) return true
  const session = readSession(db, req, { touch: true })
  if (!session) {
    res.status(401).json({ error: 'locked', lockEnabled: true, authenticated: false })
    return false
  }
  writeSessionCookie(req, res, session)
  return true
}

export function setupLock(db, req, res, body) {
  const existing = db.prepare('SELECT enabled FROM app_lock WHERE id = 1').get()
  if (existing?.enabled && !readSession(db, req)) {
    throw new Error('Already locked. Unlock first.')
  }
  const pin = cleanPin(body?.pin)
  const credId = String(body?.credId || '').slice(0, 255)
  const pinHash = hashPin(pin)
  db.prepare('UPDATE app_lock SET enabled = 1, pin_hash = ?, cred_id = ? WHERE id = 1').run(pinHash, credId || null)
  db.exec('DELETE FROM sessions')
  const session = createSession(db)
  writeSessionCookie(req, res, session)
  return { ok: true, lockEnabled: true, authenticated: true, idleMs: sessionIdleMs() }
}

export function loginLock(db, req, res, body) {
  const lock = db.prepare('SELECT enabled, pin_hash, cred_id FROM app_lock WHERE id = 1').get()
  if (!lock?.enabled) return { ok: true, lockEnabled: false, authenticated: true, idleMs: sessionIdleMs() }
  const pin = String(body?.pin || '')
  const deviceCred = String(body?.credId || '')
  if (!verifyPin(pin, lock.pin_hash)) throw new Error('Wrong passcode')
  if (deviceCred && lock.cred_id && deviceCred !== lock.cred_id) {
    throw new Error('This device is not enrolled')
  }
  const session = createSession(db)
  writeSessionCookie(req, res, session)
  return { ok: true, lockEnabled: true, authenticated: true, idleMs: sessionIdleMs() }
}

export function logoutLock(db, req, res) {
  const token = readCookie(req, COOKIE)
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  res.setHeader('Set-Cookie', clearCookie(isSecure(req)))
  return { ok: true }
}

export function disableLockAuth(db, req, res, body) {
  const lock = db.prepare('SELECT enabled, pin_hash FROM app_lock WHERE id = 1').get()
  if (!lock?.enabled) {
    res.setHeader('Set-Cookie', clearCookie(isSecure(req)))
    return { ok: true, lockEnabled: false, authenticated: true }
  }
  if (!verifyPin(body?.pin, lock.pin_hash)) throw new Error('Wrong passcode')
  db.prepare('UPDATE app_lock SET enabled = 0, pin_hash = NULL, cred_id = NULL WHERE id = 1').run()
  db.exec('DELETE FROM sessions')
  res.setHeader('Set-Cookie', clearCookie(isSecure(req)))
  return { ok: true, lockEnabled: false, authenticated: true }
}

export function touchAuth(db, req, res) {
  const status = getAuthStatus(db, req)
  if (!status.lockEnabled) return { ok: true, authenticated: true, idleMs: sessionIdleMs() }
  const session = readSession(db, req, { touch: true })
  if (!session) {
    res.status(401)
    return { ok: false, authenticated: false, lockEnabled: true }
  }
  writeSessionCookie(req, res, session)
  return { ok: true, authenticated: true, idleMs: sessionIdleMs(), expiresAt: session.expires }
}

export const __test = { hashPin, verifyPin, cleanPin, COOKIE, sessionIdleMs }
