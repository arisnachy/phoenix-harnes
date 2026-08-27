# PHOENIX SurfaceHost, Windows Native Automation, and Restart-Safe Updater Design

## Purpose

PHOENIX needs three missing product capabilities that currently surface as one broken user experience:

1. Documents and generated artifacts must be viewable inside the conversation instead of being forced into an external application.
2. Models must be able to intentionally present interactive UI when that materially improves the task, while generated images and supported artifacts can surface automatically.
3. On Windows, the HARDNESS/browser stack must bridge common native system dialogs such as Open, Save As, file pickers, and confirmation dialogs without granting unrestricted desktop control.
4. A prepared stable update must activate and relaunch PHOENIX automatically under the Windows supervisor, without returning the user to PowerShell with a manual-restart message.

## Scope and ordering

This release implements the minimum coherent platform, not an unbounded desktop automation framework.

### In scope

- A typed `SurfaceDescriptor` contract for documents, media, artifacts, and mini-apps.
- An in-chat `SurfaceHost` with inline and expanded presentation modes.
- Native renderers for images, PDF, text/Markdown/code, JSON, and safe HTML mini-app documents.
- A generic metadata/fallback surface for unsupported files, preserving an explicit external-open action.
- Automatic presentation of newly generated supported visual artifacts.
- Model-invoked surface presentation for interactive or persistent visual work.
- A sandboxed mini-app surface using an iframe with a restrictive sandbox and no ambient filesystem, credential, cookie, or network authority.
- A Windows Native Automation capability limited to discoverable top-level dialogs and their standard controls.
- Support for Open, Save As, Folder Picker, download/file-confirmation, and standard confirmation dialogs using Windows UI Automation / PowerShell-backed inspection and action primitives.
- HARDNESS policy gates for every native action; no blind coordinate clicking and no arbitrary global desktop takeover.
- Updater watcher-to-supervisor handoff that writes a restart request after a candidate is prepared, with the supervisor terminating the current Host cleanly, activating the prepared target, and launching the new Host.
- Exactly one updater watcher in supervised Windows mode.

### Explicitly out of scope for this release

- Arbitrary control of every third-party Windows desktop application.
- OCR-driven desktop automation.
- Coordinate-only mouse scripting.
- Unrestricted execution of model-generated JavaScript in the PHOENIX origin.
- Native DOCX/XLSX editing. These formats may initially use a converted/read-only preview or metadata fallback until their dedicated renderer lands.

## Architecture

### 1. Surface protocol

Create a small capability package that defines a serializable contract:

```ts
export type SurfaceKind = 'document' | 'image' | 'media' | 'artifact' | 'app'

export interface SurfaceDescriptor {
  id: string
  kind: SurfaceKind
  title: string
  mimeType?: string
  uri?: string
  text?: string
  html?: string
  presentation?: 'inline' | 'panel' | 'fullscreen'
  interactive?: boolean
  source?: 'attachment' | 'tool' | 'generated' | 'model'
}
```

The contract is intentionally data-only. A tool/model cannot inject React components or receive direct references to browser internals.

`SurfaceHost` resolves the descriptor to a renderer through a typed registry. Unknown MIME types fall back to a safe metadata card plus explicit external open.

### 2. Presentation policy

PHOENIX separates automatic rendering from model choice.

Automatic presentation is allowed when:

- a supported image is generated;
- a supported document/artifact is explicitly opened by the user;
- a tool result explicitly declares a `SurfaceDescriptor`.

Model-driven presentation is appropriate when:

- the user says open/show/view/visualize/edit/interact;
- a persistent document view materially helps the ongoing task;
- an interactive control is more useful than a static textual answer;
- the model created a visual artifact and should show it.

The system prompt tells the model not to open a surface for trivial arithmetic or ordinary prose answers.

### 3. Mini-app isolation

Mini-app surfaces render inside a sandboxed iframe.

Required defaults:

- no `allow-same-origin`;
- no top navigation;
- no popups;
- no filesystem or credential APIs;
- no direct PHOENIX store access;
- no network unless a future explicit capability grant is introduced.

Communication uses a narrow `postMessage` bridge carrying validated JSON events. The first release supports local state and user input only.

### 4. Existing UI integration

Do not replace the conversation architecture.

- `ui-attachment` continues owning attachment acquisition but emits surface-compatible descriptors for supported files.
- `ui-tool` continues owning specialized tool cards; a result that includes a surface descriptor gains a surface affordance instead of falling back to plain text.
- `ui-deliverables` continues discovering produced files and can auto-present supported visual artifacts.
- `ui-conversation` owns the active/expanded SurfaceHost state so surfaces remain part of the conversation experience.

### 5. Windows Native Automation

Add a narrow capability that sits beside browser automation rather than inside it.

The capability exposes semantic operations:

