import { useId, useState } from 'react'
import { fmtShort, money, moneyShort } from '../dates.js'
import { monthRange, weeklySeries } from '../calc.js'
import { jobColor } from './Cards.jsx'

const VIEW_W = 720
const VIEW_H = 280
const PAD_T = 34
const PAD_B = 44
const PAD_X = 28
const SEG_GAP = 5
const BAR_RX = 10
const FLOW_OPACITY = 0.2

/** Solid + highlight stops so SVG stacks read like the reference gradients. */
const STACK_TONES = [
  ['#0b6b54', '#3bb892'],
  ['#2f5fd0', '#7aa0f2'],
  ['#b0428f', '#e08cc8'],
  ['#c2700a', '#f0a543'],
  ['#6d4fc2', '#a891f0'],
  ['#1f7f90', '#5cc3d4'],
  ['#1a1a1a', '#5a5a5a'],
]

function weekTitle(start, end) {
  const a = Number(start.slice(8, 10))
  const b = Number(end.slice(8, 10))
  return a === b ? fmtShort(start) : `${fmtShort(start)} – ${b}`
}

function toneFor(job) {
  const idx = Number.isFinite(job?.color) ? job.color : 0
  return STACK_TONES[((idx % STACK_TONES.length) + STACK_TONES.length) % STACK_TONES.length]
}

function layoutColumns(weeks, seriesIds, plotH) {
  const peak = Math.max(...weeks.map(week => week.amount), 0)
  const scale = peak > 0 ? peak : 1
  return weeks.map(week => {
    const activeIds = seriesIds.filter(id => (week.parts[id] || 0) > 0)
    const gapTotal = Math.max(0, activeIds.length - 1) * SEG_GAP
    const usable = Math.max(plotH - gapTotal, 0)
    let y = PAD_T + plotH
    const segs = []
    for (const id of activeIds) {
      const amount = week.parts[id] || 0
      const h = Math.max(10, (amount / scale) * usable)
      const y1 = y
      const y0 = y - h
      segs.push({ id, amount, y0, y1, h })
      y = y0 - SEG_GAP
    }
    return { ...week, segs, stackTop: segs.length ? segs[segs.length - 1].y0 : PAD_T + plotH, peak }
  })
}

function flowPath(left, right, x0, x1) {
  const mid = (x0 + x1) / 2
  return [
    `M ${x0} ${left.y0}`,
    `C ${mid} ${left.y0}, ${mid} ${right.y0}, ${x1} ${right.y0}`,
    `L ${x1} ${right.y1}`,
    `C ${mid} ${right.y1}, ${mid} ${left.y1}, ${x0} ${left.y1}`,
    'Z',
  ].join(' ')
}

