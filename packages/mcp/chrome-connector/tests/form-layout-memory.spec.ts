import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formLayoutKey, prepareLearnedFormWorkflow, recallVerifiedFormLayout, sanitizeFormLayout, saveVerifiedFormLayout } from '../src/form-layout-memory.ts'

const folders: string[] = []
afterEach(async () => { await Promise.all(folders.splice(0).map(x => rm(x, { recursive: true, force: true }))) })
const inputs = [[
  { operation: 'fill' as const, selector: '#candidate', value: 'PRIVATE APPLICANT NAME' },
  { operation: 'select' as const, name: 'department', value: 'confidential answer' },
]]
const checks = [
  { operation: 'verify' as const, selector: '#candidate', value: 'PRIVATE APPLICANT NAME' },
  { operation: 'verify' as const, name: 'department', value: 'confidential answer' },
]
describe('verified browser form layout learning', () => {
  it('stores only safe locator structure, never submitted form values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'phoenix-layout-'))
    folders.push(dir)
    const url = 'https://example.org/recruit?token=PRIVATE-TOKEN'
    expect(await saveVerifiedFormLayout(url, inputs, checks, dir)).toBe(true)
    const recovered = await recallVerifiedFormLayout(url, dir)
    expect(recovered?.steps).toEqual([
      { operation: 'fill', selector: '#candidate' },
      { operation: 'select', name: 'department' },
    ])
    expect(recovered?.verifiedChecks).toEqual([
      { operation: 'verify', selector: '#candidate' },
      { operation: 'verify', name: 'department' },
    ])
    const persisted = await readFile(join(dir, formLayoutKey(url) + '.json'), 'utf8')
    expect(persisted).not.toContain('PRIVATE')
    expect(persisted).not.toContain('confidential')
    expect(persisted).not.toContain('example.org')
    expect(await recallVerifiedFormLayout('https://example.org/other', dir)).toBeUndefined()
    expect(await recallVerifiedFormLayout('https://other.example.org/recruit', dir)).toBeUndefined()
    expect(await recallVerifiedFormLayout(url, dir, Date.now() + 61 * 24 * 60 * 60 * 1000))
      .toBeUndefined()
  })
  it('never learns sensitive fields, leaked selectors or user text', () => {
    expect(sanitizeFormLayout([[
      { operation: 'fill', name: 'password', value: 'foo' },
      { operation: 'fill', selector: '#myemail', value: 'alice@example.org' },
      { operation: 'fill', label: 'Sensitive user opinion', value: 'my answer' },
    ]], checks)?.steps).toEqual([])
    expect(sanitizeFormLayout([], [{ operation: 'verify', name: 'password', value: 'secret' }]))
      .toBeUndefined()
    expect(sanitizeFormLayout([], [{ operation: 'verify', selector: '#abc', value: 'secret' }])?.verifiedChecks)
      .toEqual([{ operation: 'verify', selector: '#abc' }])
  })
  it('fills only newly supplied values with previously proven locators in one batch', () => {
    const layout = sanitizeFormLayout(inputs, checks)
    expect(layout).toBeDefined()
    const prepared = prepareLearnedFormWorkflow(layout!, [
      { field: '#candidate', value: 'A different user supplied value' },
      { field: 'department', value: 'Engineering' },
    ])
    expect(prepared).toEqual({
      phases: [[
        { operation: 'fill', selector: '#candidate', value: 'A different user supplied value' },
        { operation: 'select', name: 'department', value: 'Engineering' },
      ]],
      checks: [
        { operation: 'verify', selector: '#candidate', value: 'A different user supplied value' },
        { operation: 'verify', name: 'department', value: 'Engineering' },
      ],
    })
    expect(prepareLearnedFormWorkflow(layout!, [{ field: 'unknown', value: 'private' }]))
      .toBeUndefined()
    expect(prepareLearnedFormWorkflow(layout!, [
      { field: '#candidate', value: 'a' }, { field: '#candidate', value: 'b' },
    ])).toBeUndefined()
    expect(prepareLearnedFormWorkflow(layout!, [{ field: '#candidate' }])).toBeUndefined()
  })
  it('rejects insecure external origins and canonicalizes query changes', () => {
    expect(() => formLayoutKey('http://not-secure.example/form')).toThrow()
    expect(formLayoutKey('https://example.org/form?t=1')).toBe(formLayoutKey('https://example.org/form?t=2'))
    expect(formLayoutKey('https://example.org/form')).not.toBe(formLayoutKey('https://example.org/form-next'))
    expect(formLayoutKey('http://localhost:3080/form')).toHaveLength(64)
  })
})