```ts
interface WindowsDialogSummary {
  windowId: string
  title: string
  processName?: string
  kind: 'open-file' | 'save-file' | 'folder-picker' | 'confirmation' | 'unknown'
  controls: Array<{
    id: string
    role: 'button' | 'edit' | 'list' | 'tree' | 'combo' | 'checkbox' | 'other'
    name: string
    enabled: boolean
  }>
}
```

Operations:

- `windows.dialogs.list()`
- `windows.dialogs.inspect(windowId)`
- `windows.dialogs.setValue(windowId, controlId, value)`
- `windows.dialogs.invoke(windowId, controlId)`
- `windows.dialogs.selectFile(windowId, path)`
- `windows.dialogs.confirm(windowId, action)`

Implementation uses Windows UI Automation primitives available through PowerShell/.NET. The model never receives a generic `click(x,y)` primitive in this release.

### 6. HARDNESS boundary

All Windows-native actions pass through the same policy layer used to protect runtime/data paths.

Rules:

- inspection is read-only;
- writing/selecting a path is validated through HARDNESS path policy before the UI action occurs;
- protected PHOENIX runtime/credential paths remain denied;
- destructive or security-sensitive confirmations require explicit user intent already present in the turn or the existing confirmation mechanism;
- an unrecognized dialog fails closed;
- control lookup uses window/control identity and semantic roles, not screen coordinates.

### 7. Updater root cause and corrected lifecycle

Current evidence shows:

- `stageCandidate()` ends by printing `Restart PHOENIX to activate it.` and only records the prepared candidate.
- the Windows supervisor already knows how to detect `phoenix-update-restart-request.json`, activate a prepared candidate, and loop to launch a fresh Host.
- the watcher launched from the supervisor observes the supervisor PID, so it never reaches its parent-exit activation path during normal operation.
- `apps/cli/src/bin.ts` also starts its own watcher, giving Windows supervised mode two updater workers.

Correct lifecycle:

1. supervisor starts Host + one watcher;
2. watcher detects/promotes/stages/smoke-tests target;
3. watcher writes restart-request containing target and marks state `restart-requested`;
4. supervisor notices request while Host is still alive;
5. supervisor sends a graceful termination signal to Host and waits with a bounded fallback kill;
6. supervisor stops watcher;
7. activator validates request/prepared marker, fast-forwards, performs live build/smoke/rollback logic;
8. supervisor starts a fresh Host and watcher;
9. restart request is cleared only by a successful or safely handled activation path;
10. the old manual restart message is removed.

To avoid duplicate workers, the Host does not call `startPhoenixUpdateWatcher()` when `PHOENIX_UPDATE_SUPERVISED=1`; the supervisor sets this environment variable for its Host.

## Failure handling

### SurfaceHost

- malformed descriptors are rejected and shown as a non-interactive error card;
- failed PDF/text fetch shows retry/open-external actions;
- mini-app bridge messages are schema validated;
- unsupported files never execute content.

### Windows Native Automation

- if UI Automation is unavailable, return an explicit unsupported/unavailable result;
- stale window/control identifiers fail without clicking anything else;
- path-policy denial is surfaced to the model as a normal tool error;
- timeouts never fall back to coordinate clicks.

### Updater

- no restart request is emitted until staging + smoke passes;
- supervisor does not stop the Host for `notify` or failed preparation;
- activation failures use the existing recovery/rollback path;
- relaunch only occurs after activator success or a safely recoverable current-state result;
- no `Restart PHOENIX to activate it` message remains in normal auto mode.

## Testing strategy

1. Updater contract tests assert that a successful watched preparation creates a restart request and never emits the legacy manual-restart text.
2. Supervisor tests assert that a restart request causes graceful Host termination, watcher shutdown, one activation, and one fresh Host launch.
3. CLI tests assert supervised Host mode does not start a second watcher.
4. Windows-native unit tests use a fake UI Automation adapter for dialog classification, semantic control interaction, stale IDs, and policy denial.
5. Windows-native integration smoke runs on `windows-latest` against a test WinForms/PowerShell dialog fixture.
6. Surface descriptor schema tests cover supported and invalid descriptors.
7. SurfaceHost UI tests cover image, PDF, text, fallback, and sandboxed app rendering.
8. Conversation/tool/deliverable integration tests assert generated image auto-presentation and model/tool-requested surface presentation.
9. Final gates: targeted Vitest suites, `pnpm run typecheck`, `pnpm run check:ci:static`, `pnpm run build`, and Windows blocking gates.

## Release rule

Implementation lands on `feat/surfacehost-windows-native-update`, is reviewed through a PR, and is promoted to `stable` only after the exact merged `main` SHA passes Windows-native/updater regression coverage. Linux-only diagnostics may remain non-blocking only when they are proven not to affect the Windows release path.