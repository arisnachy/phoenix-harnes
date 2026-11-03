---
name: blender-studio
description: >-
  Use when a user asks for a detailed interactive 3D model, sculpted character, Blender scene,
  rigging, mesh, materials, animation, or deliverable .blend/.glb/.gltf. Prefer genuine Blender
  creation when requested fidelity exceeds a low-poly blockout.
---

# Blender Studio: ejecución real de modelos 3D

Esta habilidad está disponible en la composición estándar de PHOENIX mediante `skill-filesystem` y `tool-skill`. No indica por sí misma que Blender o su MCP estén conectados.

## Reconocer la petición y elegir la herramienta

Cuando la persona pide un personaje detallado con giro y zoom, crear **geometría tridimensional editable**; un PNG no satisface ese objetivo. Usa la herramienta MCP de **Blender Lab oficial** si el catálogo de herramientas del turno contiene `mcp__blender__*` con capacidad ejecutable. Si no aparece, consulta el catálogo real de conectores y el estado MCP, y busca la tarjeta `Blender Lab · 3D real` en Settings → Conectores. Nunca concluyas que Blender no existe en PHOENIX basándote únicamente en la ausencia de una herramienta en una sesión.

Antes de afirmar que Blender o uvx no están instalados, ejecuta una vez `node scripts/phoenix-blender-diagnose.mjs` desde el checkout de PHOENIX cuando dispongas de terminal. Es un diagnóstico de solo lectura que busca Blender, uvx y el puerto local del complemento; un puerto abierto por sí solo no demuestra disponibilidad de herramientas MCP. No repitas el diagnóstico sin un cambio de estado.

El conector se instala de forma explícita desde Settings, servidor `blender`, código oficial fijado en el catálogo de PHOENIX. Requiere `uvx`, Blender 5.1+ y el add-on de Blender Lab habilitado y escuchando en `localhost:9876`. **Instalar el MCP no instala Blender** ni inicia necesariamente el add-on. Si está instalado y las herramientas no aparecen, comprueba las fases `starting`, `disconnected`, `failed`, los nombres de herramientas exportadas, y prueba una reconexión una vez; comunica qué dependencia falta.

Si Blender está instalado en el host pero no está disponible su MCP, considera la ruta CLI offline `scripts/phoenix-3d-studio.py` para escenas adecuadas: genera archivos .blend, .glb y previsualización según la capacidad real del script. No afirmes haberla ejecutado sin evidencia de comandos y archivos reales. Un visor `phoenix_3d` de primitivas sirve exclusivamente para prototipo explícitamente low-poly; una figura de bloques no cumple una solicitud de personaje detallado.

## Entrega con calidad demostrable

1. Determina requisitos identificables: silueta, cabeza, proporciones, traje, materiales, manos, cabello, ojos, accesorios, malla orgánica y posibilidad de orbitar. Para un personaje conocido, sigue la descripción solicitada sin sustituir detalles por formas genéricas.
2. Construye una escena real y conserva el proyecto fuente .blend. Exporta .glb/.gltf con malla, materiales y jerarquía; incluye rig/animaciones si se pidieron y la herramienta los ejecutó.
3. Valida que el archivo exista, que tenga geometría no vacía y que pueda abrirse/importarse. Comprueba vista frontal, lateral, posterior y articulaciones relevantes antes de entregar. Distingue un primer prototipo de una versión terminada.
4. Entrega el artefacto real y una vista manipulable cuando el visor admita importarlo. Informa limitaciones observadas sin afirmar que se produjo algo que no existe.
5. Evita repetir las mismas pruebas o solicitar una segunda auditoría si los archivos no cambiaron. Si falla una dependencia, explica el paso preciso y detén los reintentos inútiles.

## Seguridad

El MCP oficial ejecuta Python generado por el modelo dentro de Blender sin aislamiento de seguridad. Actívalo solo a petición del usuario, mantén copias de las escenas originales, limita el acceso a secretos y no ejecutes código no confiable sin autorización adecuada. La aplicación Blender y su complemento se instalan por un proceso separado del registro MCP.

Referencia oficial: https://www.blender.org/lab/mcp-server/
