import { useState } from 'react'
import { fmtLong, fmtShort, localToday, money, uid } from '../dates.js'

function money2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function withTotals(list) {
  return list.map(debt => {
    const payments = [...(debt.payments || [])].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
    const paid = money2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0))
    const total = money2(debt.total)
    return { ...debt, total, payments, paid, remaining: money2(Math.max(0, total - paid)) }
  })
}

function DebtCard({ debt, today, onPay, onRemovePay, onRemoveDebt }) {
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState(today)
  const [note, setNote] = useState('')
  const [bad, setBad] = useState(false)

  function submit(ev) {
    ev.preventDefault()
    const pay = money2(amount)
    if (!(pay > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setBad(true)
      return
    }
    setBad(false)
    onPay(debt.id, { id: uid(), day, amount: pay, note: note.trim() })
    setAmount('')
    setNote('')
    setDay(today)
  }

  const pct = debt.total > 0 ? Math.min(100, Math.round((debt.paid / debt.total) * 100)) : 0

  return (
    <section className="card debt-card">
      <div className="top">
        <div>
          <div className="label">Debt</div>
          <h2>{debt.name}</h2>
        </div>
        <button className="btn ghost danger" type="button" onClick={() => onRemoveDebt(debt.id)}>Remove</button>
      </div>
      {debt.note ? <p className="note">{debt.note}</p> : null}
      <div className="debt-stats">
        <div>
          <div className="label">Still owed</div>
          <div className="big num">{money(debt.remaining)}</div>
        </div>
        <div>
          <div className="label">Paid</div>
          <div className="num">{money(debt.paid)}</div>
        </div>
        <div>
          <div className="label">Original</div>
          <div className="num">{money(debt.total)}</div>
        </div>
      </div>
      <div className="bar" aria-hidden="true">
        <i style={{ width: `${pct}%`, background: 'var(--j3)' }} />
      </div>
      <p className="note">Opened {fmtLong(debt.opened)} · {pct}% paid</p>

      <div className="label">Payments</div>
      {debt.payments.length === 0 ? (
        <p className="note">No payments logged yet.</p>
      ) : (
        <div className="shares">
          {debt.payments.map(pay => (
            <div className="share debt-pay" key={pay.id}>
              <span className="jobname">{fmtShort(pay.day)}</span>
              <span className="num">{money(pay.amount)}</span>
              <span className="note">{pay.note || 'Payment'}</span>
              <button className="btn ghost danger" type="button" onClick={() => onRemovePay(debt.id, pay.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      <form className="debt-form" onSubmit={submit}>
        <div className="label">Log a payment</div>
        <div className="debt-fields">
          <label className="field" htmlFor={`pay-amount-${debt.id}`}>
            <span className="label">Amount paid</span>
            <input
              id={`pay-amount-${debt.id}`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={ev => setAmount(ev.target.value)}
            />
          </label>
          <label className="field" htmlFor={`pay-day-${debt.id}`}>
            <span className="label">Date paid</span>
            <input
              id={`pay-day-${debt.id}`}
              type="date"
              value={day}
              onChange={ev => setDay(ev.target.value)}
            />
          </label>
        </div>
        <label className="field" htmlFor={`pay-note-${debt.id}`}>
          <span className="label">Note</span>
          <input
            id={`pay-note-${debt.id}`}
            type="text"
            maxLength={200}
            placeholder="What this payment was for"
            value={note}
            onChange={ev => setNote(ev.target.value)}
          />
        </label>
        {bad ? <p className="note bad">Enter an amount greater than zero and a date.</p> : null}
        <button className="btn primary" type="submit">Save payment</button>
      </form>
    </section>
  )
}

export default function Debt({ debts, onSave }) {
  const today = localToday()
  const list = withTotals(debts)
  const owed = money2(list.reduce((sum, d) => sum + d.remaining, 0))
  const paid = money2(list.reduce((sum, d) => sum + d.paid, 0))

  const [name, setName] = useState('')
  const [total, setTotal] = useState('')
  const [note, setNote] = useState('')
  const [opened, setOpened] = useState(today)
  const [bad, setBad] = useState(false)

  function persist(next) {
    onSave(withTotals(next))
  }

  function addDebt(ev) {
    ev.preventDefault()
    const amount = money2(total)
    const cleanName = name.trim()
    if (!cleanName || !(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(opened)) {
      setBad(true)
      return
    }
    setBad(false)
    persist([
      ...list,
      {
        id: uid(),
        name: cleanName,
        total: amount,
        note: note.trim(),
        opened,
        payments: [],
      },
    ])
    setName('')
    setTotal('')
    setNote('')
    setOpened(today)
  }

  function addPayment(debtId, payment) {
    persist(list.map(debt => (
      debt.id === debtId
        ? { ...debt, payments: [...debt.payments, payment] }
        : debt
    )))
  }

  function removePayment(debtId, paymentId) {
    persist(list.map(debt => (
      debt.id === debtId
        ? { ...debt, payments: debt.payments.filter(p => p.id !== paymentId) }
        : debt
    )))
  }

  function removeDebt(debtId) {
    persist(list.filter(debt => debt.id !== debtId))
  }

  return (
    <div className="spend debt-page">
      <section className="card">
        <div className="label">Debt tracker</div>
        <h2>What you still owe</h2>
        <p className="note">Add each debt, then log every payment with a short note so the balance stays up to date.</p>
        <div className="debt-stats">
          <div>
            <div className="label">Still owed</div>
            <div className="big num">{money(owed)}</div>
          </div>
          <div>
            <div className="label">Paid so far</div>
            <div className="num">{money(paid)}</div>
          </div>
          <div>
            <div className="label">Debts</div>
            <div className="num">{list.length}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="label">Add a debt</div>
        <form className="debt-form" onSubmit={addDebt}>
          <label className="field" htmlFor="debtName">
            <span className="label">Name</span>
            <input
              id="debtName"
              type="text"
              maxLength={60}
              placeholder="Car loan, credit card, Dad…"
              value={name}
              onChange={ev => setName(ev.target.value)}
            />
          </label>
          <div className="debt-fields">
            <label className="field" htmlFor="debtTotal">
              <span className="label">Amount owed</span>
              <input
                id="debtTotal"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={total}
                onChange={ev => setTotal(ev.target.value)}
              />
            </label>
            <label className="field" htmlFor="debtOpened">
              <span className="label">Opened</span>
              <input
                id="debtOpened"
                type="date"
                value={opened}
                onChange={ev => setOpened(ev.target.value)}
              />
            </label>
          </div>
          <label className="field" htmlFor="debtNote">
            <span className="label">Note</span>
            <input
              id="debtNote"
              type="text"
              maxLength={200}
              placeholder="Optional details"
              value={note}
              onChange={ev => setNote(ev.target.value)}
            />
          </label>
          {bad ? <p className="note bad">Enter a name and an amount greater than zero.</p> : null}
          <button className="btn primary" type="submit">Add debt</button>
        </form>
      </section>

      {list.length === 0 ? (
        <section className="card">
          <p className="note">No debts saved yet. Add one above to start the record.</p>
        </section>
      ) : list.map(debt => (
        <DebtCard
          key={debt.id}
          debt={debt}
          today={today}
          onPay={addPayment}
          onRemovePay={removePayment}
          onRemoveDebt={removeDebt}
        />
      ))}

      <div className="debt-links">
        <a className="btn" href="#spend">Back to spending</a>
        <a className="btn" href="#calendar">Back to the calendar</a>
      </div>
    </div>
  )
}
