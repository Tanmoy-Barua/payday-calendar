import { useRef } from 'react'
import { P, add, fmtLong, fmtMonth, hrs, money, moneyShort, ymd } from '../dates.js'
import { payOnOrAfter, periodFor } from '../pay.js'
import { entriesOn } from '../calc.js'

const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function Calendar({ jobs, months, view, selected, filter, today, onSelectDay, onShiftMonth, onToday, onFilter }) {
  const touch = useRef(null)
  const [y, m] = view.split('-').map(Number)
  const first = ymd(y, m - 1, 1)
  const start = add(first, -P(first).getUTCDay())
  const end = add(start, 41)
  const pays = {}
  for (const j of jobs) {
    let p = payOnOrAfter(j, start)
    let guard = 0
    while (p <= end && guard++ < 60) {
      ;(pays[p] ||= []).push(j)
      p = payOnOrAfter(j, add(p, 1))
    }
  }
  const fj = jobs.find(j => j.id === filter) || null
  const per = fj ? periodFor(fj, payOnOrAfter(fj, today)) : null
  const days = []
  for (let i = 0; i < 42; i++) days.push(add(start, i))

  return (
    <section className="panel" aria-label="Calendar">
      <div className="calhead">
        <div className="nav">
          <button className="btn ghost" type="button" aria-label="Previous month" onClick={() => onShiftMonth(-1)}>‹</button>
          <div className="month" id="monthLabel">{fmtMonth(y, m)}</div>
          <button className="btn ghost" type="button" aria-label="Next month" onClick={() => onShiftMonth(1)}>›</button>
        </div>
        <div className="caltools">
          <button className="btn ghost" type="button" onClick={onToday}>Today</button>
          <select aria-label="Show pay period for" value={filter || ''} hidden={!jobs.length} onChange={e => onFilter(e.target.value || null)}>
            <option value="">All schedules</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid">
        {DOWS.map(d => <div className="dow" key={d}>{d}</div>)}
      </div>
      <div
        className="grid"
        id="cal"
        onTouchStart={e => {
          const t = e.touches[0]
          touch.current = { x: t.clientX, y: t.clientY }
        }}
        onTouchEnd={e => {
          if (!touch.current) return
          const t = e.changedTouches[0]
          const dx = t.clientX - touch.current.x
          const dy = t.clientY - touch.current.y
          touch.current = null
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onShiftMonth(dx < 0 ? 1 : -1)
        }}
      >
        {days.map(d => {
          const list = entriesOn(months, d).filter(e => !fj || e.job === fj.id)
          const amount = list.reduce((s, e) => s + (Number(e.amount) || 0), 0)
          const hours = list.reduce((s, e) => s + (Number(e.hours) || 0), 0)
          const cls = ['day']
          if (d.slice(0, 7) !== view) cls.push('out')
          if (d === today) cls.push('isToday')
          if (d === selected) cls.push('sel')
          if (per && d >= per.start && d <= per.end) cls.push('inperiod')
          const pj = (pays[d] || []).filter(j => !fj || j.id === fj.id)
          if (pj.length) cls.push('isPayday')
          const label = fmtLong(d) + (amount ? `, ${money(amount)}` : '') + (pj.length ? ', payday' : '')
          return (
            <button
              type="button"
              className={cls.join(' ')}
              aria-label={label}
              key={d}
              onClick={() => onSelectDay(d)}
            >
              <span className="d">{P(d).getUTCDate()}</span>
              {amount ? <span className="amt" style={{ color: 'var(--accent)' }}>{moneyShort(amount)}</span> : null}
              {hours ? <span className="hrs">{hrs(hours)}</span> : null}
              {pj.length ? (
                <span className="paytag">
                  {pj.map(j => <span key={j.id} style={{ background: 'var(--pay)' }} title={`${j.name} payday`}>PAY</span>)}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <div className="legend" id="legend">
        <span><i style={{ background: 'var(--accent-soft)', border: '1px solid var(--line)' }} />{fj ? `Work counting toward next ${fj.name} paycheck` : 'Pick a schedule to shade its pay period'}</span>
        <span><i style={{ background: 'var(--pay)' }} />PAY = payday</span>
        <span><i style={{ background: 'var(--ink)' }} />Today</span>
      </div>
    </section>
  )
}
