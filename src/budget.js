export const SPEND_SHARES = [
  { id: 'essentials', name: 'Essentials/Dad', rate: 0.5 },
  { id: 'debt', name: 'Debt', rate: 0.3 },
  { id: 'savings', name: 'Savings', rate: 0.05 },
  { id: 'investment', name: 'Investment', rate: 0.05 },
  { id: 'wants', name: 'Wants', rate: 0.05 },
  { id: 'emergency', name: 'Emergency buffer', rate: 0.05 },
]

export const DEFAULT_MONTHLY_INCOME = 4000

export function splitEarnings(income) {
  const cents = Math.round((Number(income) || 0) * 100)
  const rows = SPEND_SHARES.map(item => ({
    ...item,
    cents: Math.round(cents * item.rate),
  }))
  const drift = cents - rows.reduce((sum, row) => sum + row.cents, 0)
  rows[rows.length - 1].cents += drift
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    rate: row.rate,
    pct: Math.round(row.rate * 100),
    amount: row.cents / 100,
  }))
}
