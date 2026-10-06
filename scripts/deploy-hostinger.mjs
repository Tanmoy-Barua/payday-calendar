import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const token = process.env.HOSTINGER_API_TOKEN
const username = 'u878473359'
const domain = 'paycheck.tanmoybarua.com'
const archiveName = 'paycheck-site.zip'
const api = 'https://developers.hostinger.com'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (!token) {
  console.error('HOSTINGER_API_TOKEN is not set')
  process.exit(1)
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function packSite() {
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) run('npm', ['run', 'build'], root)
  const publish = fs.mkdtempSync(path.join(os.tmpdir(), 'paycheck-'))
  fs.cpSync(path.join(root, 'dist'), publish, { recursive: true })
  fs.copyFileSync(path.join(root, 'hostinger', 'api.php'), path.join(publish, 'api.php'))
  fs.copyFileSync(path.join(root, 'hostinger', '.htaccess'), path.join(publish, '.htaccess'))
  fs.mkdirSync(path.join(publish, 'data'), { recursive: true })
  fs.copyFileSync(path.join(root, 'hostinger', 'data', '.htaccess'), path.join(publish, 'data', '.htaccess'))
  const zip = path.join(os.tmpdir(), archiveName)
  run('python3', ['-c', `
import os, zipfile, sys
root, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
    for dirpath, _, names in os.walk(root):
        for name in names:
            full = os.path.join(dirpath, name)
            z.write(full, os.path.relpath(full, root))
print(os.path.getsize(dest))
`, publish, zip])
  return zip
}

async function hostinger(method, urlPath, body) {
  const res = await fetch(api + urlPath, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} -> ${res.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }
  return data
}

async function upload(file) {
  const creds = await hostinger('POST', '/api/hosting/v1/files/upload-urls', { username, domain })
  const { url, auth_key, rest_auth_key } = creds
  const size = fs.statSync(file).size
  const target = `${url.replace(/\/$/, '')}/${archiveName}?override=true`
  const headers = {
    'X-Auth': auth_key,
    'X-Auth-Rest': rest_auth_key,
    'Tus-Resumable': '1.0.0',
  }
  const created = await fetch(target, {
    method: 'POST',
    headers: { ...headers, 'Upload-Length': String(size), 'Upload-Offset': '0' },
  })
  if (!created.ok && created.status !== 201) {
    throw new Error(`Upload create failed: ${created.status} ${await created.text()}`)
  }
  const patched = await fetch(target, {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': '0',
    },
    body: fs.readFileSync(file),
    duplex: 'half',
  })
  if (!patched.ok && patched.status !== 204) {
    throw new Error(`Upload patch failed: ${patched.status} ${await patched.text()}`)
  }
  console.log(`Uploaded ${archiveName} (${size} bytes)`)
}

async function uploadFile(name, body) {
  const creds = await hostinger('POST', '/api/hosting/v1/files/upload-urls', { username, domain })
  const target = `${creds.url.replace(/\/$/, '')}/${name}?override=true`
  const headers = {
    'X-Auth': creds.auth_key,
    'X-Auth-Rest': creds.rest_auth_key,
    'Tus-Resumable': '1.0.0',
  }
  const created = await fetch(target, {
    method: 'POST',
    headers: { ...headers, 'Upload-Length': String(body.length), 'Upload-Offset': '0' },
  })
  if (!created.ok && created.status !== 201) {
    throw new Error(`Upload create failed for ${name}: ${created.status} ${await created.text()}`)
  }
  const patched = await fetch(target, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
    body,
    duplex: 'half',
  })
  if (!patched.ok && patched.status !== 204) {
    throw new Error(`Upload patch failed for ${name}: ${patched.status} ${await patched.text()}`)
  }
}

async function main() {
  const zip = packSite()
  await upload(zip)
  const deployed = await hostinger('POST', `/api/hosting/v1/accounts/${username}/websites/${domain}/deploy`, {
    archive_path: archiveName,
  })
  console.log(JSON.stringify(deployed))
  const listing = await hostinger('GET', `/api/hosting/v1/accounts/${username}/domains/${domain}/files?directory=.&max_depth=2&max_items=50`)
  const names = (listing.items || []).map(item => item.name)
  console.log('Published files:', names.join(', ') || '(none)')
  if (!names.includes('api.php')) {
    await uploadFile('api.php', fs.readFileSync(path.join(root, 'hostinger', 'api.php')))
    await uploadFile('.htaccess', fs.readFileSync(path.join(root, 'hostinger', '.htaccess')))
    console.log('Uploaded api.php directly')
  }
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
