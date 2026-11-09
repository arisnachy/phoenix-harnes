import {describe,it,expect} from 'vitest'
import {
  kiraAudioMouthLevel,kiraExpressionFromSpeech,kiraSpeechMouthEnvelope,
} from '../src/client/skeleton/kira-voice-movement.ts'

describe('Kira living voice avatar expression and lip motion',()=>{
  it('responds to the content of the words, not a random animation preset',()=>{
    expect(kiraExpressionFromSpeech('Ya encontré la solución, funciona perfecto.')).toBe('warm')
    expect(kiraExpressionFromSpeech('Precaución, este caso presenta riesgo.')).toBe('concerned')
    expect(kiraExpressionFromSpeech('Estoy comparando los resultados.')).toBe('focused')
    expect(kiraExpressionFromSpeech('Hola, te escucho.')).toBe('neutral')
    expect(kiraExpressionFromSpeech('Excelente, pero hay riesgo.')).toBe('concerned')
  })
  it('drives fallback mouth shape from spoken syllables with punctuation pauses',()=>{
    expect(kiraSpeechMouthEnvelope('',420)).toBe(0)
    expect(kiraSpeechMouthEnvelope('a',-1)).toBe(0)
    expect(kiraSpeechMouthEnvelope('a',83)).toBeGreaterThan(0)
    expect(kiraSpeechMouthEnvelope('a ',98)).toBeLessThan(.05)
    expect(kiraSpeechMouthEnvelope('¿',0)).toBeLessThan(.05)
  })
  it('bounds native audio energy and does not animate ambient noise',()=>{
    expect(kiraAudioMouthLevel(0)).toBe(0)
    expect(kiraAudioMouthLevel(.005)).toBe(0)
    expect(kiraAudioMouthLevel(.12)).toBeGreaterThan(.8)
    expect(kiraAudioMouthLevel(10)).toBe(1)
    expect(kiraAudioMouthLevel(Number.NaN)).toBe(0)
  })
})
