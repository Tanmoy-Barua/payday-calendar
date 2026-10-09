import { useState } from 'react'
import { fmtShort, fmtTodayLine, money } from '../dates.js'
import {
  applyPaycheckSource,
  closePaycheckBudget,
  defaultBudgetNote,
  newItemId,
  nextPaycheckAfter,
  plannedRemaining,
  remainingAfterPaid,
  runningSteps,
  upcomingPaychecks,
} from '../checklist.js'

function emptyItem(separate = false) {
  return {
    id: newItemId(),
    name: '',
    amount: '',
    paid: false,
    separate,
  }
}

function ItemRow({ item, onChange, onRemove }) {
  return (
    <label className={`check-row${item.paid ? ' is-paid' : ''}`}>
      <input
        type="checkbox"
        checked={!!item.paid}
        onChange={ev => onChange({ ...item, paid: ev.target.checked })}
        aria-label={item.paid ? 'Mark not paid' : 'Mark paid'}
      />
      <input
        className="check-name"
        type="text"
        placeholder={item.separate ? 'Card or note' : 'What this payment is'}
        value={item.name}
        onChange={ev => onChange({ ...item, name: ev.target.value })}
      />
      <input
        className="check-amount"
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        placeholder="$"
        value={item.amount === '' || item.amount == null ? '' : item.amount}
        onChange={ev => {
          const next = ev.target.value
          if (next === '') {
            onChange({ ...item, amount: '' })
            return
          }
          if (!/^\d*\.?\d*$/.test(next)) return
          onChange({ ...item, amount: next })
        }}
      />
      <button className="btn ghost check-remove" type="button" onClick={() => onRemove(item.id)} aria-label="Remove item">
        ×
      </button>
    </label>
  )
}

