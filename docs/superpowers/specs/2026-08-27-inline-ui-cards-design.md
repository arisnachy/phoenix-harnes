# Tarjetas interactivas embebidas en la conversación

## Objetivo

Permitir que PHOENIX renderice tarjetas interactivas dentro del flujo de conversación, sin abrir ventanas externas y sin ejecutar HTML o JavaScript generado por el modelo. La primera versión soportará decisiones y formularios reutilizables, incluyendo el formulario de seguimiento psicológico solicitado por el usuario.

## Decisión de diseño

Se incorporará un bloque estructurado nativo `ui-card` al plano de contenido de asistente. La UI lo proyectará mediante un renderer React dedicado y seguro. No se aceptará HTML libre, `iframe`, URLs locales ni scripts como contenido ejecutable.

La tarjeta será una vista de datos declarativa e inmutable. Su estado de selección y edición será efímero y local al componente; no se persistirá en el historial hasta que el usuario pulse una acción de envío.

## Contrato de datos

El bloque tendrá una forma discriminada y cerrada:

```ts
interface UiCardBlock {
  type: 'ui-card'
  id: string
  title: string
  description?: string
  fields?: readonly UiCardField[]
  actions: readonly UiCardAction[]
}

type UiCardField =
  | { type: 'text'; id: string; label: string; placeholder?: string; required?: boolean }
  | { type: 'textarea'; id: string; label: string; placeholder?: string; required?: boolean }
  | { type: 'select'; id: string; label: string; options: readonly UiCardOption[]; required?: boolean }
  | { type: 'radio'; id: string; label: string; options: readonly UiCardOption[]; required?: boolean }
  | { type: 'rating'; id: string; label: string; min: number; max: number; required?: boolean }
  | { type: 'date'; id: string; label: string; required?: boolean }

type UiCardOption = { value: string; label: string }

type UiCardAction = {
  id: string
  label: string
  kind?: 'primary' | 'secondary'
  behavior: 'select' | 'fill' | 'submit'
}
```

### Invariantes

- `id`, `title`, `actions[].id`, `actions[].label` y todos los ids de campo deben ser cadenas no vacías.
- Los ids de campos y acciones no se pueden repetir dentro de una tarjeta.
- `actions` debe contener al menos una acción y tener un límite pequeño definido por el schema.
- `rating` debe tener `min < max` y un rango razonable para evitar controles patológicos.
- `select` y `radio` deben tener opciones únicas y no vacías.
- Los valores recibidos se validan antes de renderizarse; un bloque inválido cae al renderer JSON existente.
- El renderer nunca interpreta strings como markup, URLs navegables o código.

## Flujo de interacción

1. El renderer recibe el bloque desde `AssistantMarkdown` en el orden original del mensaje.
2. La tarjeta muestra sus campos con labels accesibles, estados de error y navegación por teclado.
3. `select` y `radio` actualizan selección local; `text`, `textarea`, `date` y `rating` actualizan estado local.
4. `behavior: 'select'` marca una opción sin enviar.
5. `behavior: 'fill'` serializa una respuesta legible y la coloca en el composer, sin enviarla.
6. `behavior: 'submit'` valida campos requeridos, prepara la respuesta estructurada en el composer y deja el envío bajo confirmación explícita del usuario.
7. Tras una acción válida, la tarjeta conserva el estado visual de respondida y evita duplicar envíos accidentales.
8. Si el mensaje está en streaming, la tarjeta solo se activa cuando el bloque queda completo y validado; durante el streaming se muestra un placeholder seguro o texto neutro.

## Integración

- Extender el contrato `AssistantBlock` y la conversión de `ContentBlock` para reconocer `ui-card`.
- Extender `PartialAccumulator` y `emptyAssistantBlock` de forma conservadora; un tipo no reconocido seguirá cayendo a `other`.
- Crear `UiCard` y su hoja de estilos en `packages/client/ui-conversation/src/client/chat/`.
- Añadir el callback de preparación de borrador al owner de chat, conectado al controlador de conversación y al estado del composer.
- Mantener `MarkdownText` sin HTML crudo y sin cambios de seguridad.
- Mantener el fallback `JsonBlock` para bloques desconocidos o inválidos.
- No modificar la experiencia actual de imágenes, herramientas, razonamiento, historial ni trayectorias.

## Seguridad y privacidad

- La tarjeta solo puede usar los tipos de campo cerrados del contrato.
- No se ejecutan eventos provenientes del modelo, atributos HTML arbitrarios ni URLs remotas.
- El texto introducido por el usuario se trata como texto literal y se serializa con escape normal del composer.
- Los formularios clínicos deben mostrar una nota de uso: plantilla de apoyo, no diagnóstico, consentimiento ni protocolo de emergencia.
- El estado de edición no se guarda hasta que el usuario envía el mensaje de forma explícita.

## Accesibilidad y diseño visual

- Usar `fieldset`/`legend` cuando corresponda, labels asociados y mensajes de error con `aria-describedby`.
- Mantener foco visible, orden de tabulación natural y soporte de `Enter`/`Space` en botones.
- Estética base: tarjeta blanca, borde suave, radio moderado, jerarquía tipográfica clara, fondo neutro y acentos discretos; debe integrarse con las filas existentes del chat y adaptarse a móvil.
- No depender solo del color para comunicar selección, error o estado enviado.

## Pruebas

### Unitarias

- Clasificación de `ui-card` en `toAssistantBlock`.
- Acumulación segura de bloque completo y desconocido en `PartialAccumulator`.
- Rechazo de ids duplicados, campos inválidos, rangos inválidos y acciones vacías.
- Serialización estable de valores y escape de texto.

### Componentes

- Render de título, descripción y cada tipo de campo.
- Selección por teclado y con click.
- Errores de requeridos y rangos.
- `fill` actualiza el composer sin enviar.
- `submit` valida y llama una sola vez al callback de preparación.
- Bloque inválido cae a JSON sin ejecutar HTML.
- Streaming no habilita controles antes de finalizar el bloque.

### E2E web

- Un mensaje de asistente con `ui-card` aparece dentro del chat, sin nueva pestaña.
- Una tarjeta de opciones permite seleccionar y preparar una respuesta.
- Un formulario de seguimiento psicológico se puede completar, validar y dejar listo para enviar.
- El historial conserva la tarjeta sin romper Markdown, herramientas ni imágenes.
- El build web y la URL existente `http://127.0.0.1:3080` verifican la versión tras refresh.

## Fuera de alcance

- HTML libre, iframes, scripts, componentes remotos o CSS enviado por el modelo.
- Persistencia de respuestas de tarjetas fuera del mensaje enviado.
- Automatización clínica, diagnóstico, puntuación psicométrica o alertas médicas.
- Editor visual de tarjetas para usuarios finales.
