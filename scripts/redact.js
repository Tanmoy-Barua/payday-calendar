export function redact(value, secret) {
  const hidden = String(secret ?? '')
  let text = String(value ?? '')
  if (hidden) text = text.replaceAll(hidden, '[redacted]')
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/"(?:auth_key|rest_auth_key|access_token|token|api_key)"\s*:\s*"[^"]*"/gi, '"secret":"[redacted]"')
}
