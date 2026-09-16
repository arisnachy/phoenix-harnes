import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { LocalModelRuntimeFault } from './download.js'

export interface ArchiveExtractor {
  (archivePath: string, destinationDir: string): Promise<void>
}

export async function extractArchiveWithTar(archivePath: string, destinationDir: string): Promise<void> {
  await mkdir(destinationDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xf', archivePath, '-C', destinationDir], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-8_192) })
    child.once('error', (error) => {
      reject(new LocalModelRuntimeFault('extract-failed', 'No se pudo iniciar el extractor del runtime local.', { cause: error }))
    })
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new LocalModelRuntimeFault('extract-failed', `No se pudo extraer llama.cpp${stderr === '' ? '.' : `: ${stderr.trim()}`}`))
    })
  })
}
