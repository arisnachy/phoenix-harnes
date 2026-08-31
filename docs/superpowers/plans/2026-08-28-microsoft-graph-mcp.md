# Integración Microsoft Graph OAuth + MCP — Plan de implementación

> **Para trabajadores agénticos:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Track every step with checkbox syntax and make a commit at each checkpoint.

**Objetivo:** Añadir a PHOENIX una integración local de Microsoft Graph para Outlook Mail y Calendar mediante OAuth PKCE y herramientas MCP, sin persistir secretos y con aprobación humana para escrituras.

**Arquitectura:** `MicrosoftGraphBroker` reutiliza el seam `ctx.authorization` y mantiene tokens solo en memoria. Un servidor MCP local por `stdio` no recibe tokens: solicita operaciones a un endpoint IPC loopback efímero autenticado por nonce. Una política `tools/pre-execute` exige `ctx.approval` para envío de correo y cambios de eventos.

**Tecnologías:** TypeScript, Cordis, Schemastery, Vitest, `@modelcontextprotocol/sdk`, Microsoft identity platform v2.0 y Microsoft Graph REST v1.0.

---

## Mapa de archivos

- Crear `packages/credentials/authorization/src/microsoft-broker.ts`: OAuth PKCE, sesión en memoria, API fija de Graph, telemetry y desconexión.
- Modificar `packages/credentials/authorization/src/index.ts`: exportar el broker desde el paquete y conservar el seam genérico sin lógica Microsoft.
- Modificar `packages/credentials/authorization/package.json`: exponer `./microsoft` y sus declaraciones compiladas.
- Crear `packages/credentials/authorization/tests/microsoft.spec.ts`: pruebas del broker y del límite de secretos.
- Crear `packages/mcp/microsoft-graph/src/server.ts`: servidor MCP `stdio` y cliente IPC, sin tokens.
- Crear `packages/mcp/microsoft-graph/src/host.ts`: endpoint IPC loopback, nonce efímero y adaptación de solicitudes al broker.
- Crear `packages/mcp/microsoft-graph/src/index.ts`: plugin host que registra el broker, monta IPC y enlaza el cliente MCP existente.
- Crear `packages/mcp/microsoft-graph/package.json` y `packages/mcp/microsoft-graph/tsconfig.json`, siguiendo las entradas y referencias de `packages/mcp/mcp-client`.
- Crear `packages/mcp/microsoft-graph/tests/server.spec.ts`: herramientas, IPC y cancelación.
- Crear `packages/mcp/microsoft-graph/tests/host.spec.ts`: autorización de IPC, dispatch al broker y política de escrituras.
- No modificar `pnpm-workspace.yaml`: su patrón `packages/*/*` ya incluye el nuevo paquete MCP.
- Crear `docs/integrations/microsoft-graph.md`: Azure/Entra, variables, permisos, conexión y desconexión.
- Modificar la documentación de configuración MCP solo en la sección de integraciones locales, sin alterar integraciones existentes.

### Tarea 1: Preparar worktree y baseline

**Archivos:** ninguno.

- [ ] **Paso 1: Crear un worktree aislado para la implementación**

Ejecutar desde el checkout de PHOENIX:

```powershell
git worktree add ..\Fenix-microsoft-graph -b feat/microsoft-graph-mcp HEAD
```

El worktree debe partir de `4009f771c3` y conservar los cambios no relacionados del checkout original fuera de la rama.

- [ ] **Paso 2: Verificar baseline focal**

```powershell
pnpm --filter @phoenix-ai/dsh-authorization test --run packages/credentials/authorization/tests/google.spec.ts
pnpm --filter @phoenix-ai/dsh-mcp-client test --run packages/mcp/mcp-client/tests/apply.spec.ts
```

Esperado: ambos comandos terminan con estado 0 antes de agregar Microsoft.

- [ ] **Paso 3: Registrar checkpoint**

```powershell
git status --short
git rev-parse --show-toplevel
git commit --allow-empty -m "chore: prepare Microsoft Graph integration worktree"
```

El commit debe ocurrir solo en `feat/microsoft-graph-mcp`.

### Tarea 2: Escribir las pruebas fallidas del broker OAuth

**Archivos:**
- Crear: `packages/credentials/authorization/tests/microsoft.spec.ts`

- [ ] **Paso 1: Añadir fixtures y contrato de configuración**

