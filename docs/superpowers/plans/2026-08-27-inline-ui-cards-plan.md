# Inline Interactive UI Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render safe interactive `ui-card` blocks inside the PHOENIX conversation and let users prepare card responses in the existing composer without opening another window.

**Architecture:** Add a closed `ui-card` content-block type to the LLM contract, project it to a client `AssistantBlock`, and render it through a dedicated React card component from `AssistantMarkdown`. Keep card edit state local, validate data before rendering, route `fill`/`submit` through a composer-draft callback, and preserve `JsonBlock` for malformed or unknown data. No raw HTML, iframe, model-authored event handlers, or remote resource loading.

**Tech Stack:** TypeScript, React, CSS Modules, Vitest, Testing Library, existing PHOENIX web E2E harness.

---

## File map

- Modify `packages/llm/llm/src/types.ts`: add the typed `UiCardBlock` family to `ContentBlockMap`.
- Modify `packages/client/runtime/src/client/sessions/conversation.ts`: classify valid UI cards into `AssistantBlock` while routing malformed data to `other`.
- Modify `packages/client/runtime/src/client/sessions/partial.ts`: preserve unknown-block fallback and make complete `ui-card` blocks appear only at `block-end`.
- Create `packages/client/ui-conversation/src/client/chat/ui-card-model.ts`: runtime validation and deterministic response serialization.
- Create `packages/client/ui-conversation/src/client/chat/UiCard.tsx`: accessible card renderer and local interaction state.
- Create `packages/client/ui-conversation/src/client/chat/UiCard.module.css`: card visual system and responsive layout.
- Modify `packages/client/ui-conversation/src/client/chat/AssistantMarkdown.tsx`: dispatch `ui-card` blocks and pass the draft-preparation callback.
- Modify `packages/client/ui-conversation/src/client/chat/AssistantNodeView.tsx`: forward the card callback from the chat owner.
- Modify `packages/client/ui-conversation/src/client/contract/slots.ts`: add the owner callback for preparing composer drafts.
- Modify `packages/client/ui-conversation/src/client/contract/slots.ts` and `apply.ts`: bind the callback to the existing session-scoped conversation/input path.
- Modify `packages/client/ui-conversation/tests/chat-view.client.spec.tsx`: test end-to-end node rendering and draft preparation.
- Create `packages/client/ui-conversation/tests/ui-card-model.client.spec.ts`: test validation and serialization.
- Create `packages/client/ui-conversation/tests/ui-card.client.spec.tsx`: test accessible interaction states.
- Modify the relevant runtime tests for content classification and partial accumulation.

---

### Task 1: Add the closed wire content contract

**Files:**
- Modify: `packages/llm/llm/src/types.ts:99-110`
- Test: `packages/llm/llm/tests/message.spec.ts` or the existing content contract test location

- [ ] **Step 1: Write the failing type-level/runtime test**

Add a test fixture that constructs a `ContentBlock` with:

```ts
const card = {
  type: 'ui-card' as const,
  id: 'follow-up',
  title: 'Seguimiento psicológico',
  description: 'Completa los datos de la sesión.',
  fields: [
    { type: 'rating' as const, id: 'wellbeing', label: 'Bienestar', min: 0, max: 10 },
  ],
  actions: [{ id: 'prepare', label: 'Preparar respuesta', behavior: 'fill' as const }],
}
```

Assert that it can be accepted as the new content-block member and that its `type` is preserved.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run packages/llm/llm/tests/message.spec.ts
```

Expected: FAIL because `ContentBlockMap` has no `ui-card` member.

- [ ] **Step 3: Implement the minimal closed types**

In `packages/llm/llm/src/types.ts`, add before `ContentBlockMap`:

```ts
export interface UiCardOption {
  value: string
  label: string
}

export type UiCardField =
  | { type: 'text'; id: string; label: string; placeholder?: string; required?: boolean }
  | { type: 'textarea'; id: string; label: string; placeholder?: string; required?: boolean }
  | { type: 'select'; id: string; label: string; options: readonly UiCardOption[]; required?: boolean }
  | { type: 'radio'; id: string; label: string; options: readonly UiCardOption[]; required?: boolean }
  | { type: 'rating'; id: string; label: string; min: number; max: number; required?: boolean }
  | { type: 'date'; id: string; label: string; required?: boolean }

