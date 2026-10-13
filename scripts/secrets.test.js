import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { redact } from './redact.js'

const root = path.resolve(import.meta.dirname, '..')

test('tracked files do not contain an API key', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)
  const assignment = /HOSTINGER_API_TOKEN\s*=\s*['"]?[A-Za-z0-9]/
  const bearer = /Bearer\s+[A-Za-z0-9_-]{20,}/
  const hits = []
  for (const file of files) {
    if (file === '.env' || file.startsWith('.env.')) hits.push(file)
    const buf = fs.readFileSync(path.join(root, file))
    if (buf.includes(0)) continue
    const text = buf.toString('utf8')
    if (assignment.test(text) || bearer.test(text)) hits.push(file)
  }
  assert.deepEqual(hits, [])
})

test('publish errors do not keep the API key', () => {
  const secret = 'example-key-not-a-real-token'
  const message = redact(`POST /deploy -> 401 Bearer ${secret} {"auth_key":"${secret}"}`, secret)
  assert.equal(message.includes(secret), false)
  assert.match(message, /Bearer \[redacted\]/)
  assert.match(message, /"secret":"\[redacted\]"/)
})
