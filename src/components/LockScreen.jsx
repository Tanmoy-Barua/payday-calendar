import { useEffect, useState } from 'react'
import { getSavedPin, hasLocalFaceId, lockLabel, lockSupported, unlockWithFaceId } from '../lock.js'
import { loginAuth } from '../api.js'

export default function LockScreen({ onUnlocked, onUnlocking, mode = 'unlock', onSetup }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const label = lockLabel()
  const faceReady = mode === 'unlock' && lockSupported() && hasLocalFaceId() && !!getSavedPin()
  const setupMode = mode === 'setup'

  async function unlockWithFace() {
    setBusy(true)
    setError('')
    onUnlocking?.(true)
    try {
      const { pin: savedPin, credId } = await unlockWithFaceId()
      await loginAuth(savedPin, credId)
      onUnlocked()
    } catch (err) {
      const message = String(err?.message || err || '')
      if (/cancel|not allowed|abort/i.test(message)) setError('Unlock cancelled. Only your face can open this.')
      else setError(message || 'Could not unlock.')
    } finally {
      onUnlocking?.(false)
      setBusy(false)
    }
  }

  async function unlockWithPin(event) {
    event?.preventDefault?.()
    setBusy(true)
    setError('')
    onUnlocking?.(true)
    try {
      await loginAuth(pin.trim())
      onUnlocked()
    } catch (err) {
      setError(err?.message || 'Wrong passcode')
    } finally {
      onUnlocking?.(false)
      setBusy(false)
    }
  }

  async function finishSetup(event) {
    event?.preventDefault?.()
    setBusy(true)
    setError('')
    onUnlocking?.(true)
    try {
      if (pin.trim() !== pin2.trim()) throw new Error('Passcodes do not match')
      await onSetup?.(pin.trim())
      onUnlocked()
    } catch (err) {
      const message = String(err?.message || err || '')
      if (/cancel|not allowed|abort/i.test(message)) setError('Setup cancelled')
      else setError(message || 'Could not turn on lock')
    } finally {
      onUnlocking?.(false)
      setBusy(false)
    }
  }

  useEffect(() => {
    if (setupMode || !faceReady) return undefined
    unlockWithFace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (setupMode) {
    return (
      <div className="wrap lock-wrap">
        <section className="card lock-card">
          <div className="label">Protect this site</div>
          <h1>Payday Calendar</h1>
          <p className="note">
            Choose a passcode. Other browsers need this passcode. On this phone, {label} will unlock it for you.
          </p>
          <form className="lock-form" onSubmit={finishSetup}>
            <label className="field">
              <span>Passcode (4–12 digits)</span>
              <input
                inputMode="numeric"
                autoComplete="new-password"
                pattern="\d{4,12}"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
                required
              />
            </label>
            <label className="field">
              <span>Confirm passcode</span>
              <input
                inputMode="numeric"
                autoComplete="new-password"
                pattern="\d{4,12}"
                value={pin2}
                onChange={e => setPin2(e.target.value.replace(/\D/g, '').slice(0, 12))}
                required
              />
            </label>
            {error ? <p className="note bad">{error}</p> : null}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Look at the phone…' : `Save passcode & turn on ${label}`}
            </button>
          </form>
        </section>
      </div>
    )
  }

  return (
    <div className="wrap lock-wrap">
      <section className="card lock-card">
        <div className="label">Locked on the server</div>
        <h1>Payday Calendar</h1>
        <p className="note">
          {faceReady
            ? `Unlock with your ${label}, or enter the passcode.`
            : 'Enter the passcode to open calendar, spending, and debt on this browser.'}
        </p>
        {faceReady ? (
          <button className="btn primary" type="button" disabled={busy} onClick={unlockWithFace}>
            {busy ? 'Look at the phone…' : `Unlock with ${label}`}
          </button>
        ) : null}
        <form className="lock-form" onSubmit={unlockWithPin}>
          <label className="field">
            <span>Passcode</span>
            <input
              inputMode="numeric"
              autoComplete="current-password"
              pattern="\d{4,12}"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
              required
            />
          </label>
          {error ? <p className="note bad">{error}</p> : null}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Unlock with passcode'}
          </button>
        </form>
      </section>
    </div>
  )
}
