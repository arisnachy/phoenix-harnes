/** Read-only, privacy-filtered view of the durable Phoenix Business shelf. */
import { lstat, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import type { BusinessLibraryProduct, BusinessLibrarySnapshot } from './types.ts'

const LIMIT = 300
const MAX_BYTES = 8 * 1024 * 1024
const TYPES = new Set(['book','course','software','game','design','research','video','audio','other'])
const STAGES = new Set(['assets-missing','review-required','integrity-failed'])
const sha = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const bounded = (value: unknown, length = 180): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= length ? value : undefined

function project(value: unknown): BusinessLibraryProduct | undefined {
  const p = record(value)
  if (!p) return undefined
  const id = bounded(p.id, 100), title = bounded(p.title), type = bounded(p.type, 32)
  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id) || !title || !type || !TYPES.has(type)) return undefined
  const chapters = array(p.chapters), files = array(p.files), listings = array(p.listings)
  const blueprint = record(p.blueprint), build = record(p.build)
  const ordered = chapters.map(c => {const ch=record(c);return {number:ch?.number,sha256:ch?.sha256,words:ch?.words}}).sort((a,b)=>Number(a.number)-Number(b.number))
  const fingerprint = sha({ chapters: sha(ordered), blueprint:p.blueprint ?? null })
  const writtenWords = chapters.reduce<number>((sum, c) => {
    const count = record(c)?.words
    return sum + (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0)
  }, 0)
  const stage = record(listings.at(-1))?.stage
  return {
    id, title, type, updatedAt: bounded(p.updatedAt, 40) ?? '',
    fileCount:files.length, chapterCount:chapters.length, listingCount:listings.length,
    plannedChapters:array(blueprint?.chapters).length, writtenWords,
    targetWords:typeof blueprint?.targetWords === 'number' && Number.isSafeInteger(blueprint.targetWords) && blueprint.targetWords >= 0 ? blueprint.targetWords : null,
    buildStatus:!build || typeof build.fingerprint !== 'string' ? 'not-built' : build.fingerprint === fingerprint ? 'current' : 'stale',
    listingStage:typeof stage === 'string' && STAGES.has(stage) ? stage : 'not-prepared',
  }
}

/** Never return local paths, story contents, order identifiers, buyer information or raw ledger fields. */
export async function readBusinessLibrarySnapshot(root = process.env.PHOENIX_BUSINESS_HOME || dshHomePath('business-library')): Promise<BusinessLibrarySnapshot> {
  const path=join(root,'library.json')
  let file
  try { file=await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {totalCount:0,truncated:false,products:[]}
    throw error
  }
  if (!file.isFile() || file.size > MAX_BYTES) throw new Error('Índice comercial inválido o demasiado grande.')
  const raw=await readFile(path,'utf8')
  if (Buffer.byteLength(raw,'utf8') > MAX_BYTES) throw new Error('Índice comercial demasiado grande.')
  const db: unknown=JSON.parse(raw)
  const document=record(db)
  if (document?.version !== 1 || !Array.isArray(document.products)) throw new Error('Versión de biblioteca comercial no compatible.')
  if (document.products.length > 50000) throw new Error('Demasiados productos en el índice comercial.')
  const products=document.products.map(project).filter((p):p is BusinessLibraryProduct=>p!==undefined)
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id))
  return {totalCount:products.length,truncated:products.length>LIMIT,products:products.slice(0,LIMIT)}
}