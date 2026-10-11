import { useEffect, useState } from 'react'
import { fmtLong, fmtMonth, fmtShort, fmtTodayLine, localToday, money, uid } from '../dates.js'
import {
  DEFAULT_EVERY_DAYS,
  MONTHLY_PAY_KEY,
  PAY_EVERY,
  everyLabel,
  finishDate,
  monthsToFinish,
  planFromPayments,
} from '../debt.js'

function readMonthlyPay() {
  const saved = localStorage.getItem(MONTHLY_PAY_KEY)
  if (saved == null || saved === '') return ''
  const amount = Number(saved)
  return Number.isFinite(amount) && amount >= 0 ? String(amount) : ''
}

function money2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function withTotals(list) {
  return list.map(debt => {
    const payments = [...(debt.payments || [])].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
    const paid = money2(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0))
    const total = money2(debt.total)
    const payment = debt.payment === '' || debt.payment == null ? '' : money2(debt.payment)
    const everyDays = [7, 14, 30].includes(Number(debt.everyDays)) ? Number(debt.everyDays) : DEFAULT_EVERY_DAYS
    return {
      ...debt,
      total,
      payment,
      everyDays,
      payments,
      paid,
      remaining: money2(Math.max(0, total - paid)),
    }
  })
}

function debtFinish(debt, today) {
  const planned = Number(debt.payment) > 0
    ? { payment: money2(debt.payment), everyDays: debt.everyDays || DEFAULT_EVERY_DAYS }
    : planFromPayments(debt.payments)
  if (!planned) {
    return { ...finishDate({ remaining: debt.remaining, payment: 0, everyDays: 14, today }), source: null }
  }
  const lastPaid = debt.payments.length ? debt.payments[debt.payments.length - 1].day : null
  return {
    ...finishDate({
      remaining: debt.remaining,
      payment: planned.payment,
      everyDays: planned.everyDays,
      today,
      lastPaid,
    }),
    source: planned,
    fromHistory: !(Number(debt.payment) > 0),
  }
}

function DebtFields({
  idPrefix,
  name, setName,
  total, setTotal,
  opened, setOpened,
  note, setNote,
  payment, setPayment,
  everyDays, setEveryDays,
}) {
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
      <div className="debt-fields">
        <label className="field" htmlFor={`${idPrefix}-payment`}>
          <span className="label">Payment each time</span>
          <input
            id={`${idPrefix}-payment`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="e.g. 200"
            value={payment}
            onChange={ev => setPayment(ev.target.value)}
          />
        </label>
        <label className="field" htmlFor={`${idPrefix}-every`}>
          <span className="label">How often</span>
          <select
            id={`${idPrefix}-every`}
            value={everyDays}
            onChange={ev => setEveryDays(Number(ev.target.value))}
          >
            {PAY_EVERY.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
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

function FinishLine({ debt, today }) {
  const finish = debtFinish(debt, today)
  if (finish.done) {
    return (
      <div className="debt-finish done">
        <div className="label">When it finishes</div>
        <div className="num">Paid off</div>
      </div>
    )
  }
  if (!finish.day) {
    return (
      <div className="debt-finish">
        <div className="label">When it finishes</div>
        <p className="note">Set a payment amount to see the finish date.</p>
      </div>
    )
  }
  return (
    <div className="debt-finish">
      <div className="label">When it finishes</div>
      <div className="num">{fmtTodayLine(finish.day)}</div>
      <p className="note">
        {finish.paymentsLeft} more payment{finish.paymentsLeft === 1 ? '' : 's'}
        {' · '}
        {money(finish.source.payment)} {everyLabel(finish.source.everyDays)}
        {finish.fromHistory ? ' · from your payment history' : ''}
      </p>
    </div>
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
  const [payment, setPayment] = useState(debt.payment === '' || debt.payment == null ? '' : String(debt.payment))
  const [everyDays, setEveryDays] = useState(debt.everyDays || DEFAULT_EVERY_DAYS)
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
    setPayment(debt.payment === '' || debt.payment == null ? '' : String(debt.payment))
    setEveryDays(debt.everyDays || DEFAULT_EVERY_DAYS)
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
      payment: payment === '' ? '' : money2(payment),
      everyDays,
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
            payment={payment}
            setPayment={setPayment}
            everyDays={everyDays}
            setEveryDays={setEveryDays}
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
      <FinishLine debt={debt} today={today} />

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
  const allDone = list.length > 0 && list.every(debt => debt.remaining <= 0)

  const [monthlyPay, setMonthlyPay] = useState(readMonthlyPay)
  const [name, setName] = useState('')
  const [total, setTotal] = useState('')
  const [note, setNote] = useState('')
  const [opened, setOpened] = useState(today)
  const [payment, setPayment] = useState('')
  const [everyDays, setEveryDays] = useState(DEFAULT_EVERY_DAYS)
  const [bad, setBad] = useState(false)

  useEffect(() => {
    if (monthlyPay === '') localStorage.removeItem(MONTHLY_PAY_KEY)
    else localStorage.setItem(MONTHLY_PAY_KEY, String(monthlyPay))
  }, [monthlyPay])

  const payoff = monthsToFinish(owed, monthlyPay, today)
  const finishMonth = payoff.day
    ? (() => {
        const [y, m] = payoff.day.split('-').map(Number)
        return fmtMonth(y, m)
      })()
    : null

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
        payment: payment === '' ? '' : money2(payment),
        everyDays,
        payments: [],
      },
    ])
    setName('')
    setTotal('')
    setNote('')
    setPayment('')
    setEveryDays(DEFAULT_EVERY_DAYS)
    setOpened(today)
  }

  function addPayment(debtId, nextPay) {
    persist(list.map(debt => (
      debt.id === debtId
        ? { ...debt, payments: [...debt.payments, nextPay] }
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
          <p className="note">Enter how much you put toward all debt each month to see how long the total takes.</p>
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
          <label className="field" htmlFor="monthlyDebtPay">
            <span className="label">I pay this much per month</span>
            <input
              id="monthlyDebtPay"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="e.g. 500"
              value={monthlyPay}
              onChange={ev => setMonthlyPay(ev.target.value === '' ? '' : String(Math.max(0, Number(ev.target.value) || 0)))}
            />
          </label>
          {allDone ? (
            <div className="debt-finish done">
              <div className="label">Total payoff</div>
              <div className="num">Paid off</div>
            </div>
          ) : payoff.months != null ? (
            <div className="debt-finish">
              <div className="label">Total payoff</div>
              <div className="big num">
                {payoff.months} month{payoff.months === 1 ? '' : 's'}
              </div>
              <p className="note">
                {money(owed)} ÷ {money(Number(monthlyPay) || 0)} a month
                {finishMonth ? ` · finishes around ${finishMonth}` : ''}
              </p>
            </div>
          ) : (
            <div className="debt-finish">
              <div className="label">Total payoff</div>
              <p className="note">Enter a monthly amount to see how many months the total debt will take.</p>
            </div>
          )}
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
              payment={payment}
              setPayment={setPayment}
              everyDays={everyDays}
              setEveryDays={setEveryDays}
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
