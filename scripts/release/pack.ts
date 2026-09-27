/**
 * Pack one release family's whole publish set into a single directory, in
 * publish order, and record that order for the publish step.
 *
 * The pack step is the release boundary: it runs without credentials, produces
 * every tarball from one commit, and hands the publish step exactly those bytes
 * ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { releaseFamily, tarballName, type ReleaseFamily, type ReleaseMember } from './families.ts'
import { isEntry, run } from './process.ts'
import { PUBLISH_ORDER_FILE, tarballFiles } from './tarball.ts'

/** Where pack output lands when `--out` is omitted. */
const DEFAULT_OUTPUT = 'dist/npm'

/**
 * Run one pack operation with the consumer-facing manifest. DSH packages keep
 * `./src/*` only for source-workspace development; published tarballs omit
 * that export together with the source tree it would otherwise reference.
 * @param member - release member whose package.json is temporarily projected.
 * @param operation - synchronous pnpm-pack operation.
 */
function withPublicationManifest(member: ReleaseMember, operation: () => void): void {
  const manifestPath = join(member.directory, 'package.json')
  const original = readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(original) as {
    name?: string
    exports?: Record<string, unknown>
  }
  if (!manifest.name?.startsWith('@phoenix-ai/dsh-')
    || manifest.exports === undefined
    || !Object.hasOwn(manifest.exports, './src/*')) {
    operation()
    return
  }

  delete manifest.exports['./src/*']
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  try {
    operation()
  } finally {
    writeFileSync(manifestPath, original)
  }
}

/**
 * Pack one member and check what its tarball carries.
 * @param family - the release family being packed.
 * @param member - the member to pack.
 * @param destination - absolute output directory.
 * @returns The tarball filename.
 */
function packMember(family: ReleaseFamily, member: ReleaseMember, destination: string): string {
  withPublicationManifest(member, () => {
    run('pnpm', ['--dir', member.directory, 'pack', '--pack-destination', destination])
  })

  const filename = tarballName(member)
  const tarball = join(destination, filename)
  if (!existsSync(tarball)) throw new Error(`${member.name} produced no tarball at ${tarball}`)
  family.validatePayload(member, tarballFiles(tarball))
  return filename
}

/** Pack the family named by `--family` into `--out`. */
function main(): void {
  const { values } = parseArgs({
    options: { family: { type: 'string' }, out: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.family === undefined) throw new Error('usage: pack.ts --family <dsh|vendor> [--out dist/npm]')

  const family = releaseFamily(values.family)
  const root = process.cwd()
  const destination = resolve(root, values.out ?? DEFAULT_OUTPUT)
  const members = family.publishOrder(family.members(root)).order
  family.verifyBuildArtifacts(root)
  family.verifyVersions(members)

  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })

  const order: string[] = []
  for (const member of members) order.push(packMember(family, member, destination))
  writeFileSync(join(destination, PUBLISH_ORDER_FILE), `${order.join('\n')}\n`)

  console.log(`release pack: family ${family.id}, ${String(order.length)} tarball(s) in ${values.out ?? DEFAULT_OUTPUT}`)
}

if (isEntry(import.meta.url)) main()
