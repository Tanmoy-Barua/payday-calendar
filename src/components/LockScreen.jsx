import { useState } from 'react'
import { lockLabel, unlockWithFaceId } from '../lock.js'

export default function LockScreen({ onUnlocked }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = lockLabel()

  async function unlock() {
    setBusy(true)
    setError('')
    try {
      await unlockWithFaceId()
      onUnlocked()
    } catch (err) {
      const message = String(err?.message || err || '')
      if (/cancel|not allowed|abort/i.test(message)) setError('Unlock cancelled. Try again.')
      else setError(message || 'Could not unlock.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrap lock-wrap">
      <section className="card lock-card">
        <div className="label">Protected</div>
        <h1>Payday Calendar</h1>
        <p className="note">Use {label} to open your paycheck, spending, and debt records.</p>
        {error ? <p className="note bad">{error}</p> : null}
        <button className="btn primary" type="button" disabled={busy} onClick={unlock}>
          {busy ? 'Waiting…' : `Unlock with ${label}`}
        </button>
      </section>
    </div>
  )
}
