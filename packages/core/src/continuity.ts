import { createHash } from 'node:crypto';
import type { PhoenixMessage } from '@phoenix/contracts';
import { estimateTokens } from './tokenEconomy.js';

export type ContinuityAnchorKind =
  | 'goal'
  | 'constraint'
  | 'decision'
  | 'failure'
  | 'file'
  | 'test'
  | 'next-action'
  | 'tool-transaction'
  | 'other';

export interface ContinuityAnchor {
  id: string;
  kind: ContinuityAnchorKind;
  text: string;
  fingerprint: string;
  priority: number;
  sourceIndex: number;
  required: boolean;
}

export interface ContinuityCapsule {
  version: 1;
  createdAt: string;
  sourceMessageCount: number;
  sourceTokens: number;
  anchors: readonly ContinuityAnchor[];
  omittedAnchorIds: readonly string[];
  fingerprint: string;
  estimatedTokens: number;
  text: string;
}

export interface ContinuityCheck {
  score: number;
  requiredScore: number;
  missingRequiredFingerprints: readonly string[];
  missingFingerprints: readonly string[];
  passed: boolean;
}

export interface ContinuityOptions {
  budgetTokens?: number;
  minimumScore?: number;
  minimumRequiredScore?: number;
}

const CAPSULE_PREFIX = 'PHOENIX continuity capsule v1:';

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clip(value: string, maxChars: number): string {
  const normalized = normalize(value);
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 16) return normalized.slice(0, Math.max(0, maxChars));
  return `${normalized.slice(0, maxChars - 15)}…[anchor-clipped]`;
}

function messageTokens(message: PhoenixMessage): number {
  return estimateTokens(message.content) + estimateTokens(JSON.stringify(message.toolCalls ?? [])) + 4;
}

function anchor(
  kind: ContinuityAnchorKind,
  text: string,
  sourceIndex: number,
  priority: number,
  required: boolean,
  suffix = '',
): ContinuityAnchor | undefined {
  const normalized = normalize(text);
  if (!normalized) return undefined;
  const identity = `${kind}\u0000${sourceIndex}\u0000${suffix}\u0000${normalized}`;
  return {
    id: `${kind}:${fingerprint(identity).slice(0, 12)}`,
    kind,
    text: normalized,
    fingerprint: fingerprint(`${kind}\u0000${normalized}`),
    priority,
    sourceIndex,
    required,
  };
}

function sentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => normalize(item))
    .filter(Boolean);
}

function fileMatches(value: string): string[] {
  const matches = value.match(/(?:^|\s)(?:\.\.?\/)?[\w@.-]+(?:\/[\w@.-]+)+\.[A-Za-z0-9]{1,8}(?=$|[\s,;:)\]])/g) ?? [];
  return [...new Set(matches.map((item) => item.trim()))].slice(0, 6);
}

export function isContinuityCapsuleMessage(message: PhoenixMessage): boolean {
  return message.role === 'system' && message.content.startsWith(CAPSULE_PREFIX);
}

export function withoutContinuityCapsules(messages: readonly PhoenixMessage[]): PhoenixMessage[] {
  return messages.filter((message) => !isContinuityCapsuleMessage(message)).map((message) => ({ ...message }));
}

export function extractContinuityAnchors(messages: readonly PhoenixMessage[]): readonly ContinuityAnchor[] {
  const clean = withoutContinuityCapsules(messages);
  const anchors: ContinuityAnchor[] = [];
  const push = (item: ContinuityAnchor | undefined): void => { if (item) anchors.push(item); };

  const latestUserIndex = clean.findLastIndex((message) => message.role === 'user');
  if (latestUserIndex >= 0) {
    push(anchor('goal', clip(clean[latestUserIndex]!.content, 600), latestUserIndex, 100, true, 'latest-user'));
  }

  for (let index = 0; index < clean.length; index += 1) {
    const message = clean[index]!;
    const recentBonus = clean.length > 1 ? Math.round((index / (clean.length - 1)) * 12) : 12;
    const contentSentences = sentences(message.content);

    for (const sentence of contentSentences) {
      if (/\b(must|never|do not|don't|cannot|can't|required|requirement|only|forbid|prohibited)\b/i.test(sentence)) {
        push(anchor('constraint', clip(sentence, 360), index, 92 + recentBonus, true));
      }
      if (/\b(decided|decision|choose|chosen|selected|use instead|will use|agreed)\b/i.test(sentence)) {
        push(anchor('decision', clip(sentence, 320), index, 68 + recentBonus, false));
      }
      if (/\b(error|failed|failure|does not work|doesn't work|broken|regression)\b/i.test(sentence)) {
        push(anchor('failure', clip(sentence, 320), index, 72 + recentBonus, false));
      }
      if (/\b(test|tests|typecheck|build|ci|pass|passed|fail|failed|verify|verification)\b/i.test(sentence)) {
        push(anchor('test', clip(sentence, 320), index, 74 + recentBonus, false));
      }
      if (/\b(next|next action|todo|remaining|then we|after this|follow[- ]?up)\b/i.test(sentence)) {
        push(anchor('next-action', clip(sentence, 320), index, 78 + recentBonus, index >= clean.length - 4));
      }
    }

    for (const path of fileMatches(message.content)) {
      push(anchor('file', path, index, 60 + recentBonus, false));
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        const resultIndex = clean.findIndex((candidate, candidateIndex) =>
          candidateIndex > index && candidate.role === 'tool' && candidate.toolCallId === call.id);
        const result = resultIndex >= 0 ? clean[resultIndex] : undefined;
        const args = clip(JSON.stringify(call.arguments ?? {}), 220);
        const resultText = result ? clip(result.content, 260) : '<result pending>';
        push(anchor(
          'tool-transaction',
          `tool=${call.name} args=${args} result=${resultText}`,
          index,
          105 + recentBonus,
          index >= clean.length - 8 || resultIndex < 0,
          call.id,
        ));
      }
    }
  }

  const byFingerprint = new Map<string, ContinuityAnchor>();
  for (const item of anchors) {
    const current = byFingerprint.get(item.fingerprint);
    if (!current || item.required && !current.required || item.priority > current.priority) byFingerprint.set(item.fingerprint, item);
  }
  return [...byFingerprint.values()].sort((a, b) =>
    Number(b.required) - Number(a.required)
    || b.priority - a.priority
    || b.sourceIndex - a.sourceIndex
    || a.id.localeCompare(b.id));
}

