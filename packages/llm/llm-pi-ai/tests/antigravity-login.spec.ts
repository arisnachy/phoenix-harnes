import { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { googleCliConsentUrl, relayGoogleCliLogin } from '../src/antigravity-login.ts'

const url = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&state=fake'

describe('Antigravity OAuth code relay', () => {
  it('accepts only the official consent origin and callback', () => {
    expect(googleCliConsentUrl(url)).toBe(url)
    expect(googleCliConsentUrl(url.replace('accounts.google.com', 'accounts.google.com.evil.test'))).toBeUndefined()
    expect(googleCliConsentUrl(url.replace('antigravity.google', 'evil.test'))).toBeUndefined()
  })
  it('sends the pasted code to the same live CLI process and waits for its exit', async () => {
    const program = 'process.stdout.write(' + JSON.stringify(url + '\n') + '); process.stdin.once("data", b => process.exit(b.toString().trim() === "fake-code" ? 0 : 1));'
    const child = spawn(process.execPath, ['-e', program], { stdio: ['pipe', 'pipe', 'pipe'] })
    const notify = vi.fn()
    const prompt = vi.fn(async () => 'fake-code')
    await relayGoogleCliLogin(child, { signal: new AbortController().signal, notify, prompt })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ url }))
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ kind: 'secret' }))
  })
  it('does not treat a failed CLI exchange as authentication', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(1)'], { stdio: ['pipe', 'pipe', 'pipe'] })
    await expect(relayGoogleCliLogin(child, { signal: new AbortController().signal, notify: vi.fn(), prompt: vi.fn(async () => '') })).rejects.toThrow(/no completó/u)
  })
})
