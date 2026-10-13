import { useState } from 'react'
import { fmtShort, hrs, money } from '../dates.js'
import { dailySeries } from '../calc.js'
import { jobColor } from './Cards.jsx'

function dayLabel(date) {
  return String(Number(date.slice(8, 10)))
}

export default function EarningsChart({ months, view, today, filter, jobs, onSelectDay }) {
  const ym = view || today.slice(0, 7)
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const start = `${ym}-01`
  const end = `${ym}-${String(last).padStart(2, '0')}`
  const jobId = filter || ''
  const series = dailySeries(months, start, end, jobId)
  const peak = series.reduce((max, point) => Math.max(max, point.amount), 0)
  const scale = peak > 0 ? peak : 1
  const earnedDays = series.filter(point => point.amount > 0)
  const [active, setActive] = useState(null)
  const focus = active || series.find(point => point.date === today) || earnedDays.at(-1) || null
  const jobMap = Object.fromEntries((jobs || []).map(job => [job.id, job]))
  const partIds = !jobId
    ? [...new Set(series.flatMap(point => Object.keys(point.parts)))].filter(id => jobMap[id] || id === '_')
    : [jobId]

  return (
    <div className="earn-chart" aria-label={`Daily earnings for ${ym}`}>
      <div className="earn-chart-head">
        <div>
          <div className="label">Daily graph</div>
          <p className="note">
            {peak > 0
              ? `Each bar is pay logged that day${jobId ? '' : ' · colors match each schedule'}.`
              : 'Log hours on the calendar and bars will fill in here.'}
          </p>
        </div>
        {focus ? (
          <div className="earn-chart-focus">
            <span className="note">{fmtShort(focus.date)}{focus.date === today ? ' · today' : ''}</span>
            <strong className="num">{money(focus.amount)}</strong>
            <span className="note">{focus.hours ? hrs(focus.hours) : 'No pay'}</span>
          </div>
        ) : null}
      </div>
      <div
        className="earn-chart-plot"
        style={{ '--earn-days': String(series.length || 1) }}
        role="img"
        aria-label={
          peak > 0
            ? `Bar chart of daily pay from ${fmtShort(start)} to ${fmtShort(end)}. Peak ${money(peak)}.`
            : `Empty bar chart for ${fmtShort(start)} to ${fmtShort(end)}.`
        }
      >
        <div className="earn-chart-grid" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="earn-chart-bars">
          {series.map(point => {
            const height = point.amount > 0 ? Math.max(6, (point.amount / scale) * 100) : 0
            const isToday = point.date === today
            const isFocus = focus?.date === point.date
            const segments = jobId
              ? [{ id: jobId, amount: point.amount, color: jobColor(jobMap[jobId]) }]
              : partIds
                .map(id => ({
                  id,
                  amount: point.parts[id] || 0,
                  color: id === '_' ? 'var(--accent)' : jobColor(jobMap[id]),
                }))
                .filter(seg => seg.amount > 0)
            return (
              <button
                key={point.date}
                type="button"
                className={`earn-bar-col${isToday ? ' is-today' : ''}${isFocus ? ' is-focus' : ''}${point.amount > 0 ? ' has-pay' : ''}`}
                style={{ '--bar-h': `${height}%` }}
                title={`${fmtShort(point.date)}: ${money(point.amount)}`}
                aria-label={`${fmtShort(point.date)}, ${money(point.amount)}`}
                onMouseEnter={() => setActive(point)}
                onFocus={() => setActive(point)}
                onMouseLeave={() => setActive(null)}
                onBlur={() => setActive(null)}
                onClick={() => onSelectDay?.(point.date)}
              >
                <span className="earn-bar-stack">
                  {point.amount > 0 ? (
                    segments.length ? segments.map(seg => (
                      <span
                        key={seg.id}
                        className="earn-bar-seg"
                        style={{
                          flexGrow: seg.amount,
                          background: seg.color,
                        }}
                      />
                    )) : (
                      <span className="earn-bar-seg" style={{ flexGrow: 1, background: 'var(--accent)' }} />
                    )
                  ) : (
                    <span className="earn-bar-empty" />
                  )}
                </span>
                {(Number(point.date.slice(8, 10)) % 5 === 1 || point.date === end || isToday) ? (
                  <span className="earn-bar-label">{dayLabel(point.date)}</span>
                ) : (
                  <span className="earn-bar-label is-spacer" aria-hidden="true" />
                )}
              </button>
            )
          })}
        </div>
      </div>
      {peak > 0 ? (
        <div className="earn-chart-scale note">
          <span>Peak day {money(peak)}</span>
          <span>{earnedDays.length} paid day{earnedDays.length === 1 ? '' : 's'}</span>
        </div>
      ) : null}
    </div>
  )
}