Crear un fixture con `clientId`, `tenant: 'common'` y scopes delegados. Sustituir `internals.fetch`, `internals.now` e `internals.openLoopback` mediante hooks exportados de prueba, igual que `google.spec.ts`.

Las primeras pruebas deben cubrir:

```ts ignore-check
it('normaliza configuración y rechaza scopes duplicados o vacíos', () => {})
it('construye autorización Microsoft con PKCE, state y tenant common', async () => {})
it('persiste únicamente { kind: api-key }', async () => {})
it('rechaza state inválido antes de aceptar el código', async () => {})
it('inyecta Bearer solo en graph.microsoft.com/v1.0', async () => {})
it('refresca en memoria sin persistir tokens rotados', async () => {})
it('rechaza URL y Authorization controlados por el llamador', async () => {})
it('desconecta localmente aunque falle la revocación remota', async () => {})
```

- [ ] **Paso 2: Ejecutar solo el archivo nuevo**

```powershell
pnpm --filter @phoenix-ai/dsh-authorization test --run packages/credentials/authorization/tests/microsoft.spec.ts
```

Esperado: FAIL porque aún no existen `MicrosoftGraphBroker`, `MICROSOFT_ACCOUNT_KEY` ni sus exports.

- [ ] **Paso 3: Commit de pruebas**

```powershell
git add packages/credentials/authorization/tests/microsoft.spec.ts
git commit -m "test: define Microsoft Graph OAuth boundary"
```

### Tarea 3: Implementar `MicrosoftGraphBroker`

**Archivos:**
- Crear: `packages/credentials/authorization/src/microsoft-broker.ts`
- Modificar: `packages/credentials/authorization/src/index.ts`
- Modificar: `packages/credentials/authorization/package.json`

- [ ] **Paso 1: Definir configuración y servicios fijos**

Exportar:

```ts ignore-check
export const MICROSOFT_ACCOUNT_KEY = credentialKey('authorization-microsoft', 'account')
export interface MicrosoftConfig {
  clientId?: string
  tenant?: string
  scopes: readonly string[]
}
export type MicrosoftGraphService = 'mail' | 'calendar'
```

Resolver por defecto `tenant: 'common'`. Rechazar `scopes: []`, duplicados, tenant vacío y client IDs con espacios sin normalizar. El conjunto mínimo debe incluir `openid profile email offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite`.

- [ ] **Paso 2: Implementar Authorization Code + PKCE**

Usar:

```text
https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
```

Generar `state`, `nonce` y `code_verifier`; usar `S256`; abrir un callback loopback efímero; validar `state`, `nonce`, issuer y presencia del código; intercambiar con `grant_type=authorization_code`; aceptar refresh token únicamente en memoria.

La notificación a la superficie debe contener solo la URL de autorización. Nunca incluir código, verifier, access token o refresh token.

- [ ] **Paso 3: Implementar el límite fijo de Graph**

Crear `request({ service, path, method, body, signal })` con:

- base fija `https://graph.microsoft.com/v1.0/`;
- rutas permitidas solo para los métodos Mail/Calendar que usará el servidor MCP;
- rechazo de URLs absolutas, `//host`, hosts distintos y cabecera `Authorization` del llamador;
- `redirect: 'error'` y propagación de `signal`;
- Bearer inyectado exclusivamente dentro del broker;
- scope check antes de cada servicio.

El resultado será una estructura sin headers sensibles y sin material de autenticación.

- [ ] **Paso 4: Implementar refresh, inspect y disconnect**

Mantener un único refresh en vuelo para evitar carreras. Al vencer el access token, usar `refresh_token` en memoria, actualizar el grant sin escribirlo en credenciales y volver a comprobar scopes. `inspect()` devolverá proveedor, tipo de cuenta y capacidades sanitizadas. `disconnect()` intentará revocar, elimina siempre el marcador y deja el broker en estado no autorizado.

- [ ] **Paso 5: Registrar el flujo y exports**

Registrar un `AuthorizationFlow` con label `Microsoft Outlook`, método `oauth`, `run`, `inspect` y `disconnect`. Exportar el broker y el key desde `./microsoft` en `package.json` sin exportar internals privadas en el build público.

- [ ] **Paso 6: Ejecutar pruebas del broker**

```powershell
pnpm --filter @phoenix-ai/dsh-authorization test --run packages/credentials/authorization/tests/microsoft.spec.ts
```

Esperado: PASS en todas las pruebas nuevas y las de Google.

