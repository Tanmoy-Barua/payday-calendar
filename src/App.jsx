import { useEffect, useRef, useState } from 'react'
import { fmtTodayLine, hrs, localToday, money, fmtShort } from './dates.js'
import {
  disableAuth,
  fetchCalendarFeed,
  loadAuthStatus,
  loadState,
  logoutAuth,
  saveBudget,
  saveDebts,
  saveJobs,
  saveMonth,
  setupAuth,
  touchAuth,
} from './api.js'
import {
  applyConnecteamShifts,
  loadConnecteamJobId,
  loadConnecteamUrl,
  saveConnecteamJobId,
  saveConnecteamUrl,
} from './connecteam.js'
import {
  clearUnlocked,
  disableLock,
  lockLabel,
  lockSupported,
  registerLock,
} from './lock.js'
import Cards from './components/Cards.jsx'
import Calendar from './components/Calendar.jsx'
import EarningsSummary from './components/EarningsSummary.jsx'
import PastPaychecks from './components/PastPaychecks.jsx'
import Side from './components/Side.jsx'
import Spend from './components/Spend.jsx'
import Debt from './components/Debt.jsx'
import Checklist from './components/Checklist.jsx'
import Settings from './components/Settings.jsx'
import LockScreen from './components/LockScreen.jsx'
import { defaultBudgetNote } from './checklist.js'
import { applyTheme, loadTheme } from './settings.js'

const today = localToday()
const DEFAULT_IDLE_MS = 60 * 60 * 1000

function pageFromHash() {
  if (location.hash === '#spend') return 'spend'
  if (location.hash === '#debt') return 'debt'
  if (location.hash === '#checklist') return 'checklist'
  if (location.hash === '#settings') return 'settings'
  return 'calendar'
}

const NAV_PATHS = {
  calendar: 'M8 3v3M16 3v3M5 8h14M6.5 5.5h11A1.5 1.5 0 0 1 19 7v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5V7a1.5 1.5 0 0 1 1.5-1.5ZM9 12h2.2M12.8 12H15M9 15.5h2.2M12.8 15.5H15',
  spend: 'M4 9.5h16v9A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-9ZM7 6.5h10l1.8 3H5.2L7 6.5ZM12 13v4.2M10.2 15.1h3.6',
  debt: 'M4.5 9h15A1.5 1.5 0 0 1 21 10.5v7A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-7A1.5 1.5 0 0 1 4.5 9Zm0 3.2h15M7 15.5h4',
  checklist: 'M9 7h10M9 12h10M9 17h7M5.2 7l1.3 1.3L8.8 6M5.2 12l1.3 1.3L8.8 11M5.2 17l1.3 1.3L8.8 16',
}