export interface UiCardAction {
  id: string
  label: string
  kind?: 'primary' | 'secondary'
  behavior: 'select' | 'fill' | 'submit'
}

export interface UiCardBlock {
  type: 'ui-card'
  id: string
  title: string
  description?: string
  fields?: readonly UiCardField[]
  actions: readonly UiCardAction[]
}
```

Add `'ui-card': UiCardBlock` to `ContentBlockMap`. Export the types from the package's public index if that index does not re-export `types.ts` wholesale.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm vitest run packages/llm/llm/tests/message.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/llm/llm/src/types.ts packages/llm/llm/tests/message.spec.ts
git commit -m "feat: add structured UI card content contract"
```

---

### Task 2: Project and validate cards in the client runtime

**Files:**
- Modify: `packages/client/runtime/src/client/sessions/conversation.ts:42-72`
- Modify: `packages/client/runtime/src/client/sessions/partial.ts:48-116`
- Create: `packages/client/ui-conversation/src/client/chat/ui-card-model.ts`
- Test: `packages/client/runtime/tests/conversation.client.spec.ts`
- Test: `packages/client/runtime/tests/partial.client.spec.ts`
- Create: `packages/client/ui-conversation/tests/ui-card-model.client.spec.ts`

- [ ] **Step 1: Write failing validation tests**

Create tests for `normalizeUiCard` with these cases:

```ts
expect(normalizeUiCard(validCard)).toMatchObject({ id: 'follow-up', title: 'Seguimiento psicológico' })
expect(normalizeUiCard({ ...validCard, actions: [] })).toBeNull()
expect(normalizeUiCard({ ...validCard, fields: [{ ...validCard.fields[0], id: 'x' }, { ...validCard.fields[0], id: 'x' }] })).toBeNull()
expect(normalizeUiCard({ ...validCard, fields: [{ type: 'rating', id: 'x', label: 'x', min: 10, max: 0 }] })).toBeNull()
expect(normalizeUiCard({ ...validCard, fields: [{ type: 'text', id: 'x', label: '<b>literal</b>' }] })?.fields[0]).toMatchObject({ label: '<b>literal</b>' })
```

Add runtime tests asserting `toAssistantBlock({ type: 'ui-card', ...validCard })` returns `{ kind: 'ui-card', card: validCard }`, while an invalid card returns `{ kind: 'other', block: ... }`. Add a partial test asserting an incomplete `block-start` yields a non-interactive `other` placeholder and `block-end` yields the validated UI-card projection.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm vitest run packages/client/runtime/tests/conversation.client.spec.ts packages/client/runtime/tests/partial.client.spec.ts packages/client/ui-conversation/tests/ui-card-model.client.spec.ts
```

Expected: FAIL because the validator, `ui-card` projection, and model type do not exist.

- [ ] **Step 3: Implement deterministic validation and serialization**

Create `ui-card-model.ts` with:

```ts
import type { UiCardBlock, UiCardField } from '@deepseek-ai/dsh-llm'

export type UiCardValues = Readonly<Record<string, string>>

const MAX_ACTIONS = 8
const MAX_FIELDS = 24
const MAX_OPTIONS = 32

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function unique(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length
}

function validField(field: unknown): field is UiCardField {
  if (typeof field !== 'object' || field === null) return false
  const candidate = field as Record<string, unknown>
  if (!text(candidate.type) || !text(candidate.id) || !text(candidate.label)) return false
  if (candidate.required !== undefined && typeof candidate.required !== 'boolean') return false
  if (candidate.type === 'text' || candidate.type === 'textarea' || candidate.type === 'date') return true
  if (candidate.type === 'rating') {
    return typeof candidate.min === 'number'
      && typeof candidate.max === 'number'
      && Number.isFinite(candidate.min)
      && Number.isFinite(candidate.max)
      && candidate.min < candidate.max
      && candidate.max - candidate.min <= 100
  }
  if (candidate.type === 'select' || candidate.type === 'radio') {
    if (!Array.isArray(candidate.options) || candidate.options.length === 0 || candidate.options.length > MAX_OPTIONS) return false
    return candidate.options.every(option => typeof option === 'object' && option !== null
      && text((option as Record<string, unknown>).value)
      && text((option as Record<string, unknown>).label))
      && unique((candidate.options as Record<string, unknown>[]).map(option => String(option.value)))
  }
  return false
}

