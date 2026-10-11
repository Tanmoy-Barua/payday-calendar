import { useEffect, useState } from 'react'
import { fmtShort, localToday, money } from '../dates.js'
import {
  ITEM_CATEGORIES,
  applyPaycheckSource,
  closePaycheckBudget,
  defaultBudgetNote,
  newItemId,
  nextPaycheckAfter,
  normalizeBudgetItem,
  plannedRemaining,
  remainingAfterPaid,
  runningSteps,
  syncDebtsWithChecklist,
  upcomingPaychecks,
} from '../checklist.js'

function emptyItem(separate = false) {
  return normalizeBudgetItem({
    id: newItemId(),
    name: '',
    amount: '',
    paid: false,
    separate,
    category: 'other',
    debtId: '',
    debtPaymentId: '',
  })
}

function ItemRow({ item, debts, onChange, onRemove }) {
  const isDebt = !item.separate && item.category === 'debt'
  const debtOptions = debts || []

  function patch(partial) {
    onChange(normalizeBudgetItem({ ...item, ...partial }))
  }

  return (
    <div className={`check-row${item.paid ? ' is-paid' : ''}${isDebt ? ' is-debt' : ''}`}>
      <input
        type="checkbox"
        checked={!!item.paid}
        onChange={ev => patch({ paid: ev.target.checked })}
        aria-label={item.paid ? 'Mark not paid' : 'Mark paid'}
      />
      <div className="check-fields">
        {!item.separate ? (
          <label className="field check-category">
            <span className="label">Category</span>
            <select
              aria-label="Category"
              value={item.category === 'debt' ? 'debt' : 'other'}
              onChange={ev => {
                const category = ev.target.value === 'debt' ? 'debt' : 'other'
                if (category === 'debt') {
                  const first = debtOptions[0]
                  patch({
                    category,
                    debtId: item.debtId || first?.id || '',
                    name: item.debtId
                      ? (debtOptions.find(d => d.id === item.debtId)?.name || item.name)
                      : (first?.name || item.name),
                  })
                  return
                }
                patch({ category, debtId: '', debtPaymentId: item.paid ? item.debtPaymentId : '' })
              }}
            >
              {ITEM_CATEGORIES.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        {isDebt ? (
          <label className="field check-debt">
            <span className="label">Debt</span>
            <select
              aria-label="Debt"
              value={item.debtId || ''}
              onChange={ev => {
                const debtId = ev.target.value
                const debt = debtOptions.find(row => row.id === debtId)
                patch({ debtId, name: debt?.name || item.name })
              }}
              disabled={!debtOptions.length}
            >
              {!debtOptions.length ? <option value="">Add a debt first</option> : null}
              {debtOptions.map(debt => (
                <option key={debt.id} value={debt.id}>{debt.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <input
            className="check-name"
            type="text"
            placeholder={item.separate ? 'Card or note' : 'What this payment is'}
            value={item.name}
            onChange={ev => patch({ name: ev.target.value })}
          />
        )}
        <input
          className="check-amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="$"
          aria-label="Amount"
          value={item.amount === '' || item.amount == null ? '' : item.amount}
          onChange={ev => {
            const next = ev.target.value
            if (next === '') {
              patch({ amount: '' })
              return
            }
            if (!/^\d*\.?\d*$/.test(next)) return
            patch({ amount: next })
          }}
        />
      </div>
      <button className="btn ghost check-remove" type="button" onClick={() => onRemove(item.id)} aria-label="Remove item">
        ×
      </button>
      {isDebt && item.paid ? (
        <p className="note check-debt-hint">Paid amount is deducted on the Debt page</p>
      ) : null}
    </div>
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
                  <span>
                    {row.name}
                    {row.category === 'debt' ? ' · debt' : ''}
                  </span>
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

export default function Checklist({
  budget,
  onSave,
  debts = [],
  onSaveDebts,
  jobs = [],
  months = {},
  today = localToday(),
}) {
  const note = budget?.items ? {
    ...budget,
    items: budget.items.map(normalizeBudgetItem),
  } : defaultBudgetNote()
  const paychecks = upcomingPaychecks(jobs, months, today)
  const selected = paychecks.find(row => row.jobId === note.jobId && row.payday === note.paycheckDate)
    || paychecks.find(row => row.jobId === note.jobId)
    || paychecks[0]
    || null
  // Starting amount always comes from the selected next paycheck — not editable.
  const starting = selected ? selected.amount : 0
  const mainItems = note.items.filter(item => !item.separate)
  const otherItems = note.items.filter(item => item.separate)
  const left = remainingAfterPaid(starting, note.items)
  const planned = plannedRemaining(starting, note.items)
  const { steps } = runningSteps(starting, note.items)
  const paidCount = mainItems.filter(item => item.paid).length
  const history = note.history || []

  function commitItems(nextItems) {
    const synced = syncDebtsWithChecklist(debts, note.items, nextItems, { today })
    onSave({ ...note, starting, items: synced.items })
    if (onSaveDebts) onSaveDebts(synced.debts)
  }

  function update(next) {
    onSave(next)
  }

  function setItem(nextItem) {
    commitItems(note.items.map(item => (item.id === nextItem.id ? nextItem : item)))
  }

  function removeItem(id) {
    commitItems(note.items.filter(item => item.id !== id))
  }

  function addItem(separate) {
    commitItems(note.items.concat(emptyItem(separate)))
  }

  function choosePaycheck(jobId) {
    const paycheck = paychecks.find(row => row.jobId === jobId) || paychecks[0]
    if (!paycheck) return
    update(applyPaycheckSource(note, paycheck))
  }

  useEffect(() => {
    if (!selected) return
    const linked =
      note.jobId === selected.jobId
      && note.paycheckDate === selected.payday
      && Number(note.starting) === Number(selected.amount)
      && note.paycheckLabel === selected.label
    if (linked) return
    update(applyPaycheckSource(note, selected))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.jobId, selected?.payday, selected?.amount, selected?.label])

  function closeCurrent() {
    if (!window.confirm('Close this paycheck budget and save it to history? Paid marks will reset for the next check. Debt payments already logged stay on the Debt page.')) return
    const linkedNote = selected ? applyPaycheckSource(note, selected) : { ...note, starting }
    const nextPay = nextPaycheckAfter(jobs, months, linkedNote.paycheckDate || selected?.payday, linkedNote.jobId || selected?.jobId)
    const { budget: closed } = closePaycheckBudget(linkedNote, { nextPaycheck: nextPay })
    update(closed)
  }

  return (
    <div className="checklist">
      <section className="card checklist-hero">
        <div className="label">Notepad</div>
        <h2>{note.title || 'Budget Note'}</h2>
        <p className="note">
          Starting amount is locked to your next paycheck. Set a payment category to Debt to pick a debt name — when you mark it paid, that amount is deducted on the Debt page.
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
            <button className="btn primary" type="button" onClick={closeCurrent}>
              Close paycheck & save history
            </button>
          </div>
          {selected ? (
            <p className="note">Starting amount updates automatically from this paycheck.</p>
          ) : (
            <p className="note">Add a pay schedule so the starting amount can follow your next paycheck.</p>
          )}
        </div>

        <div className="checklist-stats">
          <div>
            <div className="label">Starting amount</div>
            <div className="checklist-remain num" aria-live="polite">{money(starting)}</div>
            <p className="note">From next paycheck · not editable</p>
          </div>
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
          <p className="note">Choose category Debt to link a row to a debt. Checking paid logs that amount against it.</p>
          <div className="check-list">
            {mainItems.map(item => (
              <ItemRow
                key={item.id}
                item={item}
                debts={debts}
                onChange={setItem}
                onRemove={removeItem}
              />
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
              <span className="num">{money(starting)}</span>
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
            <ItemRow
              key={item.id}
              item={item}
              debts={debts}
              onChange={setItem}
              onRemove={removeItem}
            />
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
