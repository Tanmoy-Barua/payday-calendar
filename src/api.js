async function request(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || 'request failed')
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

async function send(url, body) {
  return request(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function loadAuthStatus() {
  return request('/api/auth/status')
}

export function setupAuth(pin, credId) {
  return request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ pin, credId: credId || '' }),
  })
}

export function loginAuth(pin, credId) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ pin, credId: credId || '' }),
  })
}

export function logoutAuth() {
  return request('/api/auth/logout', { method: 'POST', body: '{}' })
}

export function disableAuth(pin) {
  return request('/api/auth/disable', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  })
}

export function loadState() {
  return request('/api/state')
}

export function saveJobs(jobs) {
  return send('/api/jobs', { jobs })
}

export function saveMonth(ym, days) {
  return send('/api/months/' + ym, { days })
}

export function saveDebts(debts) {
  return send('/api/debts', { debts })
}

export function saveBudget(budget) {
  return send('/api/budget', { budget })
}