function NavIcon({ name }) {
  if (name === 'settings') {
    return (
      <svg className="nav-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          d="M12 4.2v2.2M12 17.6v2.2M4.2 12h2.2M17.6 12h2.2M6.5 6.5l1.6 1.6M15.9 15.9l1.6 1.6M6.5 17.5l1.6-1.6M15.9 8.1l1.6-1.6"
        />
      </svg>
    )
  }
  const d = NAV_PATHS[name]
  if (!d) return null
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

export default function App() {
  const [jobs, setJobs] = useState([])
  const [months, setMonths] = useState({})
  const [debts, setDebts] = useState([])
  const [budget, setBudget] = useState(() => defaultBudgetNote())
  const [view, setView] = useState(today.slice(0, 7))
  const [selected, setSelected] = useState(today)
  const [mode, setMode] = useState('day')
  const [editingJob, setEditingJob] = useState(null)
  const [filter, setFilter] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [flash, setFlash] = useState(null)
  const [focusTick, setFocusTick] = useState(0)
  const [status, setStatus] = useState('Loading…')
  const [ready, setReady] = useState(false)
  const [page, setPage] = useState(pageFromHash)
  const [authReady, setAuthReady] = useState(false)
  const [lockOn, setLockOn] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [lockBusy, setLockBusy] = useState(false)
  const [idleMs, setIdleMs] = useState(DEFAULT_IDLE_MS)
  const [theme, setTheme] = useState(() => loadTheme())
  const [connecteamUrl, setConnecteamUrl] = useState(() => loadConnecteamUrl())
  const [connecteamJobId, setConnecteamJobId] = useState(() => loadConnecteamJobId())
  const [connecteamBusy, setConnecteamBusy] = useState(false)
  const [connecteamMessage, setConnecteamMessage] = useState('')
  const unlockingRef = useRef(false)
  const idleTimerRef = useRef(null)
  const lastTouchRef = useRef(0)

  function changeTheme(next) {
    setTheme(applyTheme(next))
  }

  function changeConnecteamUrl(next) {
    try {
      const saved = saveConnecteamUrl(next)
      setConnecteamUrl(saved)
      setConnecteamMessage(saved ? 'Calendar link saved on this phone.' : 'Calendar link cleared.')
    } catch (err) {
      setConnecteamMessage(err.message || 'Could not save calendar link')
    }
  }

  function changeConnecteamJob(jobId) {
    setConnecteamJobId(saveConnecteamJobId(jobId))
  }

  async function syncConnecteam(urlOverride) {
    const url = String(urlOverride ?? connecteamUrl).trim()
    const jobId = connecteamJobId || jobs[0]?.id || ''
    if (!jobId) {
      setConnecteamMessage('Add a pay schedule first, then sync.')
      return
    }
    if (!connecteamJobId && jobs[0]?.id) changeConnecteamJob(jobs[0].id)
    setConnecteamBusy(true)
    setConnecteamMessage('Downloading Connecteam calendar…')
    try {
      if (url) saveConnecteamUrl(url)
      setConnecteamUrl(url)
      const data = await fetchCalendarFeed(url)
      const shifts = data.shifts || []
      const job = jobs.find(j => j.id === jobId) || jobs[0]
      if (!shifts.length) {
        setConnecteamMessage(
          'No shifts found in that calendar feed yet. Pasting the link alone does not import hours — tap Sync again after Connecteam publishes shifts. Existing calendar hours were left unchanged.',
        )
        setStatus('Saved')
        return
      }
      const { months: nextMonths, added, days } = applyConnecteamShifts(months, shifts, {
        jobId: job.id,
        rate: job.rate,
      })
      setMonths(nextMonths)
      const monthKeys = new Set([
        ...Object.keys(months || {}),
        ...Object.keys(nextMonths || {}),
      ])
      setStatus('Saving…')
      for (const mk of monthKeys) {
        await saveMonth(mk, nextMonths[mk]?.days || {})
      }
      setStatus('Saved')
      const rateNote = Number(job.rate) > 0
        ? ''
        : ' Tip: set an hourly rate on this pay schedule so Calendar shows $ amounts (hours still count).'
      setConnecteamMessage(
        added
          ? `Updated ${days} day${days === 1 ? '' : 's'} (${added} shift${added === 1 ? '' : 's'}) on ${job.name}. Tap a day on Calendar to see start–end times.${rateNote}`
          : 'No shifts found in that calendar feed yet. Existing calendar hours were left unchanged.',
      )
    } catch (err) {
      setConnecteamMessage(err.message || 'Could not sync Connecteam calendar')
      setStatus('Could not save, try again')
    } finally {
      setConnecteamBusy(false)
    }
  }

  function clearPrivateData(message = 'Locked') {
    clearUnlocked()
    setUnlocked(false)
    setReady(false)
    setJobs([])
    setMonths({})
    setDebts([])
    setBudget(defaultBudgetNote())
    setStatus(message)
  }

  useEffect(() => {
    const sync = () => setPage(pageFromHash())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    let cancel = false
    loadAuthStatus().then(auth => {
      if (cancel) return
      setLockOn(!!auth.lockEnabled)
      setIdleMs(Number(auth.idleMs) > 0 ? Number(auth.idleMs) : DEFAULT_IDLE_MS)
      setUnlocked(!auth.lockEnabled || !!auth.authenticated)
      setAuthReady(true)
    }).catch(() => {
      if (cancel) return
      setLockOn(false)
      setUnlocked(true)
      setAuthReady(true)
    })
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    if (!authReady || !unlocked) return undefined
    let cancel = false
    setStatus('Loading…')
    loadState().then(data => {
      if (cancel) return
      setJobs(data.jobs || [])
      setMonths(data.months || {})
      setDebts(data.debts || [])
      setBudget(data.budget || defaultBudgetNote())
      setFilter(data.jobs?.[0]?.id || null)
      setStatus('Saved to the database')
      setReady(true)
    }).catch(err => {
      if (cancel) return
      if (err?.status === 401 || err?.data?.error === 'locked') {
        setLockOn(true)
        clearPrivateData('Session ended')
        return
      }
      setStatus('Could not load the database')
    })
    return () => { cancel = true }
  }, [authReady, unlocked])

  // Keep the session while you use the site. Do NOT log out just for switching apps/tabs.
  // After idleMs with no activity, expire the session (default 1 hour).
  useEffect(() => {
    if (!lockOn || !unlocked) return undefined

    function logoutIdle() {
      if (unlockingRef.current) return
      clearPrivateData('Logged out after 1 hour idle')
      logoutAuth().catch(() => {})
    }

    function bumpIdle() {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(logoutIdle, idleMs)
      const now = Date.now()
      if (now - lastTouchRef.current < 60_000) return
      lastTouchRef.current = now
      touchAuth().catch(err => {
        if (err?.status === 401) logoutIdle()
      })
    }

    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove']
    events.forEach(name => window.addEventListener(name, bumpIdle, { passive: true }))
    bumpIdle()
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      events.forEach(name => window.removeEventListener(name, bumpIdle))
    }
  }, [lockOn, unlocked, idleMs])

  useEffect(() => {
    if (!flash) return undefined
    const timer = setTimeout(() => setFlash(null), 4000)
    return () => clearTimeout(timer)
  }, [flash])

  function bumpFocus() {
    setFocusTick(n => n + 1)
  }

  function selectDay(day, opts = {}) {
    setSelected(day)
    setMode('day')
    if (day.slice(0, 7) !== view) setView(day.slice(0, 7))
    if (opts.focus !== false) bumpFocus()
  }

  function shiftMonth(n) {
    let [y, m] = view.split('-').map(Number)
    m += n
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setView(`${y}-${String(m).padStart(2, '0')}`)
  }

  async function persistJobs(next) {
    setJobs(next)
    setStatus('Saving…')
    try {
      await saveJobs(next)
      setStatus('Saved')
    } catch {
      setStatus('Could not save, try again')
    }
  }

  async function persistMonth(mk, days) {
    setStatus('Saving…')
    try {
      await saveMonth(mk, days)
      setStatus('Saved')
    } catch {
      setStatus('Could not save, try again')
    }
  }

  async function persistDebts(next) {
    setDebts(next)
    setStatus('Saving…')
    try {
      await saveDebts(next)
      setStatus('Saved')
    } catch {
      setStatus('Could not save, try again')
    }
  }

  async function persistBudget(next) {
    setBudget(next)
    setStatus('Saving…')
    try {
      await saveBudget(next)
      setStatus('Saved')
    } catch {
      setStatus('Could not save, try again')
    }
  }

  function addEntry(day, entry) {
    const mk = day.slice(0, 7)
    const days = { ...(months[mk]?.days || {}) }
    days[day] = [...(days[day] || []), entry]
    const nextMonths = { ...months, [mk]: { days } }
    setMonths(nextMonths)
    setSelected(day)
    setView(mk)
    setMode('day')
    setFlash(`Added ${hrs(entry.hours)} · ${money(entry.amount)} to ${fmtShort(day)}`)
    bumpFocus()
    persistMonth(mk, days)
  }

  function deleteEntry(day, id) {
    const mk = day.slice(0, 7)
    const days = { ...(months[mk]?.days || {}) }
    days[day] = (days[day] || []).filter(e => e.id !== id)
    if (!days[day].length) delete days[day]
    setMonths({ ...months, [mk]: { days } })
    persistMonth(mk, days)
  }

  function openJobForm(id) {
    setEditingJob(id)
    setMode('jobform')
    setConfirmDel(null)
  }

  function saveJob(data) {
    const without = jobs.filter(j => j.id !== data.id)
    const idx = jobs.findIndex(j => j.id === data.id)
    const next = idx === -1 ? without.concat(data) : [...without.slice(0, idx), data, ...without.slice(idx)]
    if (!filter) setFilter(data.id)
    setMode('jobs')
    setEditingJob(null)
    persistJobs(next)
  }

  function removeJob(id) {
    const next = jobs.filter(j => j.id !== id)
    setConfirmDel(null)
    if (filter === id) setFilter(next[0]?.id || null)
    persistJobs(next)
  }

  function startLockSetup() {
    if (!lockSupported()) {
      setStatus(`${lockLabel()} is not available in this browser. Use Safari on iPhone to turn the lock on.`)
      return
    }
    setSetupOpen(true)
  }

  async function completeLockSetup(pin) {
    setLockBusy(true)
    unlockingRef.current = true
    try {
      const { credId, pin: passcode } = await registerLock(pin)
      await setupAuth(passcode, credId)
      setLockOn(true)
      setUnlocked(true)
      setSetupOpen(false)
      setStatus(`Locked on the server. Only your ${lockLabel()} or passcode can open it.`)
    } finally {
      unlockingRef.current = false
      setLockBusy(false)
    }
  }

  async function turnOffLock() {
    const pin = window.prompt('Enter your passcode to turn off the lock')
    if (pin == null) return
    setLockBusy(true)
    try {
      await disableAuth(pin.trim())
      disableLock()
      setLockOn(false)
      setUnlocked(true)
      setStatus('Server lock is off')
    } catch (err) {
      setStatus(err?.message || 'Could not turn off lock')
    } finally {
      setLockBusy(false)
    }
  }

  async function lockNow() {
    clearPrivateData('Locked')
    try {
      await logoutAuth()
    } catch {
      // still show the lock screen even if logout fails
    }
  }

  if (!authReady) {
    return (
      <div className="wrap lock-wrap">
        <section className="card lock-card">
          <h1>Payday Calendar</h1>
          <p className="note">Checking lock…</p>
        </section>
      </div>
    )
  }

  if (setupOpen) {
    return (
      <LockScreen
        mode="setup"
        onUnlocking={value => { unlockingRef.current = value }}
        onSetup={completeLockSetup}
        onUnlocked={() => {
          unlockingRef.current = false
          setUnlocked(true)
        }}
      />
    )
  }

  if (lockOn && !unlocked) {
    return (
      <LockScreen
        onUnlocking={value => { unlockingRef.current = value }}
        onUnlocked={() => {
          unlockingRef.current = false
          setUnlocked(true)
        }}
      />
    )
  }

  return (
    <div className={`wrap page-${page}`}>
      <header>
        <div className="brand">
          <h1>Payday Calendar</h1>
          <p className="sub" id="todayLine">Today is {fmtTodayLine(today)}</p>
        </div>
        <div className="site-nav">
          <nav className="pager" aria-label="Pages">
            <a href="#calendar" aria-label="Calendar" aria-current={page === 'calendar' ? 'page' : undefined}>
              <NavIcon name="calendar" />
              <span className="nav-label">Calendar</span>
            </a>
            <a href="#spend" aria-label="Spending" aria-current={page === 'spend' ? 'page' : undefined}>
              <NavIcon name="spend" />
              <span className="nav-label">Spending</span>
            </a>
            <a href="#debt" aria-label="Debt" aria-current={page === 'debt' ? 'page' : undefined}>
              <NavIcon name="debt" />
              <span className="nav-label">Debt</span>
            </a>
            <a href="#checklist" aria-label="Checklist" aria-current={page === 'checklist' ? 'page' : undefined}>
              <NavIcon name="checklist" />
              <span className="nav-label">Checklist</span>
            </a>
            <a href="#settings" aria-label="Settings" aria-current={page === 'settings' ? 'page' : undefined}>
              <NavIcon name="settings" />
              <span className="nav-label">Settings</span>
            </a>
          </nav>
        </div>
        <span className={`status${/could not|try again|not available|failed/i.test(status) ? ' bad' : ''}`} id="status">{status}</span>
      </header>
      {page === 'calendar' ? (
        <div className="hdr-actions">
          <div className="hdr-actions-bar">
            <button className="btn" type="button" onClick={() => { setMode(jobs.length ? 'jobs' : 'jobform'); setEditingJob(null) }}>Pay schedules</button>
            <button className="btn primary" type="button" onClick={() => { setView(today.slice(0, 7)); setSelected(today); setMode('day'); bumpFocus() }}>+ Log today</button>
          </div>
        </div>
      ) : null}
      {ready && page === 'spend' ? <Spend jobs={jobs} months={months} today={today} /> : null}
      {ready && page === 'debt' ? <Debt debts={debts} onSave={persistDebts} /> : null}
      {ready && page === 'checklist' ? (
        <Checklist
          budget={budget}
          onSave={persistBudget}
          debts={debts}
          onSaveDebts={persistDebts}
          jobs={jobs}
          months={months}
          today={today}
        />
      ) : null}
      {ready && page === 'settings' ? (
        <Settings
          theme={theme}
          onThemeChange={changeTheme}
          lockOn={lockOn}
          lockBusy={lockBusy}
          idleMs={idleMs}
          jobs={jobs}
          jobsCount={jobs.length}
          connecteamUrl={connecteamUrl}
          connecteamJobId={connecteamJobId || jobs[0]?.id || ''}
          connecteamBusy={connecteamBusy}
          connecteamMessage={connecteamMessage}
          onConnecteamUrlChange={changeConnecteamUrl}
          onConnecteamJobChange={changeConnecteamJob}
          onSyncConnecteam={syncConnecteam}
          onStartLockSetup={startLockSetup}
          onLockNow={lockNow}
          onTurnOffLock={turnOffLock}
          onOpenPaySchedules={() => {
            location.hash = '#calendar'
            setMode(jobs.length ? 'jobs' : 'jobform')
            setEditingJob(null)
          }}
        />
      ) : null}
      {ready && page === 'calendar' ? (
        <>
          <Cards jobs={jobs} months={months} today={today} onAddSchedule={openJobForm} />
          <EarningsSummary months={months} view={view} today={today} filter={filter} jobs={jobs} />
          <div className="main">
            <Calendar
              jobs={jobs}
              months={months}
              view={view}
              selected={selected}
              filter={filter}
              today={today}
              onSelectDay={selectDay}
              onShiftMonth={shiftMonth}
              onToday={() => { setView(today.slice(0, 7)); setSelected(today); setMode('day') }}
              onFilter={setFilter}
            />
            <Side
              jobs={jobs}
              months={months}
              selected={selected}
              today={today}
              mode={mode}
              flash={flash}
              focusTick={focusTick}
              confirmDel={confirmDel}
              editingJob={editingJob}
              onSelectDay={selectDay}
              onAdd={addEntry}
              onDelete={deleteEntry}
              onAddSchedule={openJobForm}
              onDone={() => setMode('day')}
              onEdit={openJobForm}
              onAskRemove={setConfirmDel}
              onRemove={removeJob}
              onKeep={() => setConfirmDel(null)}
              onCancel={() => setMode(jobs.length ? 'jobs' : 'day')}
              onSave={saveJob}
            />
          </div>
          <PastPaychecks jobs={jobs} months={months} today={today} filter={filter} />
        </>
      ) : null}
    </div>
  )
}
