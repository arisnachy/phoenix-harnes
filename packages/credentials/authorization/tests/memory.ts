import { CredentialProvider } from '@phoenix-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@phoenix-ai/dsh-credentials'

/**
 * In-memory credentials provider for the authorization suite. Both durable records
 * and reference values survive writes for the lifetime of each test provider.
 */
// TODO: near-duplicate of the record half of
// packages/credentials/credentials/tests/memory.ts; fold both into a shared
// test-support double when a third suite needs one.
export class MemoryCredentials extends CredentialProvider {
  private readonly records = new Map<CredentialKey, CredentialRecord>()

  private readonly values = new Map<CredentialRef, string>()

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values.get(ref)
    return Promise.resolve(value === undefined ? undefined : { value, source: 'memory' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: this.values.has(ref), writable: true })
  }

  override set(ref: CredentialRef, value: string): Promise<void> {
    this.values.set(ref, value)
    this.ctx.emit('credentials/reference-updated', ref)
    return Promise.resolve()
  }

  override unset(ref: CredentialRef): Promise<void> {
    this.values.delete(ref)
    this.ctx.emit('credentials/reference-updated', ref)
    return Promise.resolve()
  }

  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(this.records.get(key))
  }

  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const stored = this.records.get(key)
    return Promise.resolve(stored === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: stored.kind, writable: true })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([key, record]) => ({ key, kind: record.kind })))
  }

  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const current = this.records.get(key)
    const next = await mutate(current)
    if (next === undefined) return current
    this.records.set(key, next)
    this.ctx.emit('credentials/record-updated', key)
    return next
  }

  override deleteRecord(key: CredentialKey): Promise<void> {
    if (this.records.delete(key)) this.ctx.emit('credentials/record-updated', key)
    return Promise.resolve()
  }
}