- [ ] **Paso 7: Commit del broker**

```powershell
git add packages/credentials/authorization/src/microsoft-broker.ts packages/credentials/authorization/src/index.ts packages/credentials/authorization/package.json
git commit -m "feat: add Microsoft Graph OAuth broker"
```

### Tarea 4: Crear el servidor MCP local sin tokens

**Archivos:**
- Crear: `packages/mcp/microsoft-graph/src/server.ts`
- Crear: `packages/mcp/microsoft-graph/src/index.ts`
- Crear: `packages/mcp/microsoft-graph/package.json`
- Crear: `packages/mcp/microsoft-graph/tsconfig.json` con `rootDir: "src"`, `outDir: "lib/types"` y referencias a Cordis, Tools, Authorization y MCP Client.

- [ ] **Paso 1: Escribir primero las pruebas MCP**

En `tests/server.spec.ts`, comprobar que `tools/list` devuelve exactamente nueve herramientas, que cada esquema limita IDs, paginación, cuerpos e intervalos, y que ninguna descripción o resultado contiene tokens.

En `tests/host.spec.ts`, comprobar nonce inválido, nonce expirado, método no permitido, cancelación y que una escritura sin aprobación nunca llega al broker.

- [ ] **Paso 2: Ejecutar las pruebas nuevas antes de implementar**

```powershell
pnpm --filter @phoenix-ai/dsh-microsoft-graph-mcp test --run
```

Esperado: FAIL por paquete y servidor inexistentes.

- [ ] **Paso 3: Implementar `server.ts`**

Crear un servidor MCP `stdio` con las herramientas:

```text
search_messages, get_message, create_draft, send_message,
list_events, get_event, create_event, update_event, cancel_event
```

Cada handler hará una petición JSON al endpoint IPC recibido por variables efímeras `MICROSOFT_IPC_URL` y `MICROSOFT_IPC_NONCE`. El servidor no aceptará tokens, URLs Graph ni headers de autenticación en sus argumentos.

- [ ] **Paso 4: Implementar cancelación y límites**

Cada llamada debe asociarse a `AbortSignal`, aplicar el timeout configurado por el host y devolver errores estables. Los resultados solo contendrán JSON Graph saneado, sin headers, cookies, tokens ni payloads de autorización.

- [ ] **Paso 5: Añadir exports y build**

El paquete debe publicar un binario MCP local y una entrada de host. El comando de `stdio` debe poder arrancar con `node` sin shell interpolation.

- [ ] **Paso 6: Commit del servidor MCP**

```powershell
git add packages/mcp/microsoft-graph
git commit -m "feat: add Microsoft Graph local MCP server"
```

### Tarea 5: Implementar IPC loopback y host de Microsoft

**Archivos:**
- Crear: `packages/mcp/microsoft-graph/src/host.ts`
- Modificar: `packages/mcp/microsoft-graph/src/index.ts`
- Modificar: `pnpm-lock.yaml` solo si la instalación actualiza dependencias del nuevo paquete.

- [ ] **Paso 1: Crear endpoint IPC efímero**

Escuchar solo en `127.0.0.1`, elegir puerto efímero y generar nonce aleatorio de alta entropía por instancia. El endpoint debe aceptar únicamente `POST /request`, exigir nonce en un canal separado de los argumentos Graph, rechazar cuerpos mayores que el límite configurado y cerrar el listener al desmontar el plugin.

- [ ] **Paso 2: Adaptar solicitudes al broker**

Mapear cada herramienta a una operación fija del broker. El cliente MCP podrá enviar nombre y argumentos validados, pero nunca un destino HTTP. El host construirá la ruta Graph y el método HTTP desde una tabla constante.

- [ ] **Paso 3: Montar el cliente MCP existente**

Invocar el bridge `@phoenix-ai/dsh-mcp-client` con transporte `stdio`, namespace `microsoft`, comando Node y entorno limpiado que contenga solo URL/nonce efímeros. Esperar el descubrimiento inicial y cerrar cliente, IPC y broker mediante `ctx.effect`.

- [ ] **Paso 4: Registrar la política de aprobación**

Instalar un listener `tools/pre-execute` que devuelva `{ kind: 'ask', reason }` para los nombres públicos:

```text
mcp__microsoft__send_message
mcp__microsoft__create_event
mcp__microsoft__update_event
mcp__microsoft__cancel_event
```

