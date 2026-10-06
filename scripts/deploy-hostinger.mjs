import fs from 'node:fs'
import path from 'node:path'

const token = process.env.HOSTINGER_API_TOKEN
const archive = process.argv[2]
const username = 'u878473359'
const domain = 'paycheck.tanmoybarua.com'
const archiveName = 'payday-calendar.zip'
const api = 'https://developers.hostinger.com'

if (!token) {
  console.error('HOSTINGER_API_TOKEN is not set')
  process.exit(1)
}
if (!archive || !fs.existsSync(archive)) {
  console.error('Pass the path to a zip of the app source')
  process.exit(1)
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
  const patched = await fetch(created.headers.get('location') || target, {
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

async function main() {
  await upload(path.resolve(archive))
  const envPath = `/api/hosting/v1/accounts/${username}/websites/${domain}/nodejs/builds/settings/env`
  try {
    await hostinger('PUT', envPath, {
      env_vars: [
        { key: 'NODE_ENV', value: 'production' },
        { key: 'PAYDAY_DB', value: '/home/u878473359/domains/tanmoybarua.com/payday-data/payday.sqlite' },
      ],
    })
    console.log('Saved runtime settings')
  } catch (err) {
    console.log('Runtime settings will be saved after the first build:', err.message)
  }

  const build = await hostinger('POST', `/api/hosting/v1/accounts/${username}/websites/${domain}/nodejs/builds`, {
    node_version: 22,
    app_type: 'express',
    root_directory: '.',
    output_directory: 'dist',
    build_script: 'build',
    entry_file: 'server/boot.js',
    package_manager: 'npm',
    source_type: 'archive',
    source_options: { archive_path: archiveName },
  })
  console.log(JSON.stringify(build))
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
