import { money } from '../dates.js'
import {
  defaultBudgetNote,
  newItemId,
  plannedRemaining,
  remainingAfterPaid,
  runningSteps,
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

export default function Checklist({ budget, onSave }) {
  const note = budget?.items ? budget : defaultBudgetNote()
  const mainItems = note.items.filter(item => !item.separate)
  const otherItems = note.items.filter(item => item.separate)
  const left = remainingAfterPaid(note.starting, note.items)
  const planned = plannedRemaining(note.starting, note.items)
  const { steps } = runningSteps(note.starting, note.items)
  const paidCount = mainItems.filter(item => item.paid).length

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

  return (
    <div className="checklist">
      <section className="card checklist-hero">
        <div className="label">Notepad</div>
        <h2>{note.title || 'Budget Note'}</h2>
        <p className="note">
          Check each payment when you pay it. The remaining balance updates as you go, like your paper notepad.
        </p>
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
            <p className="note">Your notepad final was $74</p>
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
          Prime, Credit One, Capital One, Apple Card, Chevron Card, and the circled $45 / $40 stay here. They do not change the $2,200 math above.
        </p>
        <div className="check-list">
          {otherItems.map(item => (
            <ItemRow key={item.id} item={item} onChange={setItem} onRemove={removeItem} />
          ))}
        </div>
        <button className="btn" type="button" onClick={() => addItem(true)}>+ Add side item</button>
      </section>
    </div>
  )
}
