import { fmtShort, fmtTodayLine, hrs, money } from '../dates.js'
import { listPastPaychecks } from '../pay.js'
import { jobColor } from './Cards.jsx'

export default function PastPaychecks({ jobs, months, today, filter }) {
  const rows = listPastPaychecks(jobs, months, today, { jobId: filter || '', limit: 36 })
  const filteredName = filter ? jobs.find(j => j.id === filter)?.name : ''

  return (
    <section className="panel past-paychecks" aria-label="Past paychecks">
      <div className="label">Past paychecks</div>
      <h2>What you already earned</h2>
      <p className="note">
        {filteredName
          ? `Closed paychecks for ${filteredName} from your logged hours (including Connecteam sync).`
          : 'Closed paychecks from your logged hours (including Connecteam sync), newest first.'}
      </p>
      {!jobs.length ? (
        <p className="note">Add a pay schedule first so the calendar knows your payday cycle.</p>
      ) : !rows.length ? (
        <p className="note">
          No past paychecks with hours yet. Sync Connecteam or log older days, then they show up here.
        </p>
      ) : (
        <div className="past-list">
          {rows.map(row => (
            <article className="past-row" key={row.id}>
              <div className="past-main">
                <div className="jobname">
                  <span className="dot" style={{ background: jobColor(row) }} />
                  <span>{row.jobName}</span>
                </div>
                <div className="past-payday">{fmtTodayLine(row.payday)}</div>
                <div className="note">Work {fmtShort(row.start)} – {fmtShort(row.end)}</div>
              </div>
              <div className="past-stats">
                <div>
                  <span className="label">Paycheck</span>
                  <span className="v num">{money(row.amount)}</span>
                </div>
                <div>
                  <span className="label">Hours</span>
                  <span className="v num">{hrs(row.hours)}</span>
                </div>
                <div>
                  <span className="label">Days</span>
                  <span className="v num">{row.days}</span>
                </div>
                <div>
                  <span className="label">Per hour</span>
                  <span className="v num">{row.hours ? money(row.rate) : '—'}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
