import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCK_CRED_KEY,
  LOCK_ON_KEY,
  UNLOCKED_KEY,
  clearUnlocked,
  disableLock,
  fromBase64Url,
  isLockEnabled,
  isUnlocked,
  markUnlocked,
  sameCredential,
  toBase64Url,
  userVerified,
} from './lock.js'

function memoryStore(start = {}) {
  const data = { ...start }
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null },
    setItem(key, value) { data[key] = String(value) },
    removeItem(key) { delete data[key] },
  }
}

test('credential ids round-trip through base64url', () => {
  const bytes = new Uint8Array([1, 2, 250, 255, 0, 64])
  const encoded = toBase64Url(bytes)
  assert.equal(encoded.includes('+'), false)
  assert.equal(encoded.includes('/'), false)
  assert.deepEqual(new Uint8Array(fromBase64Url(encoded)), bytes)
})

test('lock is enabled only with a saved Face ID credential', () => {
  const local = memoryStore()
  assert.equal(isLockEnabled(local), false)
  local.setItem(LOCK_ON_KEY, '1')
  assert.equal(isLockEnabled(local), false)
  local.setItem(LOCK_CRED_KEY, 'abc')
  assert.equal(isLockEnabled(local), true)
})

test('session unlock can be set and cleared', () => {
  const session = memoryStore()
  assert.equal(isUnlocked(session), false)
  markUnlocked(session)
  assert.equal(isUnlocked(session), true)
  clearUnlocked(session)
  assert.equal(isUnlocked(session), false)
})

test('disable lock clears saved Face ID and session unlock', () => {
  const local = memoryStore({ [LOCK_ON_KEY]: '1', [LOCK_CRED_KEY]: 'abc' })
  const session = memoryStore({ [UNLOCKED_KEY]: '1' })
  disableLock(local, session)
  assert.equal(isLockEnabled(local), false)
  assert.equal(isUnlocked(session), false)
})

test('only the saved Face ID credential is accepted', () => {
  const mine = new Uint8Array([9, 8, 7, 6]).buffer
  const other = new Uint8Array([1, 2, 3, 4]).buffer
  const stored = toBase64Url(mine)
  assert.equal(sameCredential(stored, mine), true)
  assert.equal(sameCredential(stored, other), false)
})

test('unlock requires the user-verified Face ID flag', () => {
  const data = new Uint8Array(37)
  assert.equal(userVerified(data), false)
  data[32] = 0x04
  assert.equal(userVerified(data), true)
})
