export const LOCK_ON_KEY = 'payday-lock-on'
export const LOCK_CRED_KEY = 'payday-lock-cred'
export const UNLOCKED_KEY = 'payday-unlocked'

export function toBase64Url(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function fromBase64Url(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/')
  const fill = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const binary = atob(fill)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function userVerified(authenticatorData) {
  const bytes = authenticatorData instanceof ArrayBuffer
    ? new Uint8Array(authenticatorData)
    : new Uint8Array(authenticatorData || [])
  if (bytes.length < 33) return false
  return (bytes[32] & 0x04) !== 0
}

export function sameCredential(storedId, rawId) {
  if (!storedId || !rawId) return false
  return storedId === toBase64Url(rawId)
}

export function lockSupported() {
  return typeof window !== 'undefined'
    && !!window.PublicKeyCredential
    && typeof navigator.credentials?.create === 'function'
    && typeof navigator.credentials?.get === 'function'
    && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')
}

export function isLockEnabled(storage = localStorage) {
  return storage.getItem(LOCK_ON_KEY) === '1' && !!storage.getItem(LOCK_CRED_KEY)
}

export function isUnlocked(storage = sessionStorage) {
  return storage.getItem(UNLOCKED_KEY) === '1'
}

export function markUnlocked(storage = sessionStorage) {
  storage.setItem(UNLOCKED_KEY, '1')
}

export function clearUnlocked(storage = sessionStorage) {
  storage.removeItem(UNLOCKED_KEY)
}

export function disableLock(local = localStorage, session = sessionStorage) {
  local.removeItem(LOCK_ON_KEY)
  local.removeItem(LOCK_CRED_KEY)
  session.removeItem(UNLOCKED_KEY)
}

function rpId() {
  return location.hostname
}

function randomChallenge() {
  return crypto.getRandomValues(new Uint8Array(32))
}

export async function registerLock() {
  if (!lockSupported()) throw new Error('Face ID unlock is not available on this device or browser.')
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: 'Payday Calendar', id: rpId() },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'owner',
        displayName: 'Payday Calendar owner',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      attestation: 'none',
      timeout: 60_000,
    },
  })
  if (!credential?.rawId) throw new Error('Could not set up Face ID.')
  const attested = credential.response?.getAuthenticatorData?.()
    || credential.response?.authenticatorData
  if (attested && !userVerified(attested)) {
    throw new Error('Face ID did not confirm it was you. Try again.')
  }
  localStorage.setItem(LOCK_CRED_KEY, toBase64Url(credential.rawId))
  localStorage.setItem(LOCK_ON_KEY, '1')
  markUnlocked()
  return true
}

export async function unlockWithFaceId() {
  if (!lockSupported()) throw new Error('Face ID unlock is not available on this device or browser.')
  const stored = localStorage.getItem(LOCK_CRED_KEY)
  if (!stored) throw new Error('Face ID is not set up yet.')
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      rpId: rpId(),
      allowCredentials: [{
        type: 'public-key',
        id: fromBase64Url(stored),
        transports: ['internal'],
      }],
      userVerification: 'required',
      timeout: 60_000,
    },
  })
  if (!assertion) throw new Error('Unlock was cancelled.')
  if (!sameCredential(stored, assertion.rawId)) {
    throw new Error('This Face ID is not the one saved for Payday Calendar.')
  }
  if (!userVerified(assertion.response.authenticatorData)) {
    throw new Error('Face ID did not confirm it was you. Try again.')
  }
  markUnlocked()
  return true
}

export function lockLabel() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'Face ID'
  if (/Mac/i.test(ua)) return 'Touch ID'
  if (/Windows/i.test(ua)) return 'Windows Hello'
  if (/Android/i.test(ua)) return 'device unlock'
  return 'Face ID'
}
