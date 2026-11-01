import { useEffect, useState } from 'react'
import { add, fmtLong, fmtShort, localToday, money } from '../dates.js'
import {
  ITEM_CATEGORIES,
  applyPaycheckSource,
  closePaycheckBudget,
  deleteHistoryEntry,
  defaultBudgetNote,
  newItemId,
  normalizeBudgetItem,
  plannedRemaining,
  remainingAfterPaid,
  runningSteps,
  syncDebtsWithChecklist,
  activeChecklistPaycheck,
  allJobsOnPayday,
  dueInDays,
  dueLeftLabel,
} from '../checklist.js'
import { sharedPayOnOrAfter } from '../pay.js'

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
    dueDate: '',
  })
}

function ItemRow({ item, debts, onChange, onRemove, today }) {
  const isDebt = item.category === 'debt'
  const debtOptions = debts || []
  const daysLeft = dueInDays(item.dueDate, today)

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
        <label className="field check-due">
          <span className="label">Due date</span>
          <input
            className="check-due-date"
            type="date"
            aria-label="Due date"
            value={item.dueDate || ''}
            onChange={ev => patch({ dueDate: ev.target.value })}
          />
          {daysLeft == null ? (
            <span className="note check-due-left">Days left</span>
          ) : (
            <span className={`check-due-left${daysLeft < 0 ? ' is-late' : ''}${daysLeft === 0 ? ' is-today' : ''}`}>
              {dueLeftLabel(daysLeft)}
            </span>
          )}
        </label>
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

function HistoryCard({ entry, onDelete }) {
  const [open, setOpen] = useState(false)
  const paid = (entry.paid || []).filter(row => !row.separate)
  const side = (entry.paid || []).filter(row => row.separate)
  return (
    <article className="history-card">
      <div className="history-head">
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
        <button
          className="btn ghost danger history-delete"
          type="button"
          onClick={() => onDelete(entry)}
        >
          Delete
        </button>
      </div>
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
                    <span>
                      {row.name}
                      {row.category === 'debt' ? ' · debt' : ''}
                    </span>
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
  const note = Array.isArray(budget?.items)
    ? {
      ...budget,
      items: budget.items.map(normalizeBudgetItem),
      history: Array.isArray(budget.history) ? budget.history : [],
    }
    : defaultBudgetNote()
  const selected = jobs.length ? activeChecklistPaycheck(jobs, months, today, note) : null
  const starting = note.starting === '' || note.starting == null ? '' : note.starting
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

  function setStarting(raw) {
    if (raw === '') {
      update({ ...note, starting: '' })
      return
    }
    if (!/^\d*\.?\d*$/.test(raw)) return
    update({ ...note, starting: raw })
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
      && note.paycheckLabel === selected.label
    if (linked) return
    update({
      ...applyPaycheckSource(note, selected),
      items: note.items,
      history: note.history || [],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.jobId, selected?.payday, selected?.amount, selected?.label])

  function closeCurrent() {
    setConfirmClose(true)
  }

  function cancelClose() {
    setConfirmClose(false)
  }

  function confirmCloseNow() {
    if (!note.items.length) {
      setConfirmClose(false)
      return
    }
    const linkedNote = selected ? { ...applyPaycheckSource(note, selected), starting } : { ...note, starting }
    const nextPayday = selected?.cardMode === '14'
      ? sharedPayOnOrAfter(jobs, today, today)
      : sharedPayOnOrAfter(jobs, add(selected?.payday || today, 1), today)
    const nextPay = jobs.length ? allJobsOnPayday(jobs, months, nextPayday, today) : null
    const { budget: closed } = closePaycheckBudget(linkedNote, { nextPaycheck: nextPay })
    setConfirmClose(false)
    update(closed)
  }

  function removeHistory(entry) {
    const label = entry.paycheckLabel || 'this paycheck'
    if (!window.confirm(`Delete ${label} from paycheck history? This cannot be undone.`)) return
    update(deleteHistoryEntry(note, entry.id))
  }

  return (
    <div className="checklist">
      <section className="card checklist-hero">
        <div className="label">Notepad</div>
        <h2>{note.title || 'Budget Note'}</h2>
        <p className="note">
          Type the amount of this paycheck yourself. Close this notepad to save it, then type the next check when it comes in.
        </p>

        <div className="paycheck-source">
          <div>
            <label className="field paycheck-amount-field">
              <span className="label">This paycheck</span>
              <span className="paycheck-amount-wrap">
                <span className="paycheck-amount-prefix" aria-hidden="true">$</span>
                <input
                  className="paycheck-amount-input num"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="This paycheck amount"
                  value={starting}
                  onChange={ev => setStarting(ev.target.value)}
                />
              </span>
            </label>
            {selected?.isAllCompanies && selected.cardMode === '14' ? (
              <p className="note">
                Payday {selected.payday ? fmtLong(selected.payday) : ''}
                {selected.range ? ` · ${fmtShort(selected.range.start)}–${fmtShort(selected.range.end)}` : ''}
              </p>
            ) : selected ? (
              <p className="note">
                Payday {fmtLong(selected.payday)}
                {selected.range ? ` · ${fmtShort(selected.range.start)} – ${fmtShort(selected.range.end)}` : ''}
              </p>
            ) : (
              <p className="note">Enter the amount on the check. Dates follow the calendar when a job is set up.</p>
            )}
          </div>
          {canClose ? (
            <div className="paycheck-actions">
              <button className="btn primary" type="button" onClick={closeCurrent}>
                Close paycheck & save history
              </button>
            </div>
          ) : (
            <p className="note">This paycheck is closed. The next paycheck is shown here — add its payments below.</p>
          )}
          {canClose && confirmClose ? (
            <div className="paycheck-confirm" role="dialog" aria-labelledby="close-paycheck-title">
              <p id="close-paycheck-title" className="paycheck-confirm-title">Close this paycheck now?</p>
              <p className="note">
                Yes saves it to history. Paid bills uncheck. Unpaid bills stay. Cards stay too, and only their amounts clear for the next check. Later leaves everything as it is.
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
            <label className="field starting-amount-field">
              <span className="label">Starting amount</span>
              <span className="paycheck-amount-wrap">
                <span className="paycheck-amount-prefix is-lg" aria-hidden="true">$</span>
                <input
                  className="starting-amount-input num"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label="Starting amount"
                  value={starting}
                  onChange={ev => setStarting(ev.target.value)}
                />
              </span>
            </label>
            <p className="note">Type the same paycheck amount. Remaining now uses this number.</p>
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
                today={today}
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
          Choose category Debt to link a row to a debt, same as the pay checklist. Mark paid to subtract the amount from Remaining now and from the leftover above.
        </p>
        <div className="check-list">
          {otherItems.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              debts={debts}
              today={today}
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
            {history.map(entry => (
              <HistoryCard key={entry.id} entry={entry} onDelete={removeHistory} />
            ))}
          </div>
        ) : (
          <p className="note">No closed paychecks yet. Use “Close paycheck & save history” when this notepad is done.</p>
        )}
      </section>
    </div>
  )
}
