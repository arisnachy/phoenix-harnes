/** Tool selection shared by independent completion reviewers. */

import type { Agent } from '@phoenix-ai/dsh-agent'

/**
 * Keep preferred review tools that the parent composition actually exposes.
 * The child adds `structured_output` in its own scope after this selection.
 * @param parent - parent agent whose inherited tool view constrains the child.
 * @param preferred - ordered capability names accepted by the review stage.
 * @returns preferred names present in the assembled parent tool registry.
 */
export function availableReviewTools(parent: Agent, preferred: readonly string[]): string[] {
  const visible = new Set(parent.ctx.tools.schemas(parent).map(schema => schema.name))
  return preferred.filter(name => visible.has(name))
}
