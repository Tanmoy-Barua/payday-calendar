import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const child = spawn(process.execPath, [
  '--experimental-sqlite',
  '--disable-warning=ExperimentalWarning',
  path.join(here, 'index.js'),
], { stdio: 'inherit', env: process.env })

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
