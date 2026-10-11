import { useEffect, useRef, useState } from 'react'
import { P, add, fmtLong, fmtShort, hrs, localToday, money, uid } from '../dates.js'
import { FREQ, payOnOrAfter, periodContaining } from '../pay.js'
import { entriesOn, totals } from '../calc.js'
import { jobColor } from './Cards.jsx'

export default function Side(props) {
  if (props.mode === 'jobs') return <JobList {...props} />
  if (props.mode === 'jobform') return <JobForm {...props} />
  return <DayLog {...props} />
}

function DayLog({ jobs, months, selected, today, flash, focusTick, onSelectDay, onAdd, onDelete, onAddSchedule }) {
  const sideRef = useRef(null)
  const hoursRef = useRef(null)
  const list = entriesOn(months, selected)
  const tot = list.reduce((s, e) => ({ a: s.a + (Number(e.amount) || 0), h: s.h + (Number(e.hours) || 0) }), { a: 0, h: 0 })
  const [date, setDate] = useState(selected)
  const [jobId, setJobId] = useState(jobs[0]?.id || '')
  const [hours, setHours] = useState('')
  const [amount, setAmount] = useState('')
  const [hint, setHint] = useState('')
  const [bad, setBad] = useState(false)

  useEffect(() => { setDate(selected) }, [selected])
  useEffect(() => {
    if (!jobs.some(j => j.id === jobId)) setJobId(jobs[0]?.id || '')
  }, [jobs, jobId])

  const picked = jobs.find(j => j.id === jobId) || jobs[0]
  const rateHint = picked?.rate
    ? `Leave pay empty to use ${money(Number(picked.rate))}/h. Add tips to the pay amount.`
    : 'Enter what you earned this day, tips included.'

  useEffect(() => {
    if (!focusTick) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (window.matchMedia('(max-width:820px)').matches) {
      sideRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    }
    hoursRef.current?.focus({ preventScroll: true })
  }, [focusTick])

  function submit(ev) {
    ev.preventDefault()
    const j = jobs.length > 1 ? jobs.find(x => x.id === jobId) : jobs[0]
    if (!j) return
    const h = parseFloat(hours) || 0
    const a = amount === '' ? (j.rate ? h * Number(j.rate) : 0) : (parseFloat(amount) || 0)
    if (!h && !a) {
      setHint('Enter hours, pay, or both.')
      setBad(true)
      return
    }
    const day = date || selected
    onAdd(day, { id: uid(), job: j.id, hours: h, amount: Math.round(a * 100) / 100 })
    setHours('')
    setAmount('')
    setHint('')
    setBad(false)
  }

  return (
    <aside className="panel" id="side" aria-live="polite" ref={sideRef}>
      <div>
        <div className="label">{selected === today ? 'Today' : 'Day'}</div>
        <h2 style={{ fontSize: 22 }}>{fmtLong(selected)}</h2>
        <div className="note num">{money(tot.a)} · {hrs(tot.h)}</div>
      </div>
      {jobs.length ? (
        <div className="note">
          {jobs.map(j => {
            const per = periodContaining(j, selected)
            const sum = totals(months, per.start, per.end, j.id)
            const past = per.payday < today
            return (
              <div key={j.id}>
                <span className="dot" style={{ display: 'inline-block', marginRight: 6, background: jobColor(j) }} />
                {j.name}: {past ? 'was paid' : 'paid'} {fmtLong(per.payday)} · that check: <strong className="num">{money(sum.a)}</strong>
                {` (${hrs(sum.h)}, ${fmtShort(per.start)}–${fmtShort(per.end)})`}
              </div>
            )
          })}
        </div>
      ) : null}
      {flash ? <div className="note" style={{ color: 'var(--accent)', fontWeight: 600 }}>{flash}</div> : null}
      {list.length ? (
        <div className="entries">
          {list.map(e => {
            const j = jobs.find(x => x.id === e.job)
            return (
              <div className="entry" key={e.id}>
                <span className="dot" style={{ background: jobColor(j) }} />
                <span className="name">{j ? j.name : 'Removed schedule'}</span>
                <span className="num">{hrs(Number(e.hours) || 0)} · {money(Number(e.amount) || 0)}</span>
                <button className="btn ghost danger" type="button" aria-label="Delete entry" onClick={() => onDelete(selected, e.id)}>✕</button>
              </div>
            )
          })}
        </div>
      ) : null}
      {!jobs.length ? (
        <>
          <p className="note" style={{ margin: 0 }}>Add a pay schedule first, then log hours and pay here.</p>
          <div><button className="btn primary" type="button" onClick={() => onAddSchedule(null)}>Add pay schedule</button></div>
        </>
      ) : (
        <form id="logForm" onSubmit={submit}>
          <h2>Log work</h2>
          <div className="field">
            <label className="label" htmlFor="eDate">Date worked</label>
            <input
              id="eDate"
              type="date"
              value={date}
              max={add(today, 60)}
              required
              onChange={ev => {
                if (!ev.target.value) return
                setDate(ev.target.value)
                onSelectDay(ev.target.value, { focus: false })
              }}
            />
            <div className="hint">Pick any past day to add old hours. You can also tap a day on the calendar.</div>
          </div>
          {jobs.length > 1 ? (
            <div className="field">
              <label className="label" htmlFor="eJob">Schedule</label>
              <select id="eJob" value={jobId} onChange={ev => { setJobId(ev.target.value); setBad(false) }}>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </div>
          ) : null}
          <div className="row">
            <div className="field">
              <label className="label" htmlFor="eHours">Hours</label>
              <input id="eHours" ref={hoursRef} type="number" min="0" step="0.25" inputMode="decimal" placeholder="0" value={hours} onChange={ev => setHours(ev.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="eAmount">Pay ($)</label>
              <input id="eAmount" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={amount} onChange={ev => setAmount(ev.target.value)} />
            </div>
          </div>
          <div className="hint" style={bad ? { color: 'var(--danger)' } : undefined}>{bad ? hint : rateHint}</div>
          <div className="actions">
            <button className="btn primary" type="submit">Add to {fmtShort(date || selected)}</button>
          </div>
        </form>
      )}
    </aside>
  )
}

function JobList({ jobs, today, confirmDel, onDone, onEdit, onAskRemove, onRemove, onKeep, onAddSchedule }) {
  return (
    <aside className="panel" id="side" aria-live="polite">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2>Pay schedules</h2>
        <button className="btn ghost" type="button" onClick={onDone}>Done</button>
      </div>
      <div className="jobs">
        {jobs.map(j => (
          <div className="jobrow" key={j.id}>
            <div style={{ minWidth: 0 }}>
              <div className="jobname">
                <span className="dot" style={{ background: jobColor(j) }} />
                {j.name}
              </div>
              <div className="meta">
                {FREQ[j.freq]} · next {fmtShort(payOnOrAfter(j, today))}
                {j.freq === 'biweeklyThu'
                  ? ` · weeks end ${j.weekEnd === 'sat' ? 'Saturday' : 'Sunday'}`
                  : (j.lag ? ` · ${j.lag}-day delay` : '')}
              </div>
            </div>
            {confirmDel === j.id ? (
              <div className="confirm">
                Remove?
                <button className="btn danger" type="button" onClick={() => onRemove(j.id)}>Remove</button>
                <button className="btn ghost" type="button" onClick={onKeep}>Keep</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn ghost" type="button" onClick={() => onEdit(j.id)}>Edit</button>
                <button className="btn ghost danger" type="button" onClick={() => onAskRemove(j.id)}>Remove</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div>
        <button className="btn primary" type="button" onClick={() => onAddSchedule(null)}>+ Add pay schedule</button>
      </div>
    </aside>
  )
}

function lastWeekday(dow) {
  const today = localToday()
  let d = today
  while (P(d).getUTCDay() !== dow) d = add(d, -1)
  return d
}

function JobForm({ jobs, editingJob, onCancel, onSave }) {
  const existing = jobs.find(j => j.id === editingJob)
  const nameRef = useRef(null)
  const [name, setName] = useState(existing?.name || '')
  const [freq, setFreq] = useState(existing?.freq || 'biweeklyThu')
  const [anchor, setAnchor] = useState(existing?.anchor || lastWeekday(4))
  const [weekEnd, setWeekEnd] = useState(existing?.weekEnd === 'sat' ? 'sat' : 'sun')
  const [lag, setLag] = useState(existing?.lag || 0)
  const [rate, setRate] = useState(existing?.rate ?? '')
  const [color, setColor] = useState(Number(existing?.color ?? (jobs.length % 6)))

  useEffect(() => { nameRef.current?.focus() }, [])

  const thu = freq === 'biweeklyThu'
  const notThu = thu && anchor && P(anchor).getUTCDay() !== 4

  function submit(ev) {
    ev.preventDefault()
    const today = localToday()
    onSave({
      id: existing?.id || uid(),
      name: name.trim() || 'My job',
      freq,
      anchor: freq === 'semimonthly' ? today : (anchor || today),
      lag: Math.max(0, parseInt(lag, 10) || 0),
      weekEnd,
      rate: rate === '' ? '' : Number(rate),
      color: Number(color) || 0,
    })
  }

  return (
    <aside className="panel" id="side" aria-live="polite">
      <form onSubmit={submit}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{existing ? 'Edit schedule' : 'New pay schedule'}</h2>
          <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
        </div>
        <div className="field">
          <label className="label" htmlFor="jName">Name</label>
          <input id="jName" ref={nameRef} type="text" value={name} placeholder="e.g. DoorDash, Uber, Day job" required maxLength={40} onChange={ev => setName(ev.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="jFreq">How often you get paid</label>
          <select id="jFreq" value={freq} onChange={ev => setFreq(ev.target.value)}>
            {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {freq !== 'semimonthly' ? (
          <div className="field">
            <label className="label" htmlFor="jAnchor">{thu ? 'Your last payday (a Thursday)' : 'A payday (past or next)'}</label>
            <input id="jAnchor" type="date" value={anchor} required onChange={ev => setAnchor(ev.target.value)} />
            <div className="hint" style={notThu ? { color: 'var(--danger)' } : undefined}>
              {notThu ? 'That date is not a Thursday. Pick the Thursday you were paid.' : 'Any real payday works. The calendar repeats it on your schedule.'}
            </div>
          </div>
        ) : null}
        {thu ? (
          <div className="field">
            <label className="label" htmlFor="jWeekEnd">Your work week ends on</label>
            <select id="jWeekEnd" value={weekEnd} onChange={ev => setWeekEnd(ev.target.value)}>
              <option value="sun">Sunday (weeks run Mon–Sun)</option>
              <option value="sat">Saturday (weeks run Sun–Sat)</option>
            </select>
            <div className="hint">You work 2 weeks, then get paid on Thursday of the next week.</div>
          </div>
        ) : null}
        <div className="row">
          {!thu ? (
            <div className="field">
              <label className="label" htmlFor="jLag">Delay (days)</label>
              <input id="jLag" type="number" min="0" max="30" step="1" value={lag} onChange={ev => setLag(ev.target.value)} />
              <div className="hint">Days between the last day of work counted and payday. 0 if work up to payday counts.</div>
            </div>
          ) : null}
          <div className="field">
            <label className="label" htmlFor="jRate">Hourly rate ($, optional)</label>
            <input id="jRate" type="number" min="0" step="0.01" value={rate} placeholder="—" onChange={ev => setRate(ev.target.value)} />
            <div className="hint">Fills in pay from hours when you leave pay empty.</div>
          </div>
        </div>
        <div className="field">
          <span className="label">Color</span>
          <div className="swatches" role="radiogroup" aria-label="Color">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <span key={i} style={{ display: 'contents' }}>
                <input type="radio" name="jColor" id={'jc' + i} value={i} checked={Number(color) === i} onChange={() => setColor(i)} />
                <label htmlFor={'jc' + i} style={{ background: `var(--j${i})` }} title={'Color ' + (i + 1)} />
              </span>
            ))}
          </div>
        </div>
        <div className="actions">
          <button className="btn primary" type="submit">Save schedule</button>
        </div>
      </form>
    </aside>
  )
}