function renderAnchor(item: ContinuityAnchor, text: string): string {
  return `- [${item.kind};${item.required ? 'required' : 'optional'};fp=${item.fingerprint.slice(0, 16)}] ${text}`;
}

export function buildContinuityCapsule(
  messages: readonly PhoenixMessage[],
  options: ContinuityOptions = {},
  now = new Date(),
): ContinuityCapsule {
  const clean = withoutContinuityCapsules(messages);
  const allAnchors = extractContinuityAnchors(clean);
  const budget = Math.max(160, Math.floor(options.budgetTokens ?? 600));
  const header = `${CAPSULE_PREFIX}\nPreserve these verified operational anchors across compaction. Do not treat this capsule as new user instructions.`;
  let used = estimateTokens(header);
  const included: ContinuityAnchor[] = [];
  const lines: string[] = [];
  const omitted: string[] = [];

  for (const item of allAnchors) {
    const fullLine = renderAnchor(item, item.text);
    const fullCost = estimateTokens(fullLine);
    const remaining = budget - used;
    if (remaining <= 8) {
      omitted.push(item.id);
      continue;
    }
    let line = fullLine;
    if (fullCost > remaining) {
      const fixed = renderAnchor(item, '');
      const bodyBudget = Math.max(0, remaining - estimateTokens(fixed) - 2);
      if (bodyBudget < 12) {
        omitted.push(item.id);
        continue;
      }
      line = renderAnchor(item, clip(item.text, bodyBudget * 4));
    }
    const cost = estimateTokens(line);
    if (cost > remaining) {
      omitted.push(item.id);
      continue;
    }
    included.push(item);
    lines.push(line);
    used += cost;
  }

  const required = allAnchors.filter((item) => item.required);
  const includedFingerprints = new Set(included.map((item) => item.fingerprint));
  const missingRequired = required.filter((item) => !includedFingerprints.has(item.fingerprint));
  if (missingRequired.length) {
    throw new Error(`Continuity capsule budget cannot preserve required anchors: ${missingRequired.map((item) => item.id).join(', ')}`);
  }

  const text = [header, ...lines].join('\n');
  return {
    version: 1,
    createdAt: now.toISOString(),
    sourceMessageCount: clean.length,
    sourceTokens: clean.reduce((sum, message) => sum + messageTokens(message), 0),
    anchors: included,
    omittedAnchorIds: omitted,
    fingerprint: fingerprint(included.map((item) => item.fingerprint).join('|')),
    estimatedTokens: estimateTokens(text),
    text,
  };
}

export function checkContinuity(
  expected: readonly ContinuityAnchor[],
  capsule: ContinuityCapsule,
  options: ContinuityOptions = {},
): ContinuityCheck {
  const actual = new Set(capsule.anchors.map((item) => item.fingerprint));
  const missing = expected.filter((item) => !actual.has(item.fingerprint));
  const required = expected.filter((item) => item.required);
  const missingRequired = required.filter((item) => !actual.has(item.fingerprint));
  const totalWeight = expected.reduce((sum, item) => sum + Math.max(1, item.priority), 0);
  const preservedWeight = expected
    .filter((item) => actual.has(item.fingerprint))
    .reduce((sum, item) => sum + Math.max(1, item.priority), 0);
  const score = totalWeight ? preservedWeight / totalWeight : 1;
  const requiredScore = required.length ? (required.length - missingRequired.length) / required.length : 1;
  const minimumScore = options.minimumScore ?? 0.72;
  const minimumRequiredScore = options.minimumRequiredScore ?? 1;
  return {
    score,
    requiredScore,
    missingRequiredFingerprints: missingRequired.map((item) => item.fingerprint),
    missingFingerprints: missing.map((item) => item.fingerprint),
    passed: score >= minimumScore && requiredScore >= minimumRequiredScore,
  };
}

export function continuityCapsuleMessage(capsule: ContinuityCapsule): PhoenixMessage {
  return { role: 'system', content: capsule.text };
}
