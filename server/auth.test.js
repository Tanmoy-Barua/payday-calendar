import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { openDb } from './db.js'
import {
  __test,
  disableLockAuth,
  getAuthStatus,
  loginLock,
  logoutLock,
  requireAuth,
  setupLock,
} from './auth.js'

function mockRes() {
  const headers = {}
  return {
    headers,
    statusCode: 200,
    body: null,
    setHeader(name, value) { headers[name.toLowerCase()] = value },
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

function reqWithCookie(cookie = '') {
  return { headers: { cookie }, secure: false }
}

function cookieFrom(res) {
  const raw = res.headers['set-cookie'] || ''
  const match = String(raw).match(/payday_session=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : ''
}

test('pin hash verifies and rejects wrong codes', () => {
  const stored = __test.hashPin('135790')
  assert.equal(__test.verifyPin('135790', stored), true)
  assert.equal(__test.verifyPin('0000', stored), false)
  assert.throws(() => __test.cleanPin('12'), /4 to 12/)
})

test('server lock blocks state until login, then allows it', async () => {
  const file = path.join(os.tmpdir(), `payday-auth-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = await openDb(file)

  const setupRes = mockRes()
  const setup = setupLock(db, reqWithCookie(), setupRes, { pin: '2468', credId: 'face-1' })
  assert.equal(setup.lockEnabled, true)
  assert.equal(setup.authenticated, true)
  assert.ok(cookieFrom(setupRes))

  const locked = getAuthStatus(db, reqWithCookie())
  assert.equal(locked.lockEnabled, true)
  assert.equal(locked.authenticated, false)

  const blocked = mockRes()
  assert.equal(requireAuth(db, reqWithCookie(), blocked), false)
  assert.equal(blocked.statusCode, 401)

  assert.throws(() => loginLock(db, reqWithCookie(), mockRes(), { pin: '0000' }), /Wrong passcode/)

  const loginRes = mockRes()
  const login = loginLock(db, reqWithCookie(), loginRes, { pin: '2468' })
  assert.equal(login.authenticated, true)
  const session = cookieFrom(loginRes)
  assert.ok(session)
  assert.equal(getAuthStatus(db, reqWithCookie(`payday_session=${session}`)).authenticated, true)

  logoutLock(db, reqWithCookie(`payday_session=${session}`), mockRes())
  assert.equal(getAuthStatus(db, reqWithCookie(`payday_session=${session}`)).authenticated, false)

  const login2 = mockRes()
  loginLock(db, reqWithCookie(), login2, { pin: '2468' })
  const disable = disableLockAuth(
    db,
    reqWithCookie(`payday_session=${cookieFrom(login2)}`),
    mockRes(),
    { pin: '2468' },
  )
  assert.equal(disable.lockEnabled, false)
  assert.equal(getAuthStatus(db, reqWithCookie()).lockEnabled, false)

  fs.rmSync(file, { force: true })
})

test('setup is refused when lock is already on without a session', async () => {
  const file = path.join(os.tmpdir(), `payday-auth2-${process.pid}.sqlite`)
  fs.rmSync(file, { force: true })
  const db = await openDb(file)
  setupLock(db, reqWithCookie(), mockRes(), { pin: '9999' })
  assert.throws(
    () => setupLock(db, reqWithCookie(), mockRes(), { pin: '1111' }),
    /Unlock first/,
  )
  fs.rmSync(file, { force: true })
})