export function normalizeUiCard(value: unknown): UiCardBlock | null {
  if (typeof value !== 'object' || value === null) return null
  const card = value as Record<string, unknown>
  if (card.type !== 'ui-card' || !text(card.id) || !text(card.title)) return null
  if (!Array.isArray(card.actions) || card.actions.length === 0 || card.actions.length > MAX_ACTIONS) return null
  const actions = card.actions as Record<string, unknown>[]
  if (!actions.every(action => text(action.id) && text(action.label)
    && (action.behavior === 'select' || action.behavior === 'fill' || action.behavior === 'submit')
    && (action.kind === undefined || action.kind === 'primary' || action.kind === 'secondary'))) return null
  if (!unique(actions.map(action => String(action.id)))) return null
  const fields = card.fields === undefined ? [] : card.fields
  if (!Array.isArray(fields) || fields.length > MAX_FIELDS || !fields.every(validField)) return null
  if (!unique((fields as Record<string, unknown>[]).map(field => String(field.id)))) return null
  return card as UiCardBlock
}

export function serializeUiCardValues(card: UiCardBlock, values: UiCardValues): string {
  const entries = (card.fields ?? []).flatMap(field => {
    const value = values[field.id]
    return value === undefined || value === '' ? [] : [`${field.label}: ${value}`]
  })
  return [card.title, ...entries].join('\n')
}

export function requiredUiCardFields(card: UiCardBlock, values: UiCardValues): readonly string[] {
  return (card.fields ?? []).filter(field => field.required && (values[field.id] ?? '') === '').map(field => field.id)
}
```

Update `AssistantBlock` with `{ kind: 'ui-card'; card: UiCardBlock }`. In `toAssistantBlock`, normalize the block and return `other` when normalization returns null. In `PartialAccumulator`, leave `block-start` as `other` and let `block-end` call the shared conversion; this keeps controls disabled until completion.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit runtime projection**

```bash
git add packages/client/runtime/src/client/sessions/conversation.ts packages/client/runtime/src/client/sessions/partial.ts packages/client/runtime/tests/conversation.client.spec.ts packages/client/runtime/tests/partial.client.spec.ts packages/client/ui-conversation/src/client/chat/ui-card-model.ts packages/client/ui-conversation/tests/ui-card-model.client.spec.ts
 git commit -m "feat: validate and project UI card blocks"
```

---

### Task 3: Build the accessible inline card component

**Files:**
- Create: `packages/client/ui-conversation/src/client/chat/UiCard.tsx`
- Create: `packages/client/ui-conversation/src/client/chat/UiCard.module.css`
- Create: `packages/client/ui-conversation/tests/ui-card.client.spec.tsx`

- [ ] **Step 1: Write failing component tests**

Test these concrete behaviors:

```tsx
const prepare = screen.getByRole('button', { name: 'Preparar respuesta' })
fireEvent.change(screen.getByLabelText('Comentario'), { target: { value: 'avance' } })
fireEvent.click(prepare)
expect(onPrepareDraft).toHaveBeenCalledWith('Seguimiento psicológico\nComentario: avance')
expect(screen.getByTestId('ui-card-follow-up')).toHaveAttribute('data-responded', 'true')
```

Also test:

- required fields show an error and do not call the callback;
- rating exposes values from min to max and updates its selected value;
- literal `<b>texto</b>` is rendered as text, not an element;
- submit action can be clicked only once after a successful response;
- the card has a `fieldset`/`legend` for grouped options and visible focusable buttons.

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
pnpm vitest run packages/client/ui-conversation/tests/ui-card.client.spec.tsx
```

Expected: FAIL because `UiCard` does not exist.

- [ ] **Step 3: Implement the minimal accessible renderer**

Export:

```ts
export interface UiCardProps {
  card: UiCardBlock
  onPrepareDraft: (text: string) => void
  disabled?: boolean
}
```

