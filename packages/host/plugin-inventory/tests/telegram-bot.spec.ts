import { describe, expect, it, vi } from 'vitest'
import { verifyTelegramBotToken } from '../src/telegram-bot.ts'

describe('Telegram BotFather credential verification', () => {
  it('rejects malformed secrets without contacting the network', async () => {
    const request = vi.fn()
    await expect(verifyTelegramBotToken('not-a-real-token', request as unknown as typeof fetch))
      .rejects.toThrow('telegram-invalid-token')
    expect(request).not.toHaveBeenCalled()
  })

  it('validates with Telegram getMe over the pinned HTTPS endpoint', async () => {
    const token = '123456789:ABCdef_0123456789ABCdef_0123456789'
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { is_bot: true, username: 'KiraPhoenix_bot' } }),
    }))
    await expect(verifyTelegramBotToken(token, request as unknown as typeof fetch))
      .resolves.toEqual({ username: 'KiraPhoenix_bot' })
    expect(request).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${token}/getMe`,
      expect.objectContaining({ method: 'POST', redirect: 'error', cache: 'no-store' }),
    )
  })

  it('does not mistake an invalid Telegram response for a connected bot', async () => {
    const token = '123456789:ABCdef_0123456789ABCdef_0123456789'
    const request = vi.fn(async () => ({ ok: false, status: 401 }))
    await expect(verifyTelegramBotToken(token, request as unknown as typeof fetch))
      .rejects.toThrow('telegram-invalid-token')
  })

  it('rejects non-bot identities, even when the HTTP request succeeds', async () => {
    const token = '123456789:ABCdef_0123456789ABCdef_0123456789'
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { is_bot: false, username: 'notABot' } }),
    }))
    await expect(verifyTelegramBotToken(token, request as unknown as typeof fetch))
      .rejects.toThrow('telegram-invalid-token')
  })
})
