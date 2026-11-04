<p align="center">
  <img src="apps/web/public/phoenix-emblem.png" alt="PHOENIX" width="300">
</p>

# PHOENIX

[English](README.md) | Español | [中文](README.zh.md)

**PHOENIX es una plataforma propia de agentes de inteligencia artificial, diseñada para trabajar de forma local, conectar distintos modelos y coordinar herramientas y agentes especializados.**

PHOENIX tiene identidad, experiencia de usuario y hoja de ruta propias. Kira actúa como asistente coordinadora: convierte conversaciones en trabajo verificable, selecciona capacidades apropiadas y ayuda a mantener el contexto entre tareas. El proyecto sigue en desarrollo activo; que una función aparezca en la interfaz no significa que ya esté validada para producción.

## La plataforma

- **Kira y equipos de agentes:** coordinación, delegación, ejecución de herramientas e información de progreso para el usuario.
- **Libertad para elegir modelos:** conexión con proveedores remotos o locales compatibles, selección de modelos y gestión de cuentas.
- **Herramientas prácticas:** trabajo con código, repositorios, documentos, navegación e integraciones autorizadas.
- **Continuidad:** sesiones, memoria, objetivos y recuperación para sostener el trabajo más allá de una respuesta aislada.
- **Ejecución controlada:** verificaciones, puntos de recuperación y permisos para limitar fallos silenciosos y cambios inesperados.

## Áreas especializadas

- **Investigación y docencia:** búsqueda de evidencias, análisis estructurado y elaboración académica.
- **Asistencia clínica:** documentación y apoyo a decisiones bajo responsabilidad del profesional sanitario; no sustituye el criterio clínico.
- **Trading y mercados:** datos, evaluación de estrategias y entornos de simulación o prueba, sin prometer ganancias ni ejecución automática garantizada.
- **Deportes y automatización:** análisis deportivo y tareas programadas cuando las fuentes, conexiones y servicios están disponibles.

Cada área tiene distintos niveles de implementación y pruebas. Para tareas críticas, comprueba el módulo correspondiente y sus resultados de CI.

## Instalación

### Instalador para Windows

Abre PowerShell y ejecuta el instalador oficial del repositorio:

```powershell
irm https://raw.githubusercontent.com/arisnachy/phoenix-harnes/main/install-phoenix.ps1 | iex
```

Revisa los scripts antes de ejecutarlos con permisos elevados. El instalador requiere un Windows compatible y puede preparar Node.js, Git, dependencias y accesos directos. Consulta [PHOENIX en Windows](docs/phoenix-windows.md) para más detalles y limitaciones de plataforma.

### Ejecución desde el código fuente

Instala Node.js 22.19 o superior y ejecuta:

```powershell
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
.\phoenix-windows.cmd
```

El iniciador prepara las dependencias y abre la interfaz local. Para esta vía de Windows no necesitas instalar `pnpm` globalmente.

### VS Code y Cursor

Compila la extensión VSIX e instala el archivo generado desde el menú **Extensiones → Instalar desde VSIX**:

```powershell
pnpm --dir apps/vscode run package:vsix
```

Algunos nombres técnicos de paquetes todavía pueden conservar identificadores por compatibilidad; no constituyen el nombre público del producto.

## Conectar modelos

### OpenRouter

PHOENIX permite utilizar la ruta `openrouter/free` cuando está disponible, con los límites del proveedor.

1. Crea una clave en [OpenRouter](https://openrouter.ai/settings/keys).
2. En PHOENIX abre **Configuración → Modelos → OpenRouter** y guarda la clave en su almacén de credenciales.
3. Selecciona un modelo disponible en el selector de la conversación.

### ChatGPT / Codex

Si está instalado y disponible el puente nativo de Codex, se utiliza el inicio de sesión oficial de Codex. La autenticación por suscripción de ChatGPT es distinta de la clave de API de OpenAI. PHOENIX no solicita la contraseña de ChatGPT. La disponibilidad depende del puente y de los permisos de la cuenta.

## Actualizaciones y recuperación

`main` es la rama de desarrollo y `stable` el canal de promoción. Los cambios solo deben pasar al canal estable después de superar las verificaciones correspondientes. Las instalaciones administradas compatibles comprueban actualizaciones validadas y preservan los cambios locales. Consulta el [contrato de actualización y recuperación](docs/evolution/PHOENIX_AUTO_UPDATE.md).

## Documentación y comunidad

- Consulta la [arquitectura](docs/architecture.md) y la [guía de desarrollo](docs/development.md) para conocer el sistema actual.
- Revisa [Cómo contribuir](CONTRIBUTING.md) y las [instrucciones para agentes](AGENTS.md) antes de modificar el código.
- Utiliza [Issues](https://github.com/arisnachy/phoenix-harnes/issues) o [Discussions](https://github.com/arisnachy/phoenix-harnes/discussions) para reportar fallos, sugerir mejoras o solicitar ayuda.

## Identidad, créditos y licencia

**El producto se llama PHOENIX.** Los identificadores conservados en rutas internas, interfaces de consola o artefactos de compilación existen por compatibilidad técnica. PHOENIX no se presenta como un producto de otra empresa ni como un simple cambio de nombre de otro sistema.

El código se distribuye bajo la [licencia MIT](LICENSE), respetando los avisos de derechos de autor existentes. Las dependencias y licencias de terceros figuran por separado en [Avisos de terceros](THIRD_PARTY_NOTICES.md). El reconocimiento legal de autoría no es la descripción del producto.
