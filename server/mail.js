import fs from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readJson(file) {
  try {
    if (!file || !fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function mailConfigPaths(dbFile = '') {
  const fromEnv = process.env.PAYDAY_MAIL_CONFIG || ''
  const nearDb = dbFile ? path.join(path.dirname(dbFile), 'mail.json') : ''
  const local = path.join(__dirname, '..', 'data', 'mail.json')
  return [fromEnv, nearDb, local].filter(Boolean)
}

export function loadMailConfig(dbFile = '') {
  let fileCfg = null
  for (const file of mailConfigPaths(dbFile)) {
    fileCfg = readJson(file)
    if (fileCfg) break
  }
  const ownerEmail = String(
    process.env.PAYDAY_OWNER_EMAIL
      || fileCfg?.ownerEmail
      || fileCfg?.owner_email
      || '',
  ).trim().toLowerCase()
  const gmailUser = String(
    process.env.GMAIL_USER
      || fileCfg?.gmailUser
      || fileCfg?.gmail_user
      || ownerEmail
      || '',
  ).trim()
  const gmailAppPassword = String(
    process.env.GMAIL_APP_PASSWORD
      || fileCfg?.gmailAppPassword
      || fileCfg?.gmail_app_password
      || '',
  ).replace(/\s+/g, '')
  return { ownerEmail, gmailUser, gmailAppPassword }
}

export function otpMailConfigured(dbFile = '') {
  const cfg = loadMailConfig(dbFile)
  return !!(cfg.ownerEmail && cfg.gmailUser && cfg.gmailAppPassword)
}

export function maskEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  const at = value.indexOf('@')
  if (at < 1) return ''
  const user = value.slice(0, at)
  const domain = value.slice(at + 1)
  const visible = user.slice(0, Math.min(2, user.length))
  return `${visible}${'*'.repeat(Math.max(1, user.length - visible.length))}@${domain}`
}

function encodeCmd(line) {
  return Buffer.from(`${line}\r\n`, 'utf8')
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const onData = chunk => {
      buf += chunk.toString('utf8')
      const lines = buf.split(/\r?\n/).filter(Boolean)
      if (!lines.length) return
      const last = lines[lines.length - 1]
      if (/^\d{3}-/.test(last)) return
      if (!/^\d{3} /.test(last)) return
      socket.off('data', onData)
      socket.off('error', onError)
      resolve({ code: Number(last.slice(0, 3)), text: buf })
    }
    const onError = err => {
      socket.off('data', onData)
      reject(err)
    }
    socket.on('data', onData)
    socket.on('error', onError)
  })
}

async function expect(socket, okCodes) {
  const res = await readResponse(socket)
  if (!okCodes.includes(res.code)) {
    throw new Error(`SMTP ${res.code}: ${res.text.trim().slice(0, 180)}`)
  }
  return res
}

async function command(socket, line, okCodes) {
  socket.write(encodeCmd(line))
  return expect(socket, okCodes)
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host }, () => resolve(secure))
    secure.on('error', reject)
  })
}

export async function sendMail({ from, to, subject, text, user, pass }) {
  const host = process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com'
  const port = Number(process.env.GMAIL_SMTP_PORT || 587)
  const socket = await new Promise((resolve, reject) => {
    const s = net.connect({ host, port }, () => resolve(s))
    s.setEncoding('utf8')
    s.on('error', reject)
  })
  try {
    await expect(socket, [220])
    await command(socket, `EHLO payday-calendar`, [250])
    await command(socket, 'STARTTLS', [220])
    const secure = await upgradeToTls(socket, host)
    secure.setEncoding('utf8')
    await command(secure, `EHLO payday-calendar`, [250])
    await command(secure, 'AUTH LOGIN', [334])
    await command(secure, Buffer.from(user).toString('base64'), [334])
    await command(secure, Buffer.from(pass).toString('base64'), [235])
    await command(secure, `MAIL FROM:<${from}>`, [250])
    await command(secure, `RCPT TO:<${to}>`, [250, 251])
    await command(secure, 'DATA', [354])
    const payload = [
      `From: Payday Calendar <${from}>`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
      '.',
    ].join('\r\n')
    secure.write(encodeCmd(payload))
    await expect(secure, [250])
    await command(secure, 'QUIT', [221]).catch(() => {})
    secure.end()
  } catch (err) {
    try { socket.destroy() } catch { /* ignore */ }
    throw err
  }
}

export async function sendLoginOtp(dbFile, code) {
  const cfg = loadMailConfig(dbFile)
  if (!cfg.ownerEmail || !cfg.gmailUser || !cfg.gmailAppPassword) {
    throw new Error('Gmail login is not configured')
  }
  const text = [
    'Your Payday Calendar login code is:',
    '',
    code,
    '',
    'This code expires in 10 minutes.',
    'If you did not request it, ignore this email.',
  ].join('\n')
  await sendMail({
    from: cfg.gmailUser,
    to: cfg.ownerEmail,
    subject: `${code} is your Payday Calendar code`,
    text,
    user: cfg.gmailUser,
    pass: cfg.gmailAppPassword,
  })
  return { ownerEmail: cfg.ownerEmail }
}
