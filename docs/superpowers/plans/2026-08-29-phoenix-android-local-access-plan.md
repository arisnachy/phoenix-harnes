# Acceso local de PHOENIX desde Android — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir y verificar un cliente Android nativo que se conecte a PHOENIX por LAN mediante QR temporal, chat, avisos, pantalla autorizada y control semántico limitado.

**Architecture:** PHOENIX expone un plugin local independiente del puente `/api`, enlazado únicamente a interfaces privadas y protegido por TLS con huella fijada, invitaciones de un solo uso y claves por dispositivo. Settings consume el estado del plugin y muestra QR, permisos y revocación; Android usa Kotlin/Compose, Android Keystore y un protocolo JSON versionado con firmas y contadores anti-replay.

**Tech Stack:** TypeScript estricto, Cordis, `node:http`/WebSocket existente, `@deepseek-ai/schemastery`, React/CSS Modules, Kotlin, Jetpack Compose, Android Keystore, `MediaProjection` solo para la superficie autorizada y notificaciones locales mediante servicio en primer plano opcional.

---

## Inventario de archivos y paquetes

Crear `packages/interaction/mobile-access/` como paquete de capacidad host con definición, proveedor LAN, protocolo, persistencia local protegida, servidor y pruebas. No reutilizar el puente general `/api` ni aceptar nombres de métodos dinámicos.

Crear `packages/client/ui-settings-mobile-access/` como consumidor web de Settings. El paquete renderiza la tarjeta, QR, huella, permisos, estado y revocación, y solo llama al servicio tipado de mobile-access.

Crear `apps/android/` como proyecto Gradle independiente, porque el workspace PHOENIX usa pnpm/TypeScript y no contiene todavía una aplicación Android. El cliente comparte el contrato wire mediante un archivo JSON versionado generado o copiado durante el build, nunca mediante importación de código TypeScript en Android.

Modificar `packages/bundle/base/cordis.patch.yml` únicamente cuando el plugin host y el consumidor hayan pasado sus pruebas de carga, añadiendo una fila desactivable con configuración explícita y sin habilitar exposición pública por defecto.

Añadir `packages/interaction/mobile-access/README.md`, `packages/client/ui-settings-mobile-access/README.md` y una Agent Note en `.agents/notes/implemented/` al cerrar la implementación. La documentación describe el estado actual, no una historia de cambios.

---

### Task 1: Contrato wire y pruebas de seguridad puras

**Files:**
- Create: `packages/interaction/mobile-access/package.json`
- Create: `packages/interaction/mobile-access/tsconfig.json`
- Create: `packages/interaction/mobile-access/src/protocol.ts`
- Create: `packages/interaction/mobile-access/src/network-policy.ts`
- Create: `packages/interaction/mobile-access/src/invitation.ts`
- Create: `packages/interaction/mobile-access/src/command-policy.ts`
- Test: `packages/interaction/mobile-access/tests/protocol.spec.ts`
- Test: `packages/interaction/mobile-access/tests/network-policy.spec.ts`
- Test: `packages/interaction/mobile-access/tests/invitation.spec.ts`

- [ ] **Step 1: Write the failing tests for private-address and command policy**

```ts
it('accepts only private LAN addresses and rejects public, loopback, wildcard, and link-local addresses', () => {
  expect(isPrivateLanAddress('192.168.1.44')).toBe(true)
  expect(isPrivateLanAddress('10.0.0.8')).toBe(true)
  expect(isPrivateLanAddress('172.20.4.2')).toBe(true)
  expect(isPrivateLanAddress('127.0.0.1')).toBe(false)
  expect(isPrivateLanAddress('0.0.0.0')).toBe(false)
  expect(isPrivateLanAddress('8.8.8.8')).toBe(false)
})

it('rejects every command outside the semantic allowlist', () => {
  expect(parseMobileCommand({ kind: 'session.stop', requestId: 'r1' }).kind).toBe('session.stop')
  expect(() => parseMobileCommand({ kind: 'shell.exec', command: 'whoami' })).toThrow()
  expect(() => parseMobileCommand({ kind: 'dom.evaluate', script: 'alert(1)' })).toThrow()
  expect(() => parseMobileCommand({ kind: 'screen.pointer', x: 1, y: 2 })).toThrow()
})
```

- [ ] **Step 2: Run the focused tests and confirm the expected red failure**

Run: `pnpm exec vitest run packages/interaction/mobile-access/tests/network-policy.spec.ts packages/interaction/mobile-access/tests/protocol.spec.ts`

Expected: FAIL because the new parser and address policy do not exist.

- [ ] **Step 3: Implement the minimal versioned protocol**

