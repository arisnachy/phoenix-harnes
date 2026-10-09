import { describe, it, expect } from 'vitest'
import { avatarExpressionOf } from '../src/client/LivingAvatarFace.tsx'

describe('living avatar expression routing', () => {
  it('responds to real workflow phases without inventing action results', () => {
    expect(avatarExpressionOf(true,false,'preparing')).toBe('focused')
    expect(avatarExpressionOf(true,false,'running-tools')).toBe('confident')
    expect(avatarExpressionOf(true,false,'verifying')).toBe('focused')
    expect(avatarExpressionOf(true,true,'running-tools')).toBe('concerned')
    expect(avatarExpressionOf(false,false,'idle')).toBe('warm')
  })
  it('honors explicit message-purpose reactions and preserves idle fallback', () => {
    expect(avatarExpressionOf(false,false,'idle','happy')).toBe('happy')
    expect(avatarExpressionOf(false,false,'unknown')).toBe('neutral')
  })
})
