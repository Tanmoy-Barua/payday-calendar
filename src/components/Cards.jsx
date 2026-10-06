import { add, diff, fmtLong, fmtShort, hrs, money } from '../dates.js'
import { payOnOrAfter, periodFor } from '../pay.js'
import { totals, workDays } from '../calc.js'

export function jobColor(j) {
  return `var(--j${j?.color ?? 0})`
}

export default function Cards({ jobs, months, today, onAddSchedule }) {
  const todaySum = totals(months, today, today)
  return (
    <section className="cards" id="cards" aria-label="Upcoming paychecks">
      <div className="card today">
        <div className="top">
          <span className="label">Today</span>
          <span className="note">{fmtLong(today)}</span>
        </div>
        <div className="big num">{money(todaySum.a)}</div>
        <div className="note">{todaySum.h ? `${hrs(todaySum.h)} worked today` : 'Nothing logged yet today'}</div>
      </div>
      {!jobs.length ? (
        <div className="empty">
          <h2>Add your pay schedule</h2>
          <p className="note" style={{ margin: 0 }}>
            Tell the calendar when you get paid (weekly, every 2 weeks, twice a month or monthly) and one recent payday. It will mark every upcoming payday and add up what you earn toward each one.
          </p>
          <div>
            <button className="btn primary" type="button" onClick={() => onAddSchedule(null)}>Add pay schedule</button>
          </div>
        </div>
      ) : jobs.map(j => {
        const next = payOnOrAfter(j, today)
        const per = periodFor(j, next)
        const sum = totals(months, per.start, per.end, j.id)
        const days = diff(today, next)
        const cd = days === 0 ? 'Payday today' : days === 1 ? 'Tomorrow' : `In ${days} days`
        const after = today > per.end
        const nextPer = after ? periodFor(j, payOnOrAfter(j, add(next, 1))) : null
        const later = nextPer ? totals(months, nextPer.start, nextPer.end, j.id) : null
        return (
          <div className="card" key={j.id}>
            <div className="top">
              <span className="jobname">
                <span className="dot" style={{ background: jobColor(j) }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</span>
              </span>
              <span className="countdown">{cd}</span>
            </div>
            <div>
              <div className="label">Next paycheck · {fmtLong(next)}</div>
              <div className="big num" style={{ marginTop: 4 }}>{money(sum.a)}</div>
            </div>
            <div className="stats">
              <div><span className="label">Hours</span><span className="v">{hrs(sum.h)}</span></div>
              <div><span className="label">Per hour</span><span className="v">{sum.h ? money(sum.a / sum.h) : '—'}</span></div>
              <div><span className="label">Days</span><span className="v">{workDays(months, per.start, per.end, j.id)}</span></div>
            </div>
            <div className="note">
              {`Covers work ${fmtShort(per.start)} – ${fmtShort(per.end)}`}
              {j.rate ? ` · ${money(Number(j.rate))}/h` : ''}
            </div>
            {after && nextPer ? (
              <div className="note">Work from today counts toward {fmtShort(nextPer.payday)} (so far {money(later.a)}).</div>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}