Define `MobileAccessCommand` as a closed discriminated union containing only `chat.send`, `session.select`, `session.stop`, `approval.answer`, `settings.open`, `screen.start`, and `screen.stop`. Validate all wire payloads with schemastery or the repository's existing boundary parser. Include `version`, `requestId`, `deviceId`, `counter`, `timestamp`, `nonce`, and encrypted payload metadata in every authenticated frame.

Implement `isPrivateLanAddress()` with canonical IP parsing and explicit rejection of loopback, wildcard, multicast, link-local, public, and unspecified addresses. Require a concrete private interface address before the server can start.

Implement invitation creation with 32 random bytes, a 60-second expiry, one-use state, protocol version, private URL, and certificate fingerprint. Keep secrets out of logs and delete the invitation after use or expiry.

- [ ] **Step 4: Run the focused tests and confirm green**

Run: `pnpm exec vitest run packages/interaction/mobile-access/tests/network-policy.spec.ts packages/interaction/mobile-access/tests/protocol.spec.ts packages/interaction/mobile-access/tests/invitation.spec.ts`

Expected: PASS with coverage for public-address rejection, malformed commands, unknown versions, expiry, reuse, and malformed QR fields.

- [ ] **Step 5: Commit only the new package files**

Run: `git add packages/interaction/mobile-access && git commit -m "feat: add local mobile access wire contract"`

If repository hooks inspect unrelated pre-staged files and fail, do not modify or unstage those files; report the hook failure and preserve the new files for a clean commit later.

---

### Task 2: TLS local server and device authentication

**Files:**
- Create: `packages/interaction/mobile-access/src/certificate-store.ts`
- Create: `packages/interaction/mobile-access/src/device-store.ts`
- Create: `packages/interaction/mobile-access/src/local-server.ts`
- Create: `packages/interaction/mobile-access/src/session-auth.ts`
- Test: `packages/interaction/mobile-access/tests/local-server.spec.ts`
- Test: `packages/interaction/mobile-access/tests/session-auth.spec.ts`

- [ ] **Step 1: Write failing server-boundary tests**

```ts
it('does not bind wildcard or public interfaces', async () => {
  await expect(startLocalMobileServer({ addresses: ['0.0.0.0'], port: 0 })).rejects.toThrow(/private/i)
  await expect(startLocalMobileServer({ addresses: ['8.8.8.8'], port: 0 })).rejects.toThrow(/private/i)
})

it('rejects an expired, reused, or incorrectly signed pairing request', async () => {
  const invitation = createInvitation({ now: 1_000 })
  const first = await pair(invitation, validDeviceRequest(invitation, { now: 1_010 }))
  expect(first.ok).toBe(true)
  expect(await pair(invitation, validDeviceRequest(invitation, { now: 1_011 }))).toMatchObject({ ok: false, reason: 'invitation-used' })
  const expired = createInvitation({ now: 1_000 })
  expect(await pair(expired, validDeviceRequest(expired, { now: 62_001 }))).toMatchObject({ ok: false, reason: 'invitation-expired' })
  expect(await pair(createInvitation({ now: 2_000 }), invalidSignatureRequest())).toMatchObject({ ok: false, reason: 'signature-invalid' })
})
```

- [ ] **Step 2: Run the tests and verify they fail for missing server/auth behavior**

Run: `pnpm exec vitest run packages/interaction/mobile-access/tests/local-server.spec.ts packages/interaction/mobile-access/tests/session-auth.spec.ts`

Expected: FAIL because the local server and pairing implementation do not exist.

- [ ] **Step 3: Implement certificate pinning and local binding**

Generate a local TLS certificate with SAN entries for the selected private addresses and persist the certificate/private key through the existing protected home-path mechanism. Return only the SHA-256 certificate fingerprint to Settings and the QR generator.

Bind one server listener per enumerated private address. Do not call UPnP, NAT traversal, DNS discovery, public STUN/TURN, or port-forwarding APIs. Reject a stale interface list and close all listeners on disposal.

Implement device authentication as a challenge signed by the Android device key. Derive an ephemeral session key from the authenticated key exchange and use an AEAD envelope for chat/control payloads. Reject invalid signatures, duplicate counters, old timestamps, nonces reused within a session, unknown devices, oversized frames, and revoked devices.

- [ ] **Step 4: Run the security tests and verify green**

Run: `pnpm exec vitest run packages/interaction/mobile-access/tests/local-server.spec.ts packages/interaction/mobile-access/tests/session-auth.spec.ts`

Expected: PASS with explicit tests for public/wildcard binding, certificate fingerprint mismatch, replay, invalid signatures, revocation, teardown, and frame limits.

