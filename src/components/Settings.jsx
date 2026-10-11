import { useState } from 'react'
import { THEME_OPTIONS, formatIdleLabel } from '../settings.js'
import { lockLabel, lockSupported } from '../lock.js'

export default function Settings({
  theme,
  onThemeChange,
  lockOn,
  lockBusy,
  idleMs,
  jobs = [],
  jobsCount,
  connecteamUrl,
  connecteamJobId,
  connecteamBusy,
  connecteamMessage,
  onConnecteamUrlChange,
  onConnecteamJobChange,
  onSyncConnecteam,
  onStartLockSetup,
  onLockNow,
  onTurnOffLock,
  onOpenPaySchedules,
}) {
  const faceLabel = lockLabel()
  const faceOk = lockSupported()
  const [urlDraft, setUrlDraft] = useState(connecteamUrl || '')

  return (
    <div className="settings">
      <section className="card">
        <div className="label">Settings</div>
        <h2>Control how Payday Calendar works</h2>
        <p className="note">
          Appearance, lock protection, and session rules live here so the main pages stay clear.
        </p>
      </section>

      <section className="card">
        <div className="label">Appearance</div>
        <h3>Theme</h3>
        <p className="note">Choose light, dark, or match this phone’s setting.</p>
        <div className="settings-choices" role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map(option => (
            <label key={option.id} className={`settings-choice${theme === option.id ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="theme"
                value={option.id}
                checked={theme === option.id}
                onChange={() => onThemeChange(option.id)}
              />
              <span>
                <strong>{option.label}</strong>
                <span className="note">{option.note}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="label">Connecteam</div>
        <h3>Import your work schedule</h3>
        <p className="note">
          In Connecteam → Settings → calendar sync, copy the private calendar URL, paste it here, then sync.
          Shifts become hours on your calendar for the pay schedule you pick. Manual logs are kept.
        </p>
        <label className="field">
          <span className="label">Connecteam calendar URL</span>
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://s3…amazonaws.com/… (from Connecteam Copy)"
            value={urlDraft}
            onChange={ev => setUrlDraft(ev.target.value)}
            onBlur={() => onConnecteamUrlChange?.(urlDraft)}
          />
        </label>
        <label className="field">
          <span className="label">Attach shifts to pay schedule</span>
          <select
            value={connecteamJobId || ''}
            onChange={ev => onConnecteamJobChange?.(ev.target.value)}
            disabled={!jobs.length}
          >
            {!jobs.length ? <option value="">Add a pay schedule first</option> : null}
            {jobs.map(job => (
              <option key={job.id} value={job.id}>
                {job.name}{job.rate ? ` · $${Number(job.rate).toFixed(2)}/h` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="settings-actions">
          <button
            className="btn primary"
            type="button"
            disabled={connecteamBusy || !jobs.length}
            onClick={() => {
              onConnecteamUrlChange?.(urlDraft)
              onSyncConnecteam?.(urlDraft)
            }}
          >
            {connecteamBusy ? 'Syncing…' : 'Sync shifts now'}
          </button>
        </div>
        {connecteamMessage ? <p className="note">{connecteamMessage}</p> : null}
      </section>

      <section className="card">
        <div className="label">Security</div>
        <h3>Site lock</h3>
        <p className="note">
          {lockOn
            ? `Lock is on. Other browsers need your passcode. On this phone, ${faceLabel} can unlock it.`
            : `Turn on a passcode lock so calendar, spending, debt, and checklist stay private. On iPhone Safari, ${faceLabel} can unlock for you.`}
        </p>
        <div className="settings-status">
          <div>
            <div className="label">Status</div>
            <div className="num">{lockOn ? 'Protected' : 'Open'}</div>
          </div>
          <div>
            <div className="label">{faceLabel}</div>
            <div className="note">{faceOk ? 'Available in this browser' : 'Not available here — use Safari on iPhone'}</div>
          </div>
        </div>
        <div className="settings-actions">
          {lockOn ? (
            <>
              <button className="btn primary" type="button" onClick={onLockNow}>Lock now</button>
              <button className="btn" type="button" disabled={lockBusy} onClick={onTurnOffLock}>
                Turn off lock
              </button>
            </>
          ) : (
            <button className="btn primary" type="button" disabled={lockBusy} onClick={onStartLockSetup}>
              {lockBusy ? 'Look at the phone…' : `Protect with ${faceLabel} + passcode`}
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <div className="label">Session</div>
        <h3>Stay signed in while active</h3>
        <p className="note">
          After you unlock, the site stays open while you use it. Switching apps does not log you out.
          If there is no activity for {formatIdleLabel(idleMs)}, you will need to unlock again.
        </p>
        <div className="settings-status">
          <div>
            <div className="label">Idle timeout</div>
            <div className="num">{formatIdleLabel(idleMs)}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="label">Pay schedules</div>
        <h3>Jobs and payday rules</h3>
        <p className="note">
          {jobsCount
            ? `You have ${jobsCount} pay schedule${jobsCount === 1 ? '' : 's'}. Edit names, rates, and payday timing from the calendar side panel.`
            : 'Add a pay schedule so the calendar can mark paydays and fill checklist starting amounts.'}
        </p>
        <div className="settings-actions">
          <button className="btn primary" type="button" onClick={onOpenPaySchedules}>
            {jobsCount ? 'Manage pay schedules' : 'Add pay schedule'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="label">About</div>
        <h3>Payday Calendar</h3>
        <p className="note">
          Track hours toward each paycheck, plan spending, pay down debt, and run a paycheck notepad checklist.
          Your data is saved in this site’s database.
        </p>
      </section>
    </div>
  )
}
