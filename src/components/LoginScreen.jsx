import { useState } from 'react'
import { requestOtp, verifyOtp } from '../api.js'

export default function LoginScreen({ ownerHint = '', onLoggedIn }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState(ownerHint ? `Codes go to ${ownerHint}` : '')

  async function sendCode(event) {
    event?.preventDefault?.()
    setBusy(true)
    setError('')
    try {
      const result = await requestOtp(email.trim())
      setSent(true)
      setNote(result.ownerHint ? `Code sent to ${result.ownerHint}` : 'Check your Gmail for the code')
      if (result.debugCode) setCode(result.debugCode)
    } catch (err) {
      setError(err?.message || 'Could not send code')
    } finally {
      setBusy(false)
    }
  }

  async function verify(event) {
    event?.preventDefault?.()
    setBusy(true)
    setError('')
    try {
      await verifyOtp(email.trim(), code.trim())
      onLoggedIn?.()
    } catch (err) {
      setError(err?.message || 'Could not verify code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrap lock-wrap">
      <section className="card lock-card">
        <div className="label">Gmail login</div>
        <h1>Payday Calendar</h1>
        <p className="note">
          Sign in with a one-time code sent to your Gmail. Your session lasts 1 hour of activity.
        </p>
        {!sent ? (
          <form className="lock-form" onSubmit={sendCode}>
            <label className="field">
              <span>Gmail</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </label>
            {note ? <p className="note">{note}</p> : null}
            {error ? <p className="note bad">{error}</p> : null}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send login code'}
            </button>
          </form>
        ) : (
          <form className="lock-form" onSubmit={verify}>
            <label className="field">
              <span>6-digit code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
            </label>
            {note ? <p className="note">{note}</p> : null}
            {error ? <p className="note bad">{error}</p> : null}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Log in'}
            </button>
            <button className="btn ghost" type="button" disabled={busy} onClick={sendCode}>
              Resend code
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