export default function EarningsChart({ months, view, today, filter, jobs, onSelectDay }) {
  const uid = useId().replace(/:/g, '')
  const ym = view || today.slice(0, 7)
  const month = monthRange(ym)
  const jobId = filter || ''
  const weeks = weeklySeries(months, month.start, month.end, jobId)
  const jobMap = Object.fromEntries((jobs || []).map(job => [job.id, job]))
  const seriesIds = (jobId
    ? [jobId]
    : [
      ...(jobs || []).map(job => job.id),
      ...weeks.flatMap(week => Object.keys(week.parts)),
    ]
  ).filter((id, i, arr) => arr.indexOf(id) === i && (jobMap[id] || weeks.some(week => week.parts[id])))

  const legend = seriesIds.map(id => {
    const tones = id === '_' ? ['#0d7a5f', '#3bb892'] : toneFor(jobMap[id])
    return {
      id,
      name: jobMap[id]?.name || 'Other',
      color: tones[0],
      soft: tones[1],
      swatch: id === '_' ? 'var(--accent)' : jobColor(jobMap[id]),
    }
  })

  const plotH = VIEW_H - PAD_T - PAD_B
  const columns = layoutColumns(weeks, seriesIds, plotH)
  const n = Math.max(columns.length, 1)
  const slot = (VIEW_W - PAD_X * 2) / n
  const barW = Math.min(72, Math.max(36, slot * 0.42))
  const [active, setActive] = useState(null)
  const focus = active
    || columns.find(col => today >= col.start && today <= col.end)
    || columns.filter(col => col.amount > 0).at(-1)
    || null
  const monthTotal = columns.reduce((sum, col) => sum + col.amount, 0)
  let highlightIndex = columns.length - 1
  for (let i = columns.length - 1; i >= 0; i -= 1) {
    if (columns[i].amount > 0) {
      highlightIndex = i
      break
    }
  }

  function barX(index) {
    return PAD_X + slot * index + (slot - barW) / 2
  }

  return (
    <div className="earn-chart" aria-label={`Weekly earnings for ${ym}`}>
      <div className="earn-chart-card">
        <div className="earn-chart-head">
          <div className="earn-chart-title">
            <span className="earn-chart-mark" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="18" height="18">
                <rect x="3" y="10" width="3.5" height="7" rx="1.2" fill="currentColor" opacity=".9" />
                <rect x="8.25" y="6" width="3.5" height="11" rx="1.2" fill="currentColor" opacity=".75" />
                <rect x="13.5" y="3" width="3.5" height="14" rx="1.2" fill="currentColor" opacity=".6" />
              </svg>
            </span>
            <div>
              <h3>How did pay stack this month?</h3>
              <p className="note">
                {monthTotal > 0
                  ? 'Each column is a week. Blocks are schedules; ribbons show the carry between weeks.'
                  : 'Log hours on the calendar and the weekly stacks will fill in here.'}
              </p>
            </div>
          </div>
          <div className="earn-chart-unit note">USD · logged pay</div>
        </div>

        {legend.length ? (
          <ul className="earn-chart-legend">
            {legend.map(item => (
              <li key={item.id}>
                <span
                  className="earn-swatch"
                  style={{ background: `linear-gradient(180deg, ${item.soft}, ${item.color})` }}
                />
                {item.name}
              </li>
            ))}
          </ul>
        ) : null}

        <div
          className="earn-chart-plot"
          onMouseLeave={() => setActive(null)}
        >
          <svg
            className="earn-flow-svg"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            role="img"
            aria-label={
              monthTotal > 0
                ? `Stacked weekly pay from ${fmtShort(month.start)} to ${fmtShort(month.end)}. Total ${money(monthTotal)}.`
                : `Empty weekly pay chart for ${fmtShort(month.start)} to ${fmtShort(month.end)}.`
            }
          >
            <defs>
              {legend.map(item => (
                <linearGradient key={item.id} id={`${uid}-g-${item.id}`} x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor={item.color} />
                  <stop offset="100%" stopColor={item.soft} />
                </linearGradient>
              ))}
            </defs>

            {columns.slice(0, -1).map((col, i) => {
              const next = columns[i + 1]
              const x0 = barX(i) + barW
              const x1 = barX(i + 1)
              return seriesIds.map(id => {
                const left = col.segs.find(seg => seg.id === id)
                const right = next.segs.find(seg => seg.id === id)
                if (!left || !right) return null
                const color = legend.find(item => item.id === id)?.soft || legend.find(item => item.id === id)?.color
                return (
                  <path
                    key={`${col.start}-${id}`}
                    className="earn-flow"
                    d={flowPath(left, right, x0, x1)}
                    fill={color}
                    opacity={FLOW_OPACITY}
                  />
                )
              })
            })}

            {columns.map((col, i) => {
              const x = barX(i)
              const isFocus = focus?.start === col.start
              const showPill = i === highlightIndex && col.amount > 0
              const labelY = 18
              return (
                <g
                  key={col.start}
                  className={`earn-col${isFocus ? ' is-focus' : ''}`}
                  onMouseEnter={() => setActive(col)}
                  onFocus={() => setActive(col)}
                  onBlur={() => setActive(null)}
                  onClick={() => {
                    const day = today >= col.start && today <= col.end ? today : col.start
                    onSelectDay?.(day)
                  }}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                  aria-label={`${weekTitle(col.start, col.end)}, ${money(col.amount)}`}
                  onKeyDown={ev => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      const day = today >= col.start && today <= col.end ? today : col.start
                      onSelectDay?.(day)
                    }
                  }}
                >
                  <text
                    x={x + barW / 2}
                    y={labelY}
                    textAnchor="middle"
                    className="earn-col-top"
                  >
                    {weekTitle(col.start, col.end)}
                  </text>

                  {col.amount <= 0 ? (
                    <rect
                      x={x + barW * 0.2}
                      y={PAD_T + plotH - 6}
                      width={barW * 0.6}
                      height={6}
                      rx={3}
                      className="earn-col-empty"
                    />
                  ) : col.segs.map(seg => (
                    <rect
                      key={seg.id}
                      x={x}
                      y={seg.y0}
                      width={barW}
                      height={seg.h}
                      rx={BAR_RX}
                      ry={BAR_RX}
                      fill={`url(#${uid}-g-${seg.id})`}
                      className="earn-col-seg"
                    >
                      <title>{`${jobMap[seg.id]?.name || 'Other'}: ${money(seg.amount)}`}</title>
                    </rect>
                  ))}

                  {showPill ? (
                    <g transform={`translate(${x + barW / 2}, ${VIEW_H - 14})`}>
                      <rect
                        x={-34}
                        y={-12}
                        width={68}
                        height={22}
                        rx={11}
                        className="earn-col-pill"
                      />
                      <text textAnchor="middle" y={4} className="earn-col-pill-text">
                        {moneyShort(col.amount)}
                      </text>
                    </g>
                  ) : (
                    <text
                      x={x + barW / 2}
                      y={VIEW_H - 12}
                      textAnchor="middle"
                      className="earn-col-total"
                    >
                      {col.amount > 0 ? moneyShort(col.amount) : '—'}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>

        {focus ? (
          <div className="earn-chart-focus-row">
            <span className="note">
              {weekTitle(focus.start, focus.end)}
              {today >= focus.start && today <= focus.end ? ' · includes today' : ''}
            </span>
            <strong className="num">{money(focus.amount)}</strong>
          </div>
        ) : null}
      </div>
    </div>
  )
}
