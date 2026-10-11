export const THEME_KEY = 'payday-theme'

export const THEME_OPTIONS = [
  { id: 'system', label: 'Match phone', note: 'Follows light or dark mode on this device' },
  { id: 'light', label: 'Light', note: 'Always use the light look' },
  { id: 'dark', label: 'Dark', note: 'Always use the dark look' },
]

export function loadTheme(storage = localStorage) {
  const value = storage.getItem(THEME_KEY)
  if (value === 'light' || value === 'dark' || value === 'system') return value
  return 'system'
}

export function applyTheme(theme, root = document.documentElement, storage = localStorage) {
  const next = theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system'
  if (next === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', next)
  storage.setItem(THEME_KEY, next)
  return next
}

export function formatIdleLabel(idleMs) {
  const ms = Number(idleMs)
  if (!Number.isFinite(ms) || ms <= 0) return '1 hour'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(minutes / 60)
  if (Math.abs(minutes - hours * 60) <= 2) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${minutes} minutes`
}