- [ ] **Step 5: Commit the server/auth slice**

Run: `git add packages/interaction/mobile-access/src packages/interaction/mobile-access/tests && git commit -m "feat: secure local mobile access server"`

---

### Task 3: Cordis plugin and PHOENIX integration

**Files:**
- Create: `packages/interaction/mobile-access/src/index.ts`
- Create: `packages/interaction/mobile-access/src/invariant.ts`
- Create: `packages/interaction/mobile-access/tests/plugin.spec.ts`
- Create: `packages/interaction/mobile-access/tests/invariant.spec.ts`
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `packages/bundle/base/package.json` only if the package graph requires the new workspace dependency

- [ ] **Step 1: Add failing lifecycle and capability tests**

The plugin tests must assert that the service is unavailable before application, starts only with an explicit `enabled: true` setting and a private interface, publishes the current device/session state, rejects privileged methods, and disposes the listener, capture provider, timers, and active sessions.

- [ ] **Step 2: Run plugin tests and verify the expected red state**

Run: `pnpm exec vitest run packages/interaction/mobile-access/tests/plugin.spec.ts packages/interaction/mobile-access/tests/invariant.spec.ts`

Expected: FAIL because the plugin export, service, and invariant are absent.

- [ ] **Step 3: Implement the Cordis service/provider contract**

Expose typed operations for `status`, `createInvitation`, `pairDevice`, `setPermissions`, `revokeDevice`, `disconnectAll`, `sendEvent`, and `dispatchCommand`. Register listeners through `ctx.effect()` and route chat/session/approval state through existing session, agent, interaction, and command extension points rather than changing the agent loop.

Do not expose `settings.describe`, credential methods, arbitrary remote methods, filesystem methods, shell methods, or generic API gateway forwarding. Persist only public device metadata and encrypted session state.

Add the package invariant so it verifies the owned relationship between the service, private listener, and disposed resources instead of checking merely that a method exists.

- [ ] **Step 4: Mount the plugin behind an explicit disabled-by-default row**

Add the bundle row only after the plugin tests are green. The default configuration must set `enabled: false`, `bindPrivateInterfaces: true`, `port: 0`, `screen: false`, and `notifications: false`; no public bind or automatic port forwarding option may exist.

- [ ] **Step 5: Run package build and lifecycle tests**

Run: `pnpm exec vitest run packages/interaction/mobile-access/tests/plugin.spec.ts packages/interaction/mobile-access/tests/invariant.spec.ts && pnpm run build:lib:host`

Expected: PASS and generated host types resolve without changing unrelated staged files.

---

### Task 4: Settings card and QR setup experience

**Files:**
- Create: `packages/client/ui-settings-mobile-access/package.json`
- Create: `packages/client/ui-settings-mobile-access/src/client/MobileAccessRow.tsx`
- Create: `packages/client/ui-settings-mobile-access/src/client/MobileAccessRow.module.css`
- Create: `packages/client/ui-settings-mobile-access/src/client/controller.ts`
- Create: `packages/client/ui-settings-mobile-access/src/client/locales.ts`
- Create: `packages/client/ui-settings-mobile-access/src/client/index.ts`
- Test: `packages/client/ui-settings-mobile-access/tests/controller.client.spec.ts`
- Test: `packages/client/ui-settings-mobile-access/tests/row.client.spec.tsx`

- [ ] **Step 1: Write failing Settings behavior tests**

Test that the row renders disabled/offline states, generates an invitation only on an explicit click, shows expiry and certificate fingerprint, renders paired-device permissions, revokes one device, disconnects all devices, and explains why public interfaces and missing private-network access disable the feature.

- [ ] **Step 2: Run the focused UI tests and verify red**

Run: `pnpm exec vitest run packages/client/ui-settings-mobile-access/tests/controller.client.spec.ts packages/client/ui-settings-mobile-access/tests/row.client.spec.tsx`

Expected: FAIL because the consumer package and row do not exist.

- [ ] **Step 3: Implement the controller and row**

Use the existing Settings slots, locale registration, snapshot stores, tooltip and dialog primitives. Keep QR content code-native as a generated QR asset or existing QR component; display the short confirmation code, expiry countdown, LAN URL, fingerprint, paired-device list, permission toggles, revoke action, and `Desconectar todos`.

The visual direction is a compact PHOENIX dark surface: one purposeful panel, restrained borders, high-contrast status indicator, 8px spacing rhythm, 12–14px control typography, and no decorative dashboard clutter. The row must remain usable with keyboard focus, screen readers and narrow widths.

- [ ] **Step 4: Run UI tests and build the client package**