Use local `useState<UiCardValues>({})` and a `responded` boolean. Render `title` as `h3`, optional `description` as a paragraph, text/textarea/date controls with `label`, select with a label, radio options inside `fieldset`/`legend`, rating as a labeled group of buttons, and actions as native buttons. On `fill`/`submit`, call `requiredUiCardFields`; render a live error summary when needed; otherwise call `serializeUiCardValues`, set `responded`, and invoke `onPrepareDraft`. Treat all labels, descriptions, options and values as React text nodes. For `select`, `radio` and `rating`, update only local state until an action is pressed.

Use CSS Modules with a white rounded card, neutral border, soft background, visible focus ring, selected state that is not color-only, and a mobile-safe one-column field layout. Keep selectors local and do not use CSS values from the card payload.

- [ ] **Step 4: Run the component test and verify it passes**

Run the focused test. Expected: PASS.

- [ ] **Step 5: Commit the renderer**

```bash
git add packages/client/ui-conversation/src/client/chat/UiCard.tsx packages/client/ui-conversation/src/client/chat/UiCard.module.css packages/client/ui-conversation/tests/ui-card.client.spec.tsx
git commit -m "feat: render accessible inline UI cards"
```

---

### Task 4: Connect cards to the conversation composer

**Files:**
- Modify: `packages/client/ui-conversation/src/client/contract/slots.ts:415-427, 750-785`
- Modify: `packages/client/ui-conversation/src/client/chat/AssistantMarkdown.tsx:21-114`
- Modify: `packages/client/ui-conversation/src/client/chat/AssistantNodeView.tsx:6-31`
- Modify: `packages/client/ui-conversation/src/client/apply.ts:380-428`
- Test: `packages/client/ui-conversation/tests/chat-view.client.spec.tsx`

- [ ] **Step 1: Write the failing chat integration test**

Extend the chat harness so `ChatViewInjected` exposes a spy:

```ts
const prepareDraft = vi.fn()
const h = makeHarness({
  nodes: [assistantWithBlocks([{ kind: 'ui-card', card: followUpCard }])],
  prepareDraft,
})
const view = render(<h.ChatView {...h.props} />)
fireEvent.click(view.getByRole('button', { name: 'Preparar respuesta' }))
expect(prepareDraft).toHaveBeenCalledWith('Seguimiento psicológico')
expect(view.getByTestId('ui-card-follow-up')).toHaveAttribute('data-responded', 'true')
```

Add a regression test confirming ordinary Markdown, tool rows and image groups still render unchanged when the card is adjacent.

- [ ] **Step 2: Run the focused chat test and verify it fails**

Run:

```bash
pnpm vitest run packages/client/ui-conversation/tests/chat-view.client.spec.tsx
```

Expected: FAIL because `AssistantMarkdown` does not dispatch `ui-card` and the owner has no draft callback.

- [ ] **Step 3: Add the owner callback and wire it to the existing input path**

Add to `ChatNodeOwnerProps` and `ChatViewInjected`:

```ts
/** Place a card response in the active session composer; never sends implicitly. */
prepareCardDraft: (text: string) => void
```

In the conversation registration, bind `prepareCardDraft` to the session-scoped input/controller method that updates the current draft and focuses the composer. If the existing controller has no public draft setter, add the smallest method to `ConversationController` and expose it through the already-scoped `InputHub`; do not bypass session scoping or mutate DOM directly.

Add `prepareCardDraft` to `AssistantNodeView` and `AssistantMarkdown` props. Add this switch arm to `AssistantMarkdown`:

```tsx
case 'ui-card':
  rendered.push(
    <UiCard
      key={i}
      card={block.card}
      onPrepareDraft={prepareCardDraft}
      disabled={streaming}
    />,
  )
  break
```

Keep `hasVisible` true for `ui-card`, and retain `other` JSON fallback for invalid cards.

- [ ] **Step 4: Run the focused chat test and verify it passes**

Run the focused test. Expected: PASS.

- [ ] **Step 5: Commit the integration**

```bash
git add packages/client/ui-conversation/src/client/contract/slots.ts packages/client/ui-conversation/src/client/chat/AssistantMarkdown.tsx packages/client/ui-conversation/src/client/chat/AssistantNodeView.tsx packages/client/ui-conversation/src/client/apply.ts packages/client/ui-conversation/tests/chat-view.client.spec.tsx
git commit -m "feat: connect inline card responses to composer drafts"
```

