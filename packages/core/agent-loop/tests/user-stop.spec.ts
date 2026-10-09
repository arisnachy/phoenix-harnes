import { createUserMessage } from '@phoenix-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { isExplicitUserStop } from '../src/user-stop.ts'

const user = (text: string) => createUserMessage({
  content: [{ type: 'text', text }], source: { kind: 'user' },
})

describe('explicit human stop intent', () => {
  it.each([
    'Kira, para la prueba', 'kira para la prueba', 'Kira: detente por favor',
    'por favor, Kira, para la prueba', 'Ya detenlo', 'detén la ejecución',
    'Kira cancela la tarea', 'no sigas', 'Kira deja de trabajar',
    'stop', 'please stop', 'stop this test', 'cancel it',
    'basta', 'Párate ahora',
  ])('matches %s as a control command', text => {
    expect(isExplicitUserStop(user(text))).toBe(true)
  })

  it.each([
    'Kira, para la prueba abre el formulario',
    'Para la prueba necesito esos datos',
    'Kira, prepara la prueba',
    'Parar la prueba y después buscar otra',
    'Quiero saber cómo detener una ejecución',
    'No sigas la carretera',
    'La prueba se detuvo antes',
    'Stop the task and start another one',
    'Kira, por favor llena el formulario para la prueba',
  ])('does not swallow ordinary instructions: %s', text => {
    expect(isExplicitUserStop(user(text))).toBe(false)
  })

  it('does not treat plugin text as a user control command', () => {
    expect(isExplicitUserStop(createUserMessage({
      content: [{ type: 'text', text: 'Kira, para la prueba' }],
      source: { kind: 'plugin', plugin: 'test' },
    }))).toBe(false)
  })
})
