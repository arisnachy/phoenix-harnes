# Diseño del informe técnico de PHOENIX

## Objetivo

Crear un informe PDF de 5 páginas, en español, dirigido a lectores técnicos, que explique el uso de PHOENIX, su arquitectura, sus controles de confianza y su operación sin presentar capacidades en desarrollo como finalizadas.

## Dirección visual

El documento usará un estilo blanco institucional: fondo claro, azul petróleo para estructura, ámbar como acento y gris pizarra para texto secundario. La tipografía será sobria, con jerarquía editorial clara, márgenes amplios, tarjetas de información y diagramas vectoriales legibles en pantalla e impresión.

La portada tendrá el nombre PHOENIX, el subtítulo “Uso, arquitectura y controles operativos”, la fecha del informe y una síntesis breve. No usará materiales de marca de DeepSeek que puedan sugerir respaldo oficial; describirá a PHOENIX como evolución downstream compatible con su fundación cuando corresponda.

## Estructura editorial

1. **Portada y tesis.** Identidad del producto, propósito, audiencia y tres mensajes principales.
2. **Uso real.** Qué resuelve PHOENIX, cómo se configura, cómo se ejecuta una sesión y qué capacidades recibe el usuario.
3. **Arquitectura.** Cordis como composición de plugins; perfiles y bundles; paquetes núcleo; eventos durables y puntos de extensión; capability seams.
4. **Confianza técnica.** Credenciales separadas, límites de sandbox en Windows, continuidad local, política de actualización, recuperación y límites conocidos.
5. **Operación y estado.** Instalación, proveedores/modelos, comandos de desarrollo, CI y pruebas relevantes, estado activo, riesgos y próximos pasos.

## Visuales y mini-briefs

### Diagrama de composición

- **Propósito:** mostrar cómo el perfil apila bundles y parches para formar el runtime.
- **Datos:** perfil, bundles, parche del perfil, parche del home y overlay.
- **Codificación:** capas horizontales con flechas de composición.
- **Fallback:** lista textual equivalente junto al diagrama.
- **Accesibilidad:** texto alternativo que enumera el orden y la responsabilidad de cada capa.
- **QA:** comprobar que los nombres coincidan con `docs/architecture.md`.

### Flujo de sesión

- **Propósito:** explicar una ejecución desde la entrada del usuario hasta los eventos durables.
- **Datos:** turn/start, claim, agent/pre-step, step/start, agent/request, llm/stream, tool/call, tool pipeline, step/end y turn/end.
- **Codificación:** flujo horizontal numerado con dos zonas: puntos vivos y eventos durables.
- **Fallback:** secuencia textual accesible.
- **Accesibilidad:** etiquetar cada nodo por nombre exacto y explicar que el registro de sesión permite reconstrucción.
- **QA:** verificar el flujo contra `docs/architecture.md` y no añadir pasos no documentados.

### Matriz de controles

- **Propósito:** separar protección disponible, evidencia local y límite explícito.
- **Filas:** credenciales, sesión local, sandbox Windows, actualización automática, recuperación y telemetría.
- **Codificación:** tabla con columnas “control”, “qué protege”, “evidencia” y “límite”.
- **QA:** comprobar que `danger-full-access` no se describa como sandbox y que la continuidad cloud futura se marque como no anunciada hasta tener recibo y restauración verificables.

### Tarjetas operativas

- **Propósito:** resumir modelos/proveedores, instalación, IDE, pruebas y soporte.
- **Datos:** rutas OpenRouter y ChatGPT/Codex, Node/pnpm, comandos de build/typecheck, CI y canales de soporte.
- **Codificación:** tarjetas compactas con un comando o enlace por tarjeta.
- **QA:** todos los comandos deben coincidir con README y guía de desarrollo.

## Fuentes y tratamiento editorial

Las fuentes primarias serán `README.md`, `docs/architecture.md`, `docs/development.md`, `docs/phoenix-windows.md`, `SECURITY.md`, `AGENTS.md` y `package.json`. Se podrá citar la URL pública del repositorio como referencia externa. Cada página incluirá una nota de fuente corta y el PDF incorporará metadatos de título, autor del documento y tema.

El texto distinguirá explícitamente entre capacidades descritas como disponibles, trabajo activo, controles condicionados por plataforma y límites conocidos. El informe será descriptivo del estado observado en el checkout, no una promesa de roadmap.

## Generación

La fuente reproducible será un HTML semántico con CSS de impresión y SVG inline para los diagramas. El HTML se convertirá a PDF con un motor de navegador disponible en el checkout. Los SVG se mantendrán como fuentes editables dentro del generador y el PDF se escribirá en una carpeta de salida dedicada a informes.

El generador no modificará el runtime de PHOENIX ni sus paquetes. Los archivos de salida y fuentes del informe quedarán separados del código de producto y no incluirán credenciales ni datos personales.

## Validación

- Verificar que el PDF exista, sea legible y tenga exactamente 5 páginas.
- Extraer texto para comprobar título, secciones, comandos, fuentes y ausencia de marcadores incompletos.
- Renderizar cada página a imagen y revisar portada, saltos de página, diagramas, tablas, contraste, alineación y texto cortado.
- Comprobar que los diagramas tengan fallback textual y que los enlaces relevantes sean válidos.
- Comparar las afirmaciones críticas con las fuentes primarias antes de presentar el archivo.
- Registrar el nombre y la ruta del PDF validado.

## Envío

Después de la validación, se presentará el PDF al usuario y se solicitará confirmación explícita del asunto, cuerpo y adjunto antes de enviarlo a `arisnachy@gmail.com`. El envío usará Gmail y no se realizará mientras falte esa confirmación. La verificación posterior consistirá en comprobar el mensaje enviado y su adjunto mediante la misma cuenta.

## Fuera de alcance

No se cambiará código de PHOENIX, no se modificarán configuraciones de Gmail, no se reparará la cuenta POP3 de `support@health-ia.com` y no se afirmará que una ejecución de CI está verde si no existe evidencia fresca.
