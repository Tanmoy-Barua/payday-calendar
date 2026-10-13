import { fmtMonth, fmtShort, hrs, money } from '../dates.js'
import { halfMonthRanges, monthRange, totals, workDays } from '../calc.js'

function EarnCard({ label, rangeNote, sum, days, highlight }) {
  return (
    <div className={`earn-card${highlight ? ' is-current' : ''}`}>
      <div className="label">{label}</div>
      <div className="earn-amount num">{money(sum.a)}</div>
      <div className="earn-meta">
        <span>{sum.h ? hrs(sum.h) : '0h'}</span>
        <span aria-hidden="true">·</span>
        <span>{days} day{days === 1 ? '' : 's'} worked</span>
      </div>
      <div className="note">{rangeNote}</div>
    </div>
  )
}

export default function EarningsSummary({ months, view, today, filter, jobs }) {
  const ym = view || today.slice(0, 7)
  const [y, m] = ym.split('-').map(Number)
  const month = monthRange(ym)
  const first = halfMonthRanges(ym).first
  const jobId = filter || ''
  const jobName = jobId ? jobs.find(j => j.id === jobId)?.name : ''
  const monthSum = totals(months, month.start, month.end, jobId)
  const monthDays = workDays(months, month.start, month.end, jobId)
  const firstSum = first ? totals(months, first.start, first.end, jobId) : { h: 0, a: 0 }
  const firstDays = first ? workDays(months, first.start, first.end, jobId) : 0
  const todayDom = today.slice(0, 7) === ym ? Number(today.slice(8, 10)) : 0
  const firstCurrent = todayDom > 0 && todayDom <= 15

  return (
    <section className="panel earnings-summary" aria-label="Monthly and 15-day earnings">
      <div className="earn-head">
        <div>
          <div className="label">Earnings</div>
          <h2>{fmtMonth(y, m)}</h2>
          <p className="note">
            {jobName
              ? `Totals for ${jobName} from logged hours and pay.`
              : 'Totals across all schedules from logged hours and pay.'}
          </p>
        </div>
      </div>
      <div className="earn-grid">
        <EarnCard
          label="Whole month"
          rangeNote={`${fmtShort(month.start)} – ${fmtShort(month.end)}`}
          sum={monthSum}
          days={monthDays}
        />
        {first ? (
          <EarnCard
            label="First 15 days"
            rangeNote={`${fmtShort(first.start)} – ${fmtShort(first.end)}${firstCurrent ? ' · current' : ''}`}
            sum={firstSum}
            days={firstDays}
            highlight={firstCurrent}
          />
        ) : null}
      </div>
    </section>
  )
}
