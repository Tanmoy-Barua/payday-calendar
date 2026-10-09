import crypto from 'node:crypto'
import { loadMailConfig, maskEmail, otpMailConfigured, sendLoginOtp } from './mail.js'

const COOKIE = 'payday_session'
const PBKDF2_ROUNDS = 120_000
const OTP_TTL_MS = 10 * 60 * 1000
const OTP_RESEND_MS = 60 * 1000
const OTP_MAX_ATTEMPTS = 5

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
    CREATE TABLE IF NOT EXISTS otp_codes (
      email TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      expires REAL NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      sent_at REAL NOT NULL
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

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex')
}

function dbFileOf(db) {
  return db.__file || process.env.PAYDAY_DB || ''
}

export function getAuthStatus(db, req) {
  const lock = db.prepare('SELECT enabled, cred_id FROM app_lock WHERE id = 1').get() || { enabled: 0, cred_id: null }
  const otpEnabled = otpMailConfigured(dbFileOf(db))
  const lockEnabled = !!lock.enabled
  const loginRequired = otpEnabled || lockEnabled
  const session = loginRequired ? readSession(db, req, { touch: false }) : null
  const cfg = loadMailConfig(dbFileOf(db))
  return {
    loginRequired,
    otpEnabled,
    lockEnabled,
    authenticated: loginRequired ? !!session : true,
    hasServerCred: !!lock.cred_id,
    ownerHint: otpEnabled ? maskEmail(cfg.ownerEmail) : '',
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
  if (!status.loginRequired) return true
  const session = readSession(db, req, { touch: true })
  if (!session) {
    res.status(401).json({ error: 'locked', loginRequired: true, authenticated: false })
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
  if (!lock?.enabled) {
    if (otpMailConfigured(dbFileOf(db))) throw new Error('Use the email login code')
    return { ok: true, lockEnabled: false, authenticated: true }
  }
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
  if (!otpMailConfigured(dbFileOf(db))) db.exec('DELETE FROM sessions')
  res.setHeader('Set-Cookie', clearCookie(isSecure(req)))
  return { ok: true, lockEnabled: false, authenticated: true }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export async function requestOtp(db, body, { send = sendLoginOtp } = {}) {
  const cfg = loadMailConfig(dbFileOf(db))
  if (!cfg.ownerEmail || !cfg.gmailUser || !cfg.gmailAppPassword) {
    throw new Error('Gmail login is not configured')
  }
  const email = normalizeEmail(body?.email)
  if (!email || email !== cfg.ownerEmail) {
    throw new Error('That email cannot sign in')
  }
  const now = Date.now()
  const existing = db.prepare('SELECT sent_at FROM otp_codes WHERE email = ?').get(email)
  if (existing && now - Number(existing.sent_at) < OTP_RESEND_MS) {
    throw new Error('Wait a minute before requesting another code')
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const expires = now + OTP_TTL_MS
  db.prepare('DELETE FROM otp_codes WHERE email = ?').run(email)
  db.prepare(`
    INSERT INTO otp_codes (email, code_hash, expires, attempts, sent_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(email, hashOtp(code), expires, now)

  const debug = process.env.PAYDAY_OTP_DEBUG === '1'
  if (!debug) await send(dbFileOf(db), code)

  const result = {
    ok: true,
    sent: true,
    ownerHint: maskEmail(email),
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
  }
  if (debug) result.debugCode = code
  return result
}

export function verifyOtp(db, req, res, body) {
  const cfg = loadMailConfig(dbFileOf(db))
  if (!cfg.ownerEmail) throw new Error('Gmail login is not configured')
  const email = normalizeEmail(body?.email)
  const code = String(body?.code || '').trim()
  if (email !== cfg.ownerEmail) throw new Error('That email cannot sign in')
  if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code')

  const now = Date.now()
  db.prepare('DELETE FROM otp_codes WHERE expires < ?').run(now)
  const row = db.prepare('SELECT code_hash, expires, attempts FROM otp_codes WHERE email = ?').get(email)
  if (!row || Number(row.expires) < now) throw new Error('Code expired. Request a new one.')
  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) throw new Error('Too many tries. Request a new code.')

  if (hashOtp(code) !== row.code_hash) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?').run(email)
    throw new Error('Wrong code')
  }

  db.prepare('DELETE FROM otp_codes WHERE email = ?').run(email)
  const session = createSession(db)
  writeSessionCookie(req, res, session)
  return {
    ok: true,
    authenticated: true,
    loginRequired: true,
    idleMs: sessionIdleMs(),
  }
}

export function touchAuth(db, req, res) {
  const status = getAuthStatus(db, req)
  if (!status.loginRequired) return { ok: true, authenticated: true, idleMs: sessionIdleMs() }
  const session = readSession(db, req, { touch: true })
  if (!session) {
    res.status(401)
    return { ok: false, authenticated: false, loginRequired: true }
  }
  writeSessionCookie(req, res, session)
  return { ok: true, authenticated: true, idleMs: sessionIdleMs(), expiresAt: session.expires }
}

export const __test = {
  hashPin,
  verifyPin,
  cleanPin,
  hashOtp,
  COOKIE,
  sessionIdleMs,
}
