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

function DebtFields({ idPrefix, name, setName, total, setTotal, opened, setOpened, note, setNote }) {
  return (
    <>
      <label className="field" htmlFor={`${idPrefix}-name`}>
        <span className="label">Name</span>
        <input
          id={`${idPrefix}-name`}
          type="text"
          maxLength={60}
          placeholder="Car loan, credit card, Dad…"
          value={name}
          onChange={ev => setName(ev.target.value)}
        />
      </label>
      <div className="debt-fields">
        <label className="field" htmlFor={`${idPrefix}-total`}>
          <span className="label">Amount owed</span>
          <input
            id={`${idPrefix}-total`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={total}
            onChange={ev => setTotal(ev.target.value)}
          />
        </label>
        <label className="field" htmlFor={`${idPrefix}-opened`}>
          <span className="label">Opened</span>
          <input
            id={`${idPrefix}-opened`}
            type="date"
            value={opened}
            onChange={ev => setOpened(ev.target.value)}
          />
        </label>
      </div>
      <label className="field" htmlFor={`${idPrefix}-note`}>
        <span className="label">Note</span>
        <input
          id={`${idPrefix}-note`}
          type="text"
          maxLength={200}
          placeholder="Optional details"
          value={note}
          onChange={ev => setNote(ev.target.value)}
        />
      </label>
    </>
  )
}

function PaymentFields({ idPrefix, amount, setAmount, day, setDay, note, setNote }) {
  return (
    <>
      <div className="debt-fields">
        <label className="field" htmlFor={`${idPrefix}-amount`}>
          <span className="label">Amount paid</span>
          <input
            id={`${idPrefix}-amount`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={ev => setAmount(ev.target.value)}
          />
        </label>
        <label className="field" htmlFor={`${idPrefix}-day`}>
          <span className="label">Date paid</span>
          <input
            id={`${idPrefix}-day`}
            type="date"
            value={day}
            onChange={ev => setDay(ev.target.value)}
          />
        </label>
      </div>
      <label className="field" htmlFor={`${idPrefix}-note`}>
        <span className="label">Note</span>
        <input
          id={`${idPrefix}-note`}
          type="text"
          maxLength={200}
          placeholder="What this payment was for"
          value={note}
          onChange={ev => setNote(ev.target.value)}
        />
      </label>
    </>
  )
}

function PaymentRow({ debtId, pay, onSave, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(String(pay.amount))
  const [day, setDay] = useState(pay.day)
  const [note, setNote] = useState(pay.note || '')
  const [bad, setBad] = useState(false)

  function startEdit() {
    setAmount(String(pay.amount))
    setDay(pay.day)
    setNote(pay.note || '')
    setBad(false)
    setEditing(true)
  }

  function submit(ev) {
    ev.preventDefault()
    const nextAmount = money2(amount)
    if (!(nextAmount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setBad(true)
      return
    }
    onSave(debtId, { ...pay, day, amount: nextAmount, note: note.trim() })
    setEditing(false)
  }

  if (editing) {
    return (
      <form className="debt-form debt-edit" onSubmit={submit}>
        <div className="label">Edit payment</div>
        <PaymentFields
          idPrefix={`edit-pay-${pay.id}`}
          amount={amount}
          setAmount={setAmount}
          day={day}
          setDay={setDay}
          note={note}
          setNote={setNote}
        />
        {bad ? <p className="note bad">Enter an amount greater than zero and a date.</p> : null}
        <div className="debt-actions">
          <button className="btn primary" type="submit">Save payment</button>
          <button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    )
  }

  return (
    <div className="share debt-pay">
      <span className="jobname">{fmtShort(pay.day)}</span>
      <span className="num">{money(pay.amount)}</span>
      <span className="note">{pay.note || 'Payment'}</span>
      <div className="debt-row-actions">
        <button className="btn ghost" type="button" onClick={startEdit}>Edit</button>
        <button className="btn ghost danger" type="button" onClick={() => onRemove(debtId, pay.id)}>Remove</button>
      </div>
    </div>
  )
}

function DebtCard({ debt, today, onPay, onSaveDebt, onSavePay, onRemovePay, onRemoveDebt }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(debt.name)
  const [total, setTotal] = useState(String(debt.total))
  const [opened, setOpened] = useState(debt.opened)
  const [note, setNote] = useState(debt.note || '')
  const [bad, setBad] = useState(false)

  const [amount, setAmount] = useState('')
  const [day, setDay] = useState(today)
  const [payNote, setPayNote] = useState('')
  const [payBad, setPayBad] = useState(false)

  function startEdit() {
    setName(debt.name)
    setTotal(String(debt.total))
    setOpened(debt.opened)
    setNote(debt.note || '')
    setBad(false)
    setEditing(true)
  }

  function saveDebt(ev) {
    ev.preventDefault()
    const nextTotal = money2(total)
    const cleanName = name.trim()
    if (!cleanName || !(nextTotal > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(opened)) {
      setBad(true)
      return
    }
    onSaveDebt({
      ...debt,
      name: cleanName,
      total: nextTotal,
      note: note.trim(),
      opened,
    })
    setEditing(false)
  }

  function submitPayment(ev) {
    ev.preventDefault()
    const pay = money2(amount)
    if (!(pay > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setPayBad(true)
      return
    }
    setPayBad(false)
    onPay(debt.id, { id: uid(), day, amount: pay, note: payNote.trim() })
    setAmount('')
    setPayNote('')
    setDay(today)
  }

  const pct = debt.total > 0 ? Math.min(100, Math.round((debt.paid / debt.total) * 100)) : 0

  if (editing) {
    return (
      <section className="card debt-card">
        <form className="debt-form" onSubmit={saveDebt}>
          <div className="label">Edit debt</div>
          <DebtFields
            idPrefix={`edit-debt-${debt.id}`}
            name={name}
            setName={setName}
            total={total}
            setTotal={setTotal}
            opened={opened}
            setOpened={setOpened}
            note={note}
            setNote={setNote}
          />
          {bad ? <p className="note bad">Enter a name and an amount greater than zero.</p> : null}
          <div className="debt-actions">
            <button className="btn primary" type="submit">Save debt</button>
            <button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      </section>
    )
  }

  return (
    <section className="card debt-card">
      <div className="top">
        <div>
          <div className="label">Debt</div>
          <h2>{debt.name}</h2>
        </div>
        <div className="debt-row-actions">
          <button className="btn ghost" type="button" onClick={startEdit}>Edit</button>
          <button className="btn ghost danger" type="button" onClick={() => onRemoveDebt(debt.id)}>Remove</button>
        </div>
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
            <PaymentRow
              key={pay.id}
              debtId={debt.id}
              pay={pay}
              onSave={onSavePay}
              onRemove={onRemovePay}
            />
          ))}
        </div>
      )}

      <form className="debt-form" onSubmit={submitPayment}>
        <div className="label">Log a payment</div>
        <PaymentFields
          idPrefix={`pay-${debt.id}`}
          amount={amount}
          setAmount={setAmount}
          day={day}
          setDay={setDay}
          note={payNote}
          setNote={setPayNote}
        />
        {payBad ? <p className="note bad">Enter an amount greater than zero and a date.</p> : null}
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

  function saveDebt(nextDebt) {
    persist(list.map(debt => (debt.id === nextDebt.id ? { ...debt, ...nextDebt } : debt)))
  }

  function savePayment(debtId, nextPay) {
    persist(list.map(debt => (
      debt.id === debtId
        ? { ...debt, payments: debt.payments.map(p => (p.id === nextPay.id ? nextPay : p)) }
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
      <div className="debt-top">
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
            <DebtFields
              idPrefix="new-debt"
              name={name}
              setName={setName}
              total={total}
              setTotal={setTotal}
              opened={opened}
              setOpened={setOpened}
              note={note}
              setNote={setNote}
            />
            {bad ? <p className="note bad">Enter a name and an amount greater than zero.</p> : null}
            <button className="btn primary" type="submit">Add debt</button>
          </form>
        </section>
      </div>

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
          onSaveDebt={saveDebt}
          onSavePay={savePayment}
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
