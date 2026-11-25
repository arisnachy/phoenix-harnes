<p align="center"><img src="apps/web/public/phoenix-emblem.png" alt="PHOENIX" width="180"></p>

# PHOENIX AI Harness

[English](README.md) | Español | [中文](README.zh.md)

**Un espacio de IA de código abierto. Una experiencia, múltiples modelos.**

PHOENIX es un espacio de trabajo de agentes de IA de propósito general, orientado a la ejecución local, creado y liderado por el **Dr. Arisnachy Gómez Díaz** desde República Dominicana. Kira integra conversación, herramientas, modelos, especialistas y artefactos de trabajo en un mismo entorno. Elige el motor adecuado sin reconstruir tu flujo de trabajo alrededor de un proveedor.

**Tus modelos. Tu espacio. Tu IA.**

[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE) [![GitHub stars](https://img.shields.io/github/stars/arisnachy/phoenix-harnes?style=flat)](https://github.com/arisnachy/phoenix-harnes/stargazers) [![GitHub release](https://img.shields.io/github/v/release/arisnachy/phoenix-harnes)](https://github.com/arisnachy/phoenix-harnes/releases) [![GitHub downloads](https://img.shields.io/github/downloads/arisnachy/phoenix-harnes/total)](https://github.com/arisnachy/phoenix-harnes/releases)

[Empezar](#run) · [Versiones Windows](https://github.com/arisnachy/phoenix-harnes/releases) · [Comunidad](https://github.com/arisnachy/phoenix-harnes/discussions) · [Reportar problemas](https://github.com/arisnachy/phoenix-harnes/issues)

[![Descargar PHOENIX para Windows](https://img.shields.io/badge/PHOENIX-Windows%20Download-B58B35?style=for-the-badge&logo=github)](https://github.com/arisnachy/phoenix-harnes/releases/latest)

**[Descargar PHOENIX para Windows](https://github.com/arisnachy/phoenix-harnes/releases/latest)** · [Sitio oficial](https://arisnachy.github.io/phoenix-harnes/) · [Revisar script de instalación](https://github.com/arisnachy/phoenix-harnes/blob/main/install-phoenix.ps1)

Consulta la última versión publicada y sus notas antes de instalar. Para instalar desde el código fuente, consulta la sección Run. El software es gratuito bajo MIT; los servicios de modelos opcionales pueden tener costos. La firma de código de Windows sigue pendiente.

**¿Te resulta útil PHOENIX?** [Dale una estrella en GitHub](https://github.com/arisnachy/phoenix-harnes) para seguir su desarrollo y ayudar a otros usuarios a descubrirlo. [Comparte tus comentarios o reporta problemas](https://github.com/arisnachy/phoenix-harnes/issues) después de probarlo.

## Prueba PHOENIX con una tarea real

1. [Descarga la última versión publicada para Windows](https://github.com/arisnachy/phoenix-harnes/releases/latest) o [ejecuta desde el código fuente](#run).
2. En **Settings → Models**, configura un modelo local o en la nube disponible. Los límites gratuitos y requisitos de hardware varían.
3. Inicia una conversación con Kira y prueba una de estas solicitudes:

| Tu objetivo | Ejemplo de solicitud |
| --- | --- |
| Comprender un repositorio | Inspecciona este repositorio, explica su arquitectura y sugiere una pequeña mejora con un plan de pruebas. |
| Analizar datos | Revisa este CSV, identifica valores faltantes, resume los resultados y propón un gráfico. |
| Investigar un tema | Compara tres enfoques para este problema, cita las fuentes y señala las afirmaciones inciertas. |
| Probar IA local | Utiliza mi modelo local configurado para resumir este documento de ejemplo. Indica si alguna herramienta o capacidad no está disponible. |

Empieza con datos de ejemplo no sensibles y revisa los permisos antes de aprobar cambios. Son flujos sugeridos, no resultados de pruebas de rendimiento ni garantías; su disponibilidad depende de la versión y el modelo.

**Ayuda a mejorar PHOENIX:** [cuéntanos cómo fue tu primera experiencia](https://github.com/arisnachy/phoenix-harnes/issues/new/choose), incluyendo la versión, modelo/proveedor y qué funcionó o falló. Elimina credenciales y datos privados antes de publicar. Si PHOENIX te resulta útil, [dale una estrella](https://github.com/arisnachy/phoenix-harnes) o compártelo con alguien que pueda aprovecharlo.

## Qué puedes hacer

| Capacidad | Qué ofrece PHOENIX |
| --- | --- |
| Kira y Living Team | Identidad persistente, colaboración con especialistas, actividad visible, respuestas y delegaciones en sesiones compatibles. |
| Libertad de modelos | Proveedores compatibles, credenciales API, conexión oficial ChatGPT/Codex cuando esté disponible, Ollama e inferencia local administrada. |
| Espacio adaptativo | Interfaz conversacional con superficies contextuales, MiniBrowser, formularios y vistas de artefactos; distribución y sincronización en evolución. |
| Documentos y datos | Trabajo con archivos, hojas de cálculo, datos estructurados, informes y artefactos generados; la compatibilidad varía por formato y editor. |
| Investigación y análisis | Descubrimiento de fuentes por dominio, investigación con citas, análisis de datos e informes; verificar fuentes y datos en vivo. |
| Desarrollo de software | Inspección de repositorios, edición de código, terminal, herramientas, pruebas y flujos Git compatibles bajo permisos configurados. |
| Memoria y continuidad | Historial persistente de sesiones, contexto y mecanismos de recuperación según el runtime instalado. |
| Healthia | Entorno clínico en desarrollo por etapas: expedientes, formularios de consulta y documentación; requiere revisión profesional. |
| Inteligencia deportiva | Investigación de datos deportivos y verificación de fuentes; cobertura y disponibilidad en vivo variables. |
| Evolución e inteligencia adaptativa | Evaluación, recuperación, selección de especialistas y experimentos de mejora acotada; sin afirmar autoentrenamiento autónomo ni rendimiento garantizado. |

## Cómo funciona PHOENIX

```mermaid
flowchart TD
    U["Usuario"] --> K["Kira · coordinadora"]
    K --> M["Modelos"]
    K --> S["Especialistas"]
    K --> T["Herramientas y permisos"]
    K <--> W["Espacio adaptativo"]
    K <--> H["Historial de sesiones"]
    M --> L["Modelos locales"]
    M --> C["Proveedores en nube"]
    T --> R["Investigación"]
    T --> D["Código y automatización"]
    T --> F["Documentos y datos"]
    T --> P["Módulos clínicos y deportivos"]
    W --> A["Artefactos y resultados"]
    classDef core fill:#3c2a19,color:#fff,stroke:#f0a649,stroke-width:2px
    class K core
```

## De una solicitud a un resultado

```mermaid
flowchart LR
    A["Solicitud"] --> B["Planificar y elegir"] --> C["Ejecutar"] --> D{"Verificar"} --> E["Entregar"]
    D --> F["Recuperar o ajustar"] --> B
```

## Estado del desarrollo

PHOENIX está en desarrollo activo. Los diagramas representan su arquitectura de producto, no capturas de pantalla ni certificaciones. Se incluyen componentes disponibles e integraciones en evolución; cada flujo depende de la versión, proveedor, hardware, permisos y pruebas. Healthia no se presenta como dispositivo médico certificado y el análisis deportivo no garantiza resultados. Consulta documentación y notas de versión para conocer las limitaciones.

### Documentación técnica

[Kira Teams](packages/client/ui-kira-teams/README.md) · [Contextual UI](docs/product/PHOENIX_UNIVERSAL_CONTEXTUAL_UI.md) · [Universal Intelligence](docs/phoenix-universal-intelligence-3.0.md) · [Healthia](docs/healthia-chat-first-intake-architecture.md) · [Research Studio](docs/phoenix-research-studio-2.1.md) · [Sports](docs/sports/SPORTS_SOURCE_VERIFICATION.md) · [Evolution](docs/evolution/PHOENIX_EVOLUTION_V16.md)

## Run

### Windows

Consulta [las versiones publicadas](https://github.com/arisnachy/phoenix-harnes/releases) y [la guía de instalación completa](README.md#run). Revisa los requisitos y la firma del instalador antes de ejecutarlo. Para instalar desde código fuente, utiliza Node.js 22.19 o superior:

```powershell
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
.\phoenix-windows.cmd
```

Configura tus modelos en Settings → Models. Las credenciales API y el acceso oficial ChatGPT/Codex son rutas distintas. Las actualizaciones siguen el canal estable y sus controles de compilación. Consulta [la guía de Windows](docs/phoenix-windows.md) y [actualización estable](docs/evolution/PHOENIX_AUTO_UPDATE.md).

## Comunidad y desarrollo

[Contribuir](CONTRIBUTING.md) · [Arquitectura](docs/architecture.md) · [Guía de desarrollo](docs/development.md).

## Licencia y atribución de terceros

PHOENIX es la identidad del producto. Los avisos de derechos de autor existentes, incluidos los del código heredado y los componentes incorporados, se conservan en [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) y [vendor/README.md](vendor/README.md). No se reclama autoría de código de terceros.
