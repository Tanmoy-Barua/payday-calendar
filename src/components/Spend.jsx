import { useEffect, useState } from 'react'
import { fmtLong, fmtShort, money } from '../dates.js'
import { payOnOrAfter, periodFor } from '../pay.js'
import { totals } from '../calc.js'
import { DEFAULT_MONTHLY_INCOME, splitEarnings } from '../budget.js'
import { jobColor } from './Cards.jsx'

const INCOME_KEY = 'payday-monthly-income'
const COLORS = ['var(--j0)', 'var(--j3)', 'var(--j1)', 'var(--j5)', 'var(--j2)', 'var(--j4)']

function readIncome() {
  const saved = localStorage.getItem(INCOME_KEY)
  if (saved == null || saved === '') return DEFAULT_MONTHLY_INCOME
  const amount = Number(saved)
  return Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_MONTHLY_INCOME
}

function ShareList({ amount }) {
  const rows = splitEarnings(amount)
  return (
    <>
      <div className="bar" aria-hidden="true">
        {rows.map((row, i) => (
          <i key={row.id} style={{ width: `${row.pct}%`, background: COLORS[i % COLORS.length] }} />
        ))}
      </div>
      <div className="shares">
        {rows.map((row, i) => (
          <div className="share" key={row.id}>
            <span className="jobname">
              <span className="dot" style={{ background: COLORS[i % COLORS.length] }} />
              {row.name}
            </span>
            <span className="num">{money(row.amount)}</span>
            <span className="note">× {row.rate.toFixed(2)} · {row.pct}%</span>
          </div>
        ))}
      </div>
    </>
  )
}

export default function Spend({ jobs, months, today }) {
  const [incomeText, setIncomeText] = useState(() => String(readIncome()))
  const income = incomeText === '' ? 0 : Math.max(0, Number(incomeText) || 0)

  useEffect(() => {
    localStorage.setItem(INCOME_KEY, String(income))
  }, [income])

  const checks = jobs.map(job => {
    const next = payOnOrAfter(job, today)
    const period = periodFor(job, next)
    const sum = totals(months, period.start, period.end, job.id)
    return { job, next, period, amount: sum.a }
  })

  return (
    <div className="spend">
      <section className="card">
        <div className="label">Monthly budget</div>
        <h2>Where the earnings go</h2>
        <p className="note">
          Essentials/Dad is half. Debt is 30%. Savings, investment, wants, and the emergency buffer are 5% each.
        </p>
        <label className="field" htmlFor="monthlyIncome">
          <span className="label">Monthly income</span>
          <input
            id="monthlyIncome"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={incomeText}
            onChange={ev => {
              const next = ev.target.value
              if (next === '') {
                setIncomeText('')
                return
              }
              if (Number(next) < 0) return
              setIncomeText(next)
            }}
          />
        </label>
        <div className="big num">{money(income)}</div>
        <ShareList amount={income} />
      </section>

      {checks.map(({ job, next, period, amount }) => (
        <section className="card" key={job.id}>
          <div className="top">
            <span className="jobname">
              <span className="dot" style={{ background: jobColor(job) }} />
              {job.name}
            </span>
            <span className="note">{fmtLong(next)}</span>
          </div>
          <div className="label">This paycheck</div>
          <div className="big num">{money(amount)}</div>
          <p className="note">Same formula, using pay logged for {fmtShort(period.start)} – {fmtShort(period.end)}.</p>
          <ShareList amount={amount} />
        </section>
      ))}
      <div className="debt-links">
        <a className="btn" href="#debt">Open debt tracker</a>
        <a className="btn" href="#calendar">Back to the calendar</a>
      </div>
    </div>
  )
}
