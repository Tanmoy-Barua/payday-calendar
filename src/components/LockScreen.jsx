import { useEffect, useState } from 'react'
import { lockLabel, unlockWithFaceId } from '../lock.js'

export default function LockScreen({ onUnlocked, onUnlocking }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = lockLabel()

  async function unlock() {
    setBusy(true)
    setError('')
    onUnlocking?.(true)
    try {
      await unlockWithFaceId()
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

  useEffect(() => {
    unlock()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="wrap lock-wrap">
      <section className="card lock-card">
        <div className="label">Only your face</div>
        <h1>Payday Calendar</h1>
        <p className="note">
          This opens only with the {label} saved on this phone. Someone else’s face will not unlock it.
        </p>
        {error ? <p className="note bad">{error}</p> : null}
        <button className="btn primary" type="button" disabled={busy} onClick={unlock}>
          {busy ? 'Look at the phone…' : `Unlock with ${label}`}
        </button>
        <p className="note">
          Tip: in iPhone Settings → Face ID &amp; Passcode, keep only your face enrolled, and do not share your passcode.
        </p>
      </section>
    </div>
  )
}