Run: `pnpm exec vitest run packages/client/ui-settings-mobile-access/tests/controller.client.spec.ts packages/client/ui-settings-mobile-access/tests/row.client.spec.tsx && pnpm run build:lib:client`

Expected: PASS, with the card mounting through `settings.general.item` and no runtime console errors in the test renderer.

- [ ] **Step 5: Add the Settings package to the web composition**

Register the package in the same client module manifest used by the existing Settings contributions. Build `apps/web` and verify that the card appears only when the host service reports the feature available.

---

### Task 5: Android application, secure pairing, chat and control

**Files:**
- Create: `apps/android/settings.gradle.kts`
- Create: `apps/android/build.gradle.kts`
- Create: `apps/android/app/build.gradle.kts`
- Create: `apps/android/app/src/main/AndroidManifest.xml`
- Create: `apps/android/app/src/main/java/ai/phoenix/mobile/MainActivity.kt`
- Create: `apps/android/app/src/main/java/ai/phoenix/mobile/security/DeviceKeyStore.kt`
- Create: `apps/android/app/src/main/java/ai/phoenix/mobile/security/PairingClient.kt`
- Create: `apps/android/app/src/main/java/ai/phoenix/mobile/protocol/MobileAccessWire.kt`
- Create: `apps/android/app/src/main/java/ai/phoenix/mobile/ui/AppScreen.kt`
- Create: `apps/android/app/src/main/java/ai/phoenix/mobile/ui/AppTheme.kt`
- Test: `apps/android/app/src/test/java/ai/phoenix/mobile/PairingClientTest.kt`
- Test: `apps/android/app/src/androidTest/java/ai/phoenix/mobile/PairingFlowTest.kt`

- [ ] **Step 1: Verify the Android toolchain before creating the project**

Run from `apps/android`: `gradlew.bat --version` and `adb version`.

Expected: Gradle wrapper and Android SDK are available. If either is missing, stop this task and install the approved Android SDK/toolchain before writing native code; do not substitute a fake build result.

- [ ] **Step 2: Write failing pairing and command tests**

Test that the client rejects non-private QR URLs, rejects certificate fingerprints that differ from the QR, stores the device key only through Android Keystore, rejects replayed counters, requires confirmation for `session.stop` and `approval.answer`, and never serializes a shell or arbitrary method command.

- [ ] **Step 3: Implement the native app shell**

Use Kotlin/Compose with screens for `Chat`, `Actividad`, `Pantalla`, and `Ajustes`. The app stores the paired host certificate fingerprint, host public key, device private key alias, permissions and session token in protected storage. The QR scanner passes only the invitation fields to `PairingClient`; it does not execute URLs or arbitrary payloads.

- [ ] **Step 4: Implement pairing and authenticated WebSocket**

Validate protocol version, private IP, expiry, certificate fingerprint and one-time invitation before sending the device public key. Complete the challenge/signature exchange, persist the paired public metadata, and establish the encrypted event channel. Reconnect with bounded backoff only while the user has enabled the local connection.

- [ ] **Step 5: Implement chat and limited control**

Render streaming chat events from the authenticated channel. Map UI actions to the closed command union. Require a confirmation dialog for stopping work or answering an approval; show the resulting host event and an audit label without exposing raw secrets or internal payloads.

- [ ] **Step 6: Run JVM and device tests**

Run: `gradlew.bat :app:testDebugUnitTest :app:connectedDebugAndroidTest`

Expected: PASS on an emulator or connected Android device. Capture a screenshot of the paired state and a failed certificate-mismatch state outside the repository.

---

### Task 6: Authorized PHOENIX screen capture and local notifications

**Files:**
- Create: `packages/interaction/mobile-access/src/screen-capture.ts`
- Create: `packages/interaction/mobile-access/src/notification-events.ts`
- Test: `packages/interaction/mobile-access/tests/screen-capture.spec.ts`
- Test: `packages/interaction/mobile-access/tests/notification-events.spec.ts`
- Modify: `apps/android/app/src/main/AndroidManifest.xml`
- Modify: `apps/android/app/src/main/java/ai/phoenix/mobile/ui/AppScreen.kt`

- [ ] **Step 1: Write failing capture and notification policy tests**

Assert that capture is off by default, cannot start without a paired device with the `screen` permission, has a bounded resolution/frame rate/queue size, stops on revoke/disconnect/dispose, and never captures a full desktop target. Assert that notification payloads contain only minimal event text and no credential, screen dump, token, or secret fields.

- [ ] **Step 2: Implement the host capture provider**

