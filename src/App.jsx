import { useEffect, useState } from 'react'
import { fmtTodayLine, hrs, localToday, money, fmtShort } from './dates.js'
import { loadState, saveJobs, saveMonth, saveDebts } from './api.js'
import Cards from './components/Cards.jsx'
import Calendar from './components/Calendar.jsx'
import Side from './components/Side.jsx'
import Spend from './components/Spend.jsx'
import Debt from './components/Debt.jsx'

const today = localToday()

function pageFromHash() {
  if (location.hash === '#spend') return 'spend'
  if (location.hash === '#debt') return 'debt'
  return 'calendar'
}

export default function App() {
  const [jobs, setJobs] = useState([])
  const [months, setMonths] = useState({})
  const [debts, setDebts] = useState([])
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

  useEffect(() => {
    const sync = () => setPage(pageFromHash())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    let cancel = false
    loadState().then(data => {
      if (cancel) return
      setJobs(data.jobs || [])
      setMonths(data.months || {})
      setDebts(data.debts || [])
      setFilter(data.jobs?.[0]?.id || null)
      setStatus('Saved to the database')
      setReady(true)
    }).catch(() => {
      if (!cancel) setStatus('Could not load the database')
    })
    return () => { cancel = true }
  }, [])

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

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>Payday Calendar</h1>
          <p className="sub" id="todayLine">Today is {fmtTodayLine(today)}</p>
          <nav className="pager" aria-label="Pages">
            <a href="#calendar" aria-current={page === 'calendar' ? 'page' : undefined}>Calendar</a>
            <a href="#spend" aria-current={page === 'spend' ? 'page' : undefined}>Spending</a>
            <a href="#debt" aria-current={page === 'debt' ? 'page' : undefined}>Debt</a>
          </nav>
        </div>
        <span className="status" id="status">{status}</span>
        <div className="hdr-actions">
          <button className="btn" type="button" onClick={() => { location.hash = '#calendar'; setMode(jobs.length ? 'jobs' : 'jobform'); setEditingJob(null) }}>Pay schedules</button>
          <button className="btn primary" type="button" onClick={() => { location.hash = '#calendar'; setView(today.slice(0, 7)); setSelected(today); setMode('day'); bumpFocus() }}>+ Log today</button>
        </div>
      </header>
      {ready && page === 'spend' ? <Spend jobs={jobs} months={months} today={today} /> : null}
      {ready && page === 'debt' ? <Debt debts={debts} onSave={persistDebts} /> : null}
      {ready && page === 'calendar' ? (
        <>
          <Cards jobs={jobs} months={months} today={today} onAddSchedule={openJobForm} />
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
        </>
      ) : null}
    </div>
  )
}
