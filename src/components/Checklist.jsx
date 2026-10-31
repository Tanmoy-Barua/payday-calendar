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
  allCompaniesTwoWeeks,
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
            placeholder={item.separate ? 'Note' : 'Name'}
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
  const selected = jobs.length ? allCompaniesTwoWeeks(jobs, months, today) : null
  const starting = selected ? selected.amount : 0
  const [confirmClose, setConfirmClose] = useState(false)
  const mainItems = note.items.filter(item => !item.separate)
  const otherItems = note.items.filter(item => item.separate)
  const left = remainingAfterPaid(starting, note.items)
  const planned = plannedRemaining(starting, note.items)
  const { steps } = runningSteps(starting, note.items)
  const paidCount = mainItems.filter(item => item.paid).length
  const sidePaidCount = otherItems.filter(item => item.paid).length
  const history = note.history || []
  const canClose = note.items.length > 0

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
    setConfirmClose(true)
  }

  function cancelClose() {
    setConfirmClose(false)
  }

  function confirmCloseNow() {
    const linkedNote = selected ? applyPaycheckSource(note, selected) : { ...note, starting }
    const nextPay = nextPaycheckAfter(jobs, months, linkedNote.paycheckDate || selected?.payday)
    const { budget: closed } = closePaycheckBudget(linkedNote, { nextPaycheck: nextPay })
    setConfirmClose(false)
    update(closed)
  }

  return (
    <div className="checklist">
      <section className="card checklist-hero">
        <div className="label">Notepad</div>
        <h2>{note.title || 'Budget Note'}</h2>
        <p className="note">
          Starting amount is one total from every job in the last 2 weeks. Add the payments for this paycheck below. When you close it, those rows are saved to history and this list starts empty so you can add the next paycheck’s bills.
        </p>

        <div className="paycheck-source">
          <div>
            <div className="label">This paycheck</div>
            {selected ? (
              <p className="paycheck-one-total num">{money(selected.amount)}</p>
            ) : (
              <p className="note">Add a pay schedule so this total can follow your earnings.</p>
            )}
            {selected ? (
              <p className="note">
                All jobs · 2 weeks {fmtShort(selected.range.start)}–{fmtShort(selected.range.end)}
                {selected.payday ? ` · next payday ${fmtShort(selected.payday)}` : ''}
              </p>
            ) : null}
          </div>
          {canClose ? (
          <div className="paycheck-actions">
            <button className="btn primary" type="button" onClick={closeCurrent}>
              Close paycheck & save history
            </button>
          </div>
          ) : history.length ? (
            <p className="note">This paycheck is closed. Add payments below when you start the next one.</p>
          ) : null}
          {canClose && confirmClose ? (
            <div className="paycheck-confirm" role="dialog" aria-labelledby="close-paycheck-title">
              <p id="close-paycheck-title" className="paycheck-confirm-title">Close this paycheck now?</p>
              <p className="note">
                Yes saves it to history and clears the pay checklist so you add rows for the next paycheck. Later leaves everything as it is.
              </p>
              <div className="paycheck-confirm-actions">
                <button className="btn primary" type="button" onClick={confirmCloseNow}>Yes, close now</button>
                <button className="btn" type="button" onClick={cancelClose}>Later</button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="checklist-stats">
          <div>
            <div className="label">Starting amount</div>
            <div className="checklist-remain num" aria-live="polite">{money(starting)}</div>
            <p className="note">All jobs · 2-week total · not editable</p>
            {selected?.breakdown?.length ? (
              <ul className="starting-breakdown" aria-label="Starting amount by company">
                {selected.breakdown.map(row => (
                  <li key={row.jobId}>
                    <span className="starting-breakdown-name">{row.jobName}</span>
                    <span className="num starting-breakdown-amount">{money(row.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div>
            <div className="label">Remaining now</div>
            <div className="checklist-remain num">{money(left)}</div>
            <p className="note">
              {paidCount} of {mainItems.length} main marked paid
              {sidePaidCount ? ` · ${sidePaidCount} card/side paid` : ''}
            </p>
          </div>
          <div>
            <div className="label">If all main payments paid</div>
            <div className="num">{money(planned)}</div>
            <p className="note">Main plan leftover, minus card bills marked paid</p>
          </div>
        </div>
      </section>

      <div className="checklist-grid">
        <section className="card">
          <div className="label">Pay checklist</div>
          <h3>Mark paid or not paid</h3>
          <p className="note">Choose category Debt to link a row to a debt. Checking paid logs that amount against it.</p>
          <div className="check-list">
            {mainItems.length ? mainItems.map(item => (
              <ItemRow
                key={item.id}
                item={item}
                debts={debts}
                onChange={setItem}
                onRemove={removeItem}
              />
            )) : (
              <p className="note">No payments yet. Add the bills for this paycheck.</p>
            )}
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
          <p className="note">Checked main and card items count toward “Remaining now”. Unchecked main items stay in the plan leftover.</p>
        </section>
      </div>

      <section className="card">
        <div className="label">Also track</div>
        <h3>Cards and side notes</h3>
        <p className="note">
          Prime, Credit One, Capital One, Apple Card, Chevron Card, and similar notes stay here. Mark paid to subtract them from Remaining now and from the leftover above.
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
