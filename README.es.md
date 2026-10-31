<p align="center">
  <img src="apps/web/public/phoenix-emblem.png" alt="PHOENIX — Espacio de trabajo cognitivo de IA" width="300">
</p>

# PHOENIX

[English](README.md) | Español | [中文](README.zh.md)

**PHOENIX es un espacio de trabajo cognitivo de inteligencia artificial, centrado en la ejecución local: un entorno para razonar, coordinar, actuar, verificar y recuperarse mediante distintos modelos, herramientas y proyectos.**

**Kira** constituye el centro de coordinación de la experiencia. PHOENIX está diseñado para conectar los objetivos de cada persona con agentes especializados y herramientas, mantener el contexto, mostrar evidencias del trabajo realmente realizado y conservar el control humano. Su identidad **no depende de un modelo, proveedor ni proyecto anterior**.

> **Una misión. La inteligencia adecuada. Ejecución verificable.**

## ¿Qué distingue a PHOENIX?

| Pilar | Qué significa |
| --- | --- |
| **Kira y agentes coordinados** | Un asistente principal organiza el trabajo, delega tareas en especialistas y distingue los informes dirigidos al usuario de la comunicación interna del equipo. |
| **Libertad para elegir modelos** | Adaptadores independientes del proveedor y selección de modelos; se documentan OpenRouter y la conexión nativa opcional con ChatGPT / Codex. |
| **Continuidad desde el diseño** | El historial local, los eventos reproducibles y los puntos de control permiten retomar y auditar trabajos. La memoria cognitiva más amplia continúa en desarrollo. |
| **Herramientas reales y resultados comprobables** | Las integraciones con herramientas, navegador y sistema de archivos, sus permisos y las evidencias de ejecución forman parte del flujo de trabajo; no se simulan acciones. |
| **Un espacio de trabajo, no solo un chat** | Interfaz web, opciones de ejecución en Windows, integración con entornos de desarrollo y arquitectura modular de complementos. |
| **Recuperación ante fallos** | Publicaciones controladas, comprobaciones previas aisladas, puntos de recuperación y reversión para reducir el riesgo de inutilizar una instalación funcional. |

## Áreas de trabajo especializadas

PHOENIX se amplía progresivamente hacia la **investigación científica y la publicación de documentos**, los **copilotos clínicos**, el **análisis de mercados y el trading**, la **inteligencia deportiva**, las **operaciones empresariales** y las **automatizaciones programadas**.

Estas son líneas de desarrollo: **no significan** que todas sus funciones estén instaladas, sean aptas para producción, actúen de manera autónoma o cuenten con autorización para operar en sistemas reales. Cada integración debe superar sus propias comprobaciones operativas y de seguridad.

## Estado del desarrollo

PHOENIX es un producto en desarrollo activo con **identidad, arquitectura, hoja de ruta y dirección propias**. Las funcionalidades se incorporan gradualmente. Un documento de diseño o una solicitud de integración abierta no demuestra que una función esté operativa en `main` o `stable`.

Por compatibilidad, algunos identificadores internos de paquetes y de línea de comandos se mantienen temporalmente. Son detalles técnicos, no elementos de la marca PHOENIX. Cualquier sustitución debe preservar las instalaciones y los flujos de trabajo existentes.

Consulta la [arquitectura](docs/architecture.md), la [guía de desarrollo](docs/development.md) y las [interfaces de capacidades](docs/capability-seams.md) para conocer los mecanismos y sus criterios de verificación.

## Instalación y ejecución

### Instalación de Windows con un solo comando

Abre PowerShell y ejecuta:

```powershell
irm https://raw.githubusercontent.com/arisnachy/phoenix-harnes/main/install-phoenix.ps1 | iex
```

El instalador prepara Node.js y Git mediante `winget` cuando faltan, clona o actualiza la instalación específica de PHOENIX, instala dependencias de forma reproducible, compila el proyecto y crea accesos directos **PHOENIX HARDNESS** en el menú Inicio, el inicio automático de Windows y el almacén de accesos directos de la barra de tareas.

En las versiones de Windows sin una acción compatible para anclar el acceso directo, se crea uno preparado para que puedas anclarlo manualmente. Los parámetros `-NoStartup` y `-NoTaskbar` permiten omitir estas opciones.

Las instalaciones administradas comprueban `stable` al arrancar y solo aplican actualizaciones que superen las comprobaciones previas. Una instalación administrada limpia puede reemplazar un historial anterior no relacionado, conservando una referencia de recuperación. Usa `PHOENIX_AUTO_UPDATE=0` para desactivar la comprobación. No se sobrescriben los cambios locales.

El instalador no es un paquete MSIX firmado. La firma del código permanece pendiente hasta configurar un certificado de publicación válido.

### Integración con VS Code y Cursor

Genera la extensión instalable:

```powershell
pnpm --dir apps/vscode run package:vsix
```

Después instala `dist/phoenix-hardness-vscode.vsix` desde **Extensiones → Instalar desde VSIX**. Su panel del Explorador inicia el entorno local de PHOENIX y abre la interfaz web sin consultar las credenciales de los modelos.

### Ejecución desde el código fuente

Instala Node.js 22.19 o una versión posterior y ejecuta:

