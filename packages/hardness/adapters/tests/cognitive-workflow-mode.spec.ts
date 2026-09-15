import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { createCognitiveWorkflowTool } from '../src/cognitive-workflow-tool.ts'

const callId = CallId('hardness-workflow-mode')

function execution(): ToolRunContext {
  return {
    callId,
    rootCallId: callId,
    name: 'hardness_workflow',
    arguments: {},
    token: Symbol('tool-token') as never,
    signal: new AbortController().signal,
    deferContext: () => {},
    concludeTurn: () => {},
  }
}

const profile = {
  kind: 'debug' as const,
  complexity: 'medium' as const,
  risk: 'medium' as const,
  novelty: 'low' as const,
  requiresCodeChange: true,
  requiresExternalEvidence: false,
  hasIndependentSubtasks: false,
  persistent: false,
  previousFailure: false,
  repeatedPattern: false,
  userVisibleArtifact: true,
  futureObligation: false,
}

describe('hardness_workflow execution mode', () => {
  it('projects fast mode with the selected flows and quality gates', async () => {
    const tool = createCognitiveWorkflowTool()

    await expect(tool.execute({ profile }, execution())).resolves.toMatchObject({
      executionMode: 'fast',
      selected: expect.arrayContaining(['systematic-debugging', 'verification-gate', 'outcome-evaluation']),
      qualityGates: expect.arrayContaining(['objective-locked', 'fresh-verification', 'outcome-compared']),
    })
  })
})
