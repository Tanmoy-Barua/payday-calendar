export const P = s => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
export const S = dt => dt.toISOString().slice(0, 10)
export const add = (s, n) => {
  const d = P(s)
  d.setUTCDate(d.getUTCDate() + n)
  return S(d)
}
export const diff = (a, b) => Math.round((P(b) - P(a)) / 864e5)
export const lastDom = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
export const ymd = (y, m, d) => S(new Date(Date.UTC(y, m, d)))
export const localToday = () => {
  const n = new Date()
  return ymd(n.getFullYear(), n.getMonth(), n.getDate())
}
export const fmtLong = s => P(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
export const fmtShort = s => P(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
export const fmtTodayLine = s => P(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
export const fmtMonth = (y, m) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export const money = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
export const moneyShort = n => (n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : '$' + Math.round(n))
export const hrs = n => (Math.round(n * 100) / 100) + 'h'
export const uid = () => Math.random().toString(36).slice(2, 9)
