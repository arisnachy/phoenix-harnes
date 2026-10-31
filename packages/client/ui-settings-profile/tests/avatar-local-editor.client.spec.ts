import { describe, expect, it } from 'vitest'
import { validatedLocalEditor } from '../src/client/avatar-store.ts'

describe('private avatar local image-edit endpoint', () => {
  it('accepts only loopback OpenAI-compatible image-edit endpoints', () => {
    expect(validatedLocalEditor('http://127.0.0.1:8188/v1')).toBe('http://127.0.0.1:8188/v1')
    expect(validatedLocalEditor('http://localhost:1234')).toBe('http://localhost:1234/v1')
    expect(validatedLocalEditor('http://localhost:1234/v1/images/edits')).toBe('http://localhost:1234/v1')
  })
  it('rejects remote photo exfiltration, credentials and nonlocal protocols', () => {
    expect(() => validatedLocalEditor('https://example.com/v1')).toThrow()
    expect(() => validatedLocalEditor('http://192.168.1.1:8080')).toThrow()
    expect(() => validatedLocalEditor('http://user:password@localhost:8080')).toThrow()
    expect(() => validatedLocalEditor('file:///etc/passwd')).toThrow()
    expect(() => validatedLocalEditor('http://127.0.0.1:8080/v1?token=secret')).toThrow()
    expect(() => validatedLocalEditor('http://127.0.0.1:8080/evil')).toThrow()
  })
})