```powershell
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
.\phoenix-windows.cmd
```

`phoenix-windows.cmd` accede automáticamente al directorio del repositorio, utiliza Corepack incluido en Node.js para preparar las dependencias, compila PHOENIX cuando hace falta e inicia la interfaz web local. No necesitas instalar `pnpm` globalmente.

### Actualizaciones automáticas del canal estable

Las instalaciones desde el código fuente siguen el canal `stable`. Una revisión nueva de `main` solo se publica para los clientes después de que su integración continua (CI) haya concluido satisfactoriamente. Las instalaciones activas detectan la nueva versión estable y, de forma predeterminada, la instalan después de cerrar la sesión activa de PHOENIX. Windows también comprueba el canal estable antes de un nuevo inicio.

La instalación automática requiere el repositorio de origen oficial, una rama `main` o `stable`, un directorio de trabajo limpio, una compilación previa aislada satisfactoria y un punto de recuperación. Si hay modificaciones locales, se puede preparar y verificar una versión candidata sin sobrescribir ni activar cambios sobre el directorio modificado.

Las actualizaciones de avance directo utilizan `git merge --ff-only`. Cuando una instalación administrada tiene un historial heredado no relacionado, se permite un `git reset --hard` protegido y condicionado a la verificación previa. Una actualización fallida revierte a la revisión funcional anterior. Las ramas de desarrollo y los directorios con cambios locales nunca se sobrescriben automáticamente. El actualizador tampoco modifica los datos, credenciales, sesiones, memorias ni proyectos del usuario.

Configura `PHOENIX_UPDATE_MODE=notify` para recibir avisos sin instalación automática o `PHOENIX_UPDATE_MODE=off` para desactivar las comprobaciones. Consulta [Actualización automática de PHOENIX](docs/evolution/PHOENIX_AUTO_UPDATE.md) para los criterios de publicación, recuperación y confianza.

Las actualizaciones de complementos de Codex y habilidades de OpenClaw se realizan a través del [proceso de incorporación aislada de componentes externos](docs/evolution/PHOENIX_UPSTREAM_INTAKE.md), que prepara y verifica cada candidato antes de modificar los conectores inicializados.

### Configurar OpenRouter en Windows

PHOENIX selecciona inicialmente la ruta de modelos `openrouter/free`. Crea una [clave de API de OpenRouter](https://openrouter.ai/settings/keys) y configúrala en PHOENIX:

1. Abre **Configuración → Modelos → OpenRouter**.
2. Pega la clave y guárdala. Se almacena en el depósito local de credenciales de PHOENIX; no se envía al repositorio Git.
3. Usa el selector de modelos del cuadro de conversación para cambiar `openrouter/free` por otro modelo disponible.

El proveedor, su clave, el endpoint, el catálogo y el modelo activo se administran desde la interfaz web. Los modelos gratuitos sirven para pruebas y están sujetos a disponibilidad y límites de uso de OpenRouter.

### Conectar ChatGPT / Codex

PHOENIX mantiene separadas la autenticación mediante clave de API de OpenAI y la autenticación de una suscripción ChatGPT. El puente nativo con Codex utiliza el inicio de sesión oficial administrado por Codex app-server. Es Codex quien gestiona la persistencia de OAuth y la renovación de los tokens; PHOENIX no solicita contraseñas de ChatGPT ni analiza, copia o almacena sus tokens OAuth.

Cuando está disponible el puente nativo, **Configuración → Modelos → Conexiones de cuenta** permite iniciar sesión en **ChatGPT / Codex**. Esta integración también puede consultar el plan activo, las ventanas de límites de uso de Codex, sus tiempos de restablecimiento y la actividad de tokens de la cuenta, sin pasar la suscripción por el adaptador OAuth genérico de `pi-ai`.

## Comunidad y soporte

Utiliza [Issues](https://github.com/arisnachy/phoenix-harnes/issues) para informar de errores o proponer mejoras y [Discussions](https://github.com/arisnachy/phoenix-harnes/discussions) para consultas, ideas y conversaciones sobre PHOENIX.

## Contribuciones

Consulta [CONTRIBUTING.md](CONTRIBUTING.md).

## Desarrollo

Empieza por la [guía de desarrollo](docs/development.md) y la [documentación de arquitectura](docs/architecture.md). Las nuevas capacidades se integran en fases y mediante ramas y solicitudes de cambios con verificaciones independientes, para mantener auditable la base estable.

La [guía de PHOENIX para Windows](docs/phoenix-windows.md) explica la instalación, el empaquetado de extensiones, los límites del entorno aislado nativo y la continuidad.

Si trabajas con agentes, sigue [AGENTS.md](AGENTS.md).

## Componentes de código abierto y atribuciones

PHOENIX tiene identidad de producto y dirección de desarrollo propias. El repositorio incorpora también componentes de código abierto creados por terceros. Su autoría, licencias, procedencia del código incorporado y modificaciones locales están documentadas en [LICENSE](LICENSE), el [registro de componentes incorporados](vendor/README.md) y [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Reconocer el origen de determinados componentes **no convierte a PHOENIX en un cambio de marca ni en la evolución de otro producto**.

## Licencia

[MIT](LICENSE).

Las dependencias de terceros y sus respectivas licencias se detallan en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