Las lecturas y `create_draft` devolverán `allow`. La aprobación se resolverá por `ctx.approval`; sin servicio, agente o aprobación válida, la llamada se rechaza antes del IPC.

- [ ] **Paso 5: Añadir prueba de aprobación**

Verificar con `ApprovalService` que rechazo, cancelación y ausencia del canal no llaman al broker; verificar que `allowed-once` sí permite exactamente una llamada.

- [ ] **Paso 6: Ejecutar pruebas MCP y de paquetes relacionados**

```powershell
pnpm --filter @phoenix-ai/dsh-microsoft-graph-mcp test --run
pnpm --filter @phoenix-ai/dsh-mcp-client test --run packages/mcp/mcp-client/tests/apply.spec.ts
```

Esperado: PASS sin alterar las pruebas existentes del cliente MCP.

- [ ] **Paso 7: Commit del host e integración**

```powershell
git add packages/mcp/microsoft-graph package.json pnpm-lock.yaml
git commit -m "feat: wire Microsoft Graph OAuth broker to MCP"
```

### Tarea 6: Documentar Azure/Entra y conexión

**Archivos:**
- Crear: `docs/integrations/microsoft-graph.md`

- [ ] **Paso 1: Documentar el registro de aplicación**

Incluir instrucciones para crear una app en Microsoft Entra, elegir cuentas personales y organizativas, habilitar cliente público/desktop, configurar redirect loopback y conceder permisos delegados `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `offline_access`, `openid`, `profile` y `email`.

- [ ] **Paso 2: Documentar configuración local sin secretos**

Explicar `MICROSOFT_CLIENT_ID`, `common`, ausencia de `client_secret`, cómo iniciar PHOENIX, iniciar autorización, comprobar telemetry sanitizada y desconectar. Aclarar que los tokens se mantienen en memoria y que un reinicio pide reautorización.

- [ ] **Paso 3: Documentar consentimiento y seguridad**

Explicar que envío y cambios de calendario muestran confirmación, que Graph usa HTTPS, que IPC es loopback efímero y que nunca se deben pegar contraseñas, códigos ni tokens en el chat, repositorio o archivos de configuración.

- [ ] **Paso 4: Commit de documentación**

```powershell
git add docs/integrations/microsoft-graph.md
git commit -m "docs: explain Microsoft Graph OAuth MCP setup"
```

### Tarea 7: Verificación integral y auditoría

**Archivos:**
- Modificar solo si una prueba requiere ajuste focal en los archivos de test ya creados.

- [ ] **Paso 1: Ejecutar lint, tipos y pruebas focales**

```powershell
pnpm --filter @phoenix-ai/dsh-authorization lint
pnpm --filter @phoenix-ai/dsh-authorization test --run
pnpm --filter @phoenix-ai/dsh-microsoft-graph-mcp lint
pnpm --filter @phoenix-ai/dsh-microsoft-graph-mcp test --run
```

Esperado: estado 0 en todos los comandos.

- [ ] **Paso 2: Ejecutar la prueba de seguridad de secretos**

Inspeccionar credenciales de prueba, telemetría, errores, argumentos del proceso MCP y resultados serializados; ejecutar una aserción que falle si aparece cualquiera de estas cadenas: `access-token`, `refresh-token`, `authorization-code`, `code_verifier`, `client_secret`.

- [ ] **Paso 3: Verificar el grafo de herramientas**

Montar un contexto completo de prueba y comprobar que aparecen los nueve nombres bajo `mcp__microsoft__`, que no existen nombres sin namespace, y que las cuatro escrituras pasan por `ctx.approval`.

- [ ] **Paso 4: Verificar cambios no relacionados**

```powershell
git diff HEAD~7 --stat
git status --short
git diff --check
```

Confirmar que no se modificaron los cambios preexistentes del checkout original ni se añadieron secretos.

- [ ] **Paso 5: Commit final de ajustes de verificación**

```powershell
git add packages/credentials/authorization packages/mcp/microsoft-graph docs/integrations/microsoft-graph.md
git commit -m "test: verify Microsoft Graph OAuth MCP integration"
```

- [ ] **Paso 6: Preparar entrega**

Reportar commits, archivos principales, comandos ejecutados, resultados, limitación de reautorización tras reinicio y pasos pendientes del usuario: crear/confirmar app de Entra, definir `MICROSOFT_CLIENT_ID` y completar la primera autorización en PHOENIX.