Create a provider interface whose only accepted target is the PHOENIX window or viewport. The Windows implementation must fail closed when the target cannot be identified. Frames are dropped under backpressure, are not persisted, and are cleared on session close. Publish a visible capture indicator in PHOENIX while active.

- [ ] **Step 3: Implement Android display and notification permissions**

Request Android notification permission at the moment the user enables notifications. Use a foreground service only when explicitly enabled, with the required persistent notification. Make the `Pantalla` screen show permission state, connection state, frame freshness and a stop button.

- [ ] **Step 4: Run focused tests and Android checks**

Run: `pnpm exec vitest run packages/interaction/mobile-access/tests/screen-capture.spec.ts packages/interaction/mobile-access/tests/notification-events.spec.ts && gradlew.bat :app:testDebugUnitTest`

Expected: PASS; capture permission denial leaves chat working and produces a clear disabled state.

---

### Task 7: End-to-end local verification and security audit

**Files:**
- Create: `packages/interaction/mobile-access/tests/local-flow.e2e.ts`
- Create: `apps/web/tests/mobile-access.e2e.ts`
- Create: `.agents/notes/implemented/architecture/2026-08-29-local-mobile-access.md`
- Modify: `packages/interaction/mobile-access/README.md`
- Modify: `packages/client/ui-settings-mobile-access/README.md`

- [ ] **Step 1: Run protocol and package checks**

Run: `pnpm exec vitest run packages/interaction/mobile-access/tests && pnpm exec vitest run packages/client/ui-settings-mobile-access/tests`

Expected: PASS with no framework overlays, unhandled rejections, or warning output caused by the new packages.

- [ ] **Step 2: Run the assembled web checks**

Run: `pnpm run build && pnpm run test:web:built -- mobile-access`

Expected: the Settings card loads from the built PHOENIX web artifact and the QR lifecycle, status, revoke and disconnect actions update real state.

- [ ] **Step 3: Exercise the real local flow**

Start PHOENIX with the mobile-access row enabled on a private network, open Settings, generate a QR, pair an Android device, send a chat message, select a session, stop a test run, request screen capture, stop capture, revoke the device, and verify the Android UI reports each state.

The flow under test is: `Settings > Acceso móvil` → `Emparejar Android` → scan QR → confirm fingerprint on both devices → send chat → receive event → start/stop authorized screen view → revoke device.

- [ ] **Step 4: Run negative-network checks**

Confirm with local firewall and socket inspection that there is no listener on public interfaces, no UPnP mapping, no outbound relay, no public DNS/STUN/TURN request, no HTTP downgrade, and no `/api` privileged method reachable from the Android client.

- [ ] **Step 5: Verify desktop and mobile screenshots**

Use the Browser/IAB path first for the PHOENIX Settings surface. Verify page identity, nonblank content, absence of framework overlay, console health, QR state and revoke interaction. Use an Android emulator/device screenshot for the native UI. Check desktop and a narrow browser viewport for Settings layout.

- [ ] **Step 6: Run repository gates relevant to changed surfaces**

Run: `pnpm run typecheck && pnpm run lint && pnpm run build && pnpm run verify-doc-budgets && pnpm run verify-md-links`

Expected: PASS, or a clearly isolated pre-existing failure recorded without changing unrelated files.

- [ ] **Step 7: Record the Agent Note and final evidence**

Record current behavior, security non-goals, exact verification commands, missing platform coverage, and the fact that out-of-home access requires a separately approved public transport. Before claiming completion, read the current goal, confirm every required flow has evidence, and only then mark the goal complete.

---

## Plan self-review

- **Spec coverage:** LAN-only binding is covered by Tasks 1–3 and 7; QR pairing by Tasks 1, 2, 4 and 5; chat/control by Tasks 3, 5 and 7; screen capture by Task 6; notifications by Tasks 3, 6 and 7; installation metadata by Task 4 and the APK build in Task 5; revocation and teardown by Tasks 2, 3, 5 and 7; documentation and future remote-access boundary by Task 7.
- **Security coverage:** Public/wildcard addresses, UPnP, relay, privileged API forwarding, invalid signatures, replay, stale invitations, fingerprint mismatch, command injection, frame limits and resource teardown each have an explicit test or verification step.
- **Placeholder scan:** The plan contains no `TBD`, `TODO`, or unspecified “add validation” step. Missing Android tooling is an explicit prerequisite with a concrete command and stop condition.
- **Type consistency:** The command kinds, invitation fields, device key flow, status/revoke operations and Settings consumer names remain consistent across the tasks.
- **Known limitation:** This plan intentionally does not implement access outside the LAN. Adding a relay, VPN or server-owned public endpoint requires a separate threat-model review and user approval.
