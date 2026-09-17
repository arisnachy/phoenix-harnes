import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { LocalModelRuntimeFault } from './download.js'

/** Archive extraction contract used by the Phoenix Local runtime installer. */
export interface ArchiveExtractor {
  (archivePath: string, destinationDir: string): Promise<void>
}

/**
 * Extract a verified Phoenix Local runtime archive with the platform tar command.
 * @param archivePath - Managed path to the downloaded runtime archive.
 * @param destinationDir - Managed directory that will receive the extracted runtime.
 * @returns A promise that resolves after extraction completes successfully.
 */
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
