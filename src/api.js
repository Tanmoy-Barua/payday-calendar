async function send(url, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('save failed')
  return res.json()
}

export function loadState() {
  return fetch('/api/state').then(res => {
    if (!res.ok) throw new Error('load failed')
    return res.json()
  })
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
