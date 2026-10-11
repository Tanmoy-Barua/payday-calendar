import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTheme, formatIdleLabel, loadTheme } from './settings.js'

function memoryStorage(start = {}) {
  const data = { ...start }
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null },
    setItem(key, value) { data[key] = String(value) },
    removeItem(key) { delete data[key] },
  }
}

test('theme defaults to system and can be set to light or dark', () => {
  const storage = memoryStorage()
  const root = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v }, removeAttribute(k) { delete this.attrs[k] } }
  assert.equal(loadTheme(storage), 'system')
  assert.equal(applyTheme('dark', root, storage), 'dark')
  assert.equal(root.attrs['data-theme'], 'dark')
  assert.equal(loadTheme(storage), 'dark')
  assert.equal(applyTheme('system', root, storage), 'system')
  assert.equal(root.attrs['data-theme'], undefined)
})

test('idle label formats hours and minutes', () => {
  assert.equal(formatIdleLabel(3_600_000), '1 hour')
  assert.equal(formatIdleLabel(7_200_000), '2 hours')
  assert.equal(formatIdleLabel(30 * 60_000), '30 minutes')
})
