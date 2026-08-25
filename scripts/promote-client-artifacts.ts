import { copyFileSync, existsSync, globSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CLIENT_BUILD_RECORD_PATH,
  readClientBuildRecord,
} from './client-build-environment.ts'

const CLIENT_ARTIFACT_PATTERNS = [
  'apps/web/dist/**/*',
  'packages/*/*/lib/client.js',
  'packages/*/*/lib/client.js.map',
] as const

function artifactPaths(root: string): string[] {
  return globSync([...CLIENT_ARTIFACT_PATTERNS], { cwd: root })
    .map(path => path.replaceAll('\\', '/'))
    .sort()
}

function main(): void {
  const { values } = parseArgs({
    options: { from: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.from === undefined || values.from.trim() === '') {
    throw new Error('promote-client-artifacts: --from <prepared-stage> is required')
  }

  const root = resolve(import.meta.dirname, '..')
  const source = resolve(values.from)
  if (source === root) throw new Error('promote-client-artifacts: source and destination must differ')

  const sourceRecord = readClientBuildRecord(source)
  const sourceArtifacts = artifactPaths(source)
  if (sourceArtifacts.length !== sourceRecord.artifacts.fileCount) {
    throw new Error(
      `promote-client-artifacts: source artifact count ${String(sourceArtifacts.length)} differs from verified record ${String(sourceRecord.artifacts.fileCount)}`,
    )
  }

  rmSync(resolve(root, 'apps/web/dist'), { recursive: true, force: true })
  for (const stale of artifactPaths(root)) rmSync(resolve(root, stale), { force: true })

  for (const relative of sourceArtifacts) {
    const destination = resolve(root, relative)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(resolve(source, relative), destination)
  }

  const sourceRecordPath = resolve(source, CLIENT_BUILD_RECORD_PATH)
  if (!existsSync(sourceRecordPath)) throw new Error('promote-client-artifacts: verified source build record disappeared')
  const destinationRecordPath = resolve(root, CLIENT_BUILD_RECORD_PATH)
  mkdirSync(dirname(destinationRecordPath), { recursive: true })
  copyFileSync(sourceRecordPath, destinationRecordPath)

  const promoted = readClientBuildRecord(root, sourceRecord.environment)
  if (
    promoted.artifacts.fileCount !== sourceRecord.artifacts.fileCount
    || promoted.artifacts.sha256 !== sourceRecord.artifacts.sha256
  ) {
    throw new Error('promote-client-artifacts: destination digest differs after promotion')
  }

  console.log(
    `PHOENIX updater: promoted ${String(promoted.artifacts.fileCount)} prepared client artifact(s), sha256 ${promoted.artifacts.sha256.slice(0, 12)}...`,
  )
}

if (import.meta.main) main()
