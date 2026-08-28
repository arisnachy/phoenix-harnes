/** Model-facing HARDNESS protocol registration for the canonical prompt service. */

import { renderHardnessProtocol } from '@deepseek-ai/dsh-hardness'

/** Minimal structural prompt registrar required by the protocol adapter. */
export interface HardnessPromptRegistrar {
  section: (section: { readonly name: string; readonly order: number; readonly text: string }) => () => void
}

/** Install the stable HARDNESS lifecycle guide into the model system prompt. */
export function installHardnessProtocol(
  systemPrompt: HardnessPromptRegistrar,
  locale: 'en' | 'es' = 'en',
): () => void {
  return systemPrompt.section({
    name: 'hardness:operating-protocol',
    order: 150,
    text: renderHardnessProtocol(locale),
  })
}