---

### Task 5: Add web fixture and end-to-end coverage

**Files:**
- Modify: `packages/client/connection/src/client/fixture.ts` at the existing assistant fixture builders
- Create or modify: `apps/web/tests/inline-ui-card.e2e.ts`
- Modify: `packages/client/ui-conversation/tests/chat-view.client.spec.tsx` only if fixture helpers need a shared card factory

- [ ] **Step 1: Add a deterministic fixture**

Add a fixture assistant message containing text, a `ui-card` with a required textarea and rating field, and a trailing text block. Ensure the fixture is generated through the same `ContentBlock` path used by the web test session, not by mounting the component in isolation.

- [ ] **Step 2: Write the failing E2E journey**

The browser test must:

1. open the existing PHOENIX web fixture/session;
2. assert the card title and fields are visible inside the conversation URL;
3. select a rating and enter literal text;
4. click the prepare/submit action;
5. assert no new page or browser tab exists;
6. assert the composer contains the serialized response and the card is marked responded;
7. assert the adjacent Markdown remains visible.

- [ ] **Step 3: Run the E2E test and verify it fails before implementation is complete**

Run:

```bash
pnpm vitest run --config vitest.e2e.config.ts apps/web/tests/inline-ui-card.e2e.ts
```

Expected: FAIL until the fixture and integration are connected.

- [ ] **Step 4: Run the E2E test and verify it passes**

Run the same command. Expected: PASS with no unexpected page/tab navigation.

- [ ] **Step 5: Commit fixture and E2E coverage**

```bash
git add packages/client/connection/src/client/fixture.ts apps/web/tests/inline-ui-card.e2e.ts
git commit -m "test: cover inline UI card conversation flow"
```

---

### Task 6: Full verification and live GUI check

**Files:**
- No new source files; only corrections required by verification failures.

- [ ] **Step 1: Run focused unit/component tests**

```bash
pnpm vitest run packages/llm/llm/tests/message.spec.ts packages/client/runtime/tests/conversation.client.spec.ts packages/client/runtime/tests/partial.client.spec.ts packages/client/ui-conversation/tests/ui-card-model.client.spec.ts packages/client/ui-conversation/tests/ui-card.client.spec.tsx packages/client/ui-conversation/tests/chat-view.client.spec.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the web build**

```bash
pnpm run build:web
```

Expected: successful web artifact build with no TypeScript or bundler errors.

- [ ] **Step 3: Verify the existing PHOENIX GUI**

Confirm the existing `pnpm run dev:web` watcher is running from the PHOENIX checkout. Refresh `http://127.0.0.1:3080`, use the deterministic fixture/session, and verify the card appears inside the conversation, interactions stay in the same page, and the composer receives the draft.

- [ ] **Step 4: Run the E2E flow after the build**

```bash
pnpm vitest run --config vitest.e2e.config.ts apps/web/tests/inline-ui-card.e2e.ts
```

Expected: PASS.

- [ ] **Step 5: Inspect the final diff and status**

```bash
git diff --check HEAD~6..HEAD
git status --short
git log -6 --oneline
```

Expected: no whitespace errors, only intended files changed, and all six feature commits present.

- [ ] **Step 6: Record final evidence**

Document the focused test command, web build command, E2E result, existing URL verification, and any known limitation. Do not claim the feature is complete without a passing build and browser-visible card interaction.

---

## Plan self-review

- **Spec coverage:** The plan covers the closed content contract, validation, local state, accessible controls, streaming gating, composer preparation, fallback JSON, security constraints, visual treatment, unit/component/E2E tests, and the existing URL verification.
- **Placeholder scan:** No `TBD`, `TODO`, “implement later”, or unspecified error-handling steps remain; each code step names the file, contract, command, and expected result.
- **Type consistency:** The plan uses `UiCardBlock` for the wire block, `{ kind: 'ui-card'; card: UiCardBlock }` for the UI projection, and `prepareCardDraft(text: string)` consistently through owner props, assistant renderers, and the chat integration.
- **Scope:** The work remains one testable subsystem: declarative assistant cards with composer handoff. HTML execution, persistence, diagnostics and clinical automation remain explicitly out of scope.
