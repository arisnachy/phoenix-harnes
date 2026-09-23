/** Conservative user-authored inference for Phoenix's conversational presentation. */

import { DEFAULT_ASSISTANT_NAME } from './schema.ts'
import type { AssistantGender } from './types.ts'

/** One presentation inference with enough provenance to decide whether it may revise an older inference. */
export interface AssistantGenderInference {
  gender: AssistantGender
  strength: 'addressed' | 'explicit'
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Infer presentation only from explicit preference statements or language clearly
 * addressed to Phoenix. Generic gender mentions about third parties never count.
 * @param assistantName - The assistant name value.
 * @param text - The text value.
 * @returns The resulting value.
 */
export function inferAssistantGenderFromUserMessage(
  text: string,
  assistantName: string = DEFAULT_ASSISTANT_NAME,
): AssistantGenderInference | undefined {
  const value = normalize(text)
  if (value === '') return undefined

  const explicit: ReadonlyArray<readonly [AssistantGender, RegExp]> = [
    ['feminine', /\b(?:quiero|prefiero|necesito)\b.{0,32}\b(?:que\s+)?(?:seas|te\s+presentes|hables|actues)\b.{0,36}\b(?:femenina|mujer|como\s+mujer|ella)\b/u],
    ['feminine', /\b(?:eres|te\s+veo|te\s+considero|te\s+trato)\b.{0,28}\b(?:femenina|mujer|una\s+mujer)\b/u],
    ['feminine', /\b(?:i\s+want|i\s+prefer|please)\b.{0,36}\b(?:you\s+to\s+be|speak|act|present)\b.{0,28}\b(?:female|feminine|a\s+woman|she\/her)\b/u],
    ['feminine', /\b(?:you\s+are|i\s+see\s+you\s+as|i\s+consider\s+you)\b.{0,24}\b(?:female|feminine|a\s+woman)\b/u],
    ['masculine', /\b(?:quiero|prefiero|necesito)\b.{0,32}\b(?:que\s+)?(?:seas|te\s+presentes|hables|actues)\b.{0,36}\b(?:masculino|hombre|como\s+hombre)\b/u],
    ['masculine', /\b(?:eres|te\s+veo|te\s+considero|te\s+trato)\b.{0,28}\b(?:masculino|hombre|un\s+hombre)\b/u],
    ['masculine', /\b(?:i\s+want|i\s+prefer|please)\b.{0,36}\b(?:you\s+to\s+be|speak|act|present)\b.{0,28}\b(?:male|masculine|a\s+man|he\/him)\b/u],
    ['masculine', /\b(?:you\s+are|i\s+see\s+you\s+as|i\s+consider\s+you)\b.{0,24}\b(?:male|masculine|a\s+man)\b/u],
    ['neutral', /\b(?:quiero|prefiero|necesito)\b.{0,36}\b(?:que\s+)?(?:seas|te\s+presentes|hables|actues)\b.{0,32}\b(?:neutral|sin\s+genero|no\s+binari[oa])\b/u],
    ['neutral', /\b(?:i\s+want|i\s+prefer|please)\b.{0,36}\b(?:you\s+to\s+be|speak|act|present)\b.{0,28}\b(?:neutral|gender[- ]neutral|nonbinary|non-binary)\b/u],
  ]
  for (const [gender, pattern] of explicit) {
    if (pattern.test(value)) return { gender, strength: 'explicit' }
  }

  const names = [...new Set([assistantName, DEFAULT_ASSISTANT_NAME, 'Phoenix', 'Fenix'].map(normalize).filter(Boolean))]
  const namePattern = names.map(escapeRegExp).join('|')
  if (namePattern === '') return undefined

  const feminine = '(?:amiga|querida|companera|chica|muchacha|senorita|femenina|buena)'
  const masculine = '(?:amigo|querido|companero|chico|muchacho|senor|masculino|bueno)'
  const namedFeminine = new RegExp(`\\b(?:${namePattern})\\b[\\s,;:!?.-]{0,8}.{0,48}\\b${feminine}\\b|\\b${feminine}\\b.{0,36}\\b(?:${namePattern})\\b`, 'u')
  const namedMasculine = new RegExp(`\\b(?:${namePattern})\\b[\\s,;:!?.-]{0,8}.{0,48}\\b${masculine}\\b|\\b${masculine}\\b.{0,36}\\b(?:${namePattern})\\b`, 'u')
  const directFeminine = /\b(?:gracias|hola|oye|dale|vamos)[, ]{0,4}(?:mi\s+)?(?:amiga|querida|companera)\b/u
  const directMasculine = /\b(?:gracias|hola|oye|dale|vamos)[, ]{0,4}(?:mi\s+)?(?:amigo|querido|companero)\b/u

  if (namedFeminine.test(value) || directFeminine.test(value)) return { gender: 'feminine', strength: 'addressed' }
  if (namedMasculine.test(value) || directMasculine.test(value)) return { gender: 'masculine', strength: 'addressed' }
  return undefined
}