function HistoryCard({ entry }) {
  const [open, setOpen] = useState(false)
  const paid = (entry.paid || []).filter(row => !row.separate)
  const side = (entry.paid || []).filter(row => row.separate)
  return (
    <article className="history-card">
      <button className="history-toggle" type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <div>
          <div className="jobname">{entry.paycheckLabel || 'Paycheck'}</div>
          <p className="note">
            Closed {fmtShort(entry.closedAt)}
            {entry.paycheckDate ? ` · payday ${fmtShort(entry.paycheckDate)}` : ''}
          </p>
        </div>
        <div className="history-totals">
          <span className="num">{money(entry.starting)}</span>
          <span className="note">left {money(entry.remaining)}</span>
        </div>
      </button>
      {open ? (
        <div className="history-body">
          <p className="note">Where this paycheck went</p>
          {paid.length ? (
            <ul className="history-list">
              {paid.map(row => (
                <li key={row.id}>
                  <span>{row.name}</span>
                  <span className="num">{money(row.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">No main payments were marked paid.</p>
          )}
          {side.length ? (
            <>
              <p className="note">Side notes also marked paid</p>
              <ul className="history-list">
                {side.map(row => (
                  <li key={row.id}>
                    <span>{row.name}</span>
                    <span className="num">{money(row.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export default function Checklist({ budget, onSave, jobs = [], months = {}, today }) {
  const note = budget?.items ? budget : defaultBudgetNote()
  const paychecks = upcomingPaychecks(jobs, months, today)
  const selected = paychecks.find(row => row.jobId === note.jobId && row.payday === note.paycheckDate)
    || paychecks.find(row => row.jobId === note.jobId)
    || paychecks[0]
    || null
  const mainItems = note.items.filter(item => !item.separate)
  const otherItems = note.items.filter(item => item.separate)
  const left = remainingAfterPaid(note.starting, note.items)
  const planned = plannedRemaining(note.starting, note.items)
  const { steps } = runningSteps(note.starting, note.items)
  const paidCount = mainItems.filter(item => item.paid).length
  const history = note.history || []

  function update(next) {
    onSave(next)
  }

  function setStarting(value) {
    update({ ...note, starting: value })
  }

  function setItem(nextItem) {
    update({
      ...note,
      items: note.items.map(item => (item.id === nextItem.id ? nextItem : item)),
    })
  }

  function removeItem(id) {
    update({ ...note, items: note.items.filter(item => item.id !== id) })
  }

  function addItem(separate) {
    update({ ...note, items: note.items.concat(emptyItem(separate)) })
  }

  function choosePaycheck(jobId) {
    const paycheck = paychecks.find(row => row.jobId === jobId) || paychecks[0]
    if (!paycheck) return
    update(applyPaycheckSource(note, paycheck))
  }

  function useSelectedPaycheck() {
    if (!selected) return
    update(applyPaycheckSource(note, selected))
  }

  function closeCurrent() {
    if (!window.confirm('Close this paycheck budget and save it to history? Paid marks will reset for the next check.')) return
    const nextPay = nextPaycheckAfter(jobs, months, note.paycheckDate || selected?.payday, note.jobId || selected?.jobId)
    const { budget: closed } = closePaycheckBudget(note, { nextPaycheck: nextPay })
    update(closed)
  }

  return (
    <div className="checklist">
      <section className="card checklist-hero">
        <div className="label">Notepad</div>
        <h2>{note.title || 'Budget Note'}</h2>
        <p className="note">
          Starting amount follows your next paycheck. Check payments as you pay them, then close the paycheck to keep a history of where that money went.
        </p>

        <div className="paycheck-source">
          <label className="field">
            <span className="label">Next paycheck</span>
            <select
              value={selected?.jobId || ''}
              onChange={ev => choosePaycheck(ev.target.value)}
              disabled={!paychecks.length}
            >
              {!paychecks.length ? <option value="">Add a pay schedule first</option> : null}
              {paychecks.map(row => (
                <option key={row.jobId} value={row.jobId}>
                  {row.jobName} · {fmtShort(row.payday)} · {money(row.amount)}
                </option>
              ))}
            </select>
          </label>
          <div className="paycheck-actions">
            <button className="btn primary" type="button" disabled={!selected} onClick={useSelectedPaycheck}>
              Use as starting amount
            </button>
            <button className="btn" type="button" onClick={closeCurrent}>
              Close paycheck & save history
            </button>
          </div>
          {note.paycheckLabel ? (
            <p className="note">Linked to {note.paycheckLabel}</p>
          ) : (
            <p className="note">Choose a paycheck, then use it as the starting amount for this notepad.</p>
          )}
        </div>

        <div className="checklist-stats">
          <label className="field">
            <span className="label">Starting amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={note.starting === '' || note.starting == null ? '' : note.starting}
              onChange={ev => {
                const next = ev.target.value
                if (next === '') {
                  setStarting('')
                  return
                }
                if (!/^\d*\.?\d*$/.test(next)) return
                setStarting(next)
              }}
            />
          </label>
          <div>
            <div className="label">Remaining now</div>
            <div className="checklist-remain num">{money(left)}</div>
            <p className="note">{paidCount} of {mainItems.length} main payments marked paid</p>
          </div>
          <div>
            <div className="label">If all main payments paid</div>
            <div className="num">{money(planned)}</div>
            <p className="note">Plan leftover after every main payment</p>
          </div>
        </div>
      </section>

      <div className="checklist-grid">
        <section className="card">
          <div className="label">Pay checklist</div>
          <h3>Mark paid or not paid</h3>
          <div className="check-list">
            {mainItems.map(item => (
              <ItemRow key={item.id} item={item} onChange={setItem} onRemove={removeItem} />
            ))}
          </div>
          <button className="btn" type="button" onClick={() => addItem(false)}>+ Add payment</button>
        </section>

        <section className="card">
          <div className="label">Running math</div>
          <h3>Notepad balance</h3>
          <ol className="check-math">
            <li>
              <span>Starting</span>
              <span className="num">{money(Number(note.starting) || 0)}</span>
            </li>
            {steps.map(step => (
              <li key={step.id} className={step.paid ? 'is-paid' : ''}>
                <span>
                  − {money(step.amount)}
                  {step.name ? ` · ${step.name}` : ''}
                  {step.paid ? ' · paid' : ' · not paid'}
                </span>
                <span className="num">{money(step.after)}</span>
              </li>
            ))}
          </ol>
          <p className="note">Checked items count toward “Remaining now”. Unchecked items stay in the plan only.</p>
        </section>
      </div>

      <section className="card">
        <div className="label">Also track</div>
        <h3>Cards and side notes</h3>
        <p className="note">
          Prime, Credit One, Capital One, Apple Card, Chevron Card, and the circled $45 / $40 stay here. They do not change the paycheck math above.
        </p>
        <div className="check-list">
          {otherItems.map(item => (
            <ItemRow key={item.id} item={item} onChange={setItem} onRemove={removeItem} />
          ))}
        </div>
        <button className="btn" type="button" onClick={() => addItem(true)}>+ Add side item</button>
      </section>

      <section className="card">
        <div className="label">Paycheck history</div>
        <h3>Review past paychecks</h3>
        <p className="note">
          After you close a paycheck, it stays here so you can see which check paid what and how much was left.
        </p>
        {history.length ? (
          <div className="history-list-wrap">
            {history.map(entry => <HistoryCard key={entry.id} entry={entry} />)}
          </div>
        ) : (
          <p className="note">No closed paychecks yet. Use “Close paycheck & save history” when this notepad is done.</p>
        )}
      </section>
    </div>
  )
}
