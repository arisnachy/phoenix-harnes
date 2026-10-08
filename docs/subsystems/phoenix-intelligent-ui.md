# Phoenix Intelligent UI — catálogo y formatos interoperables

Phoenix muestra la UI dentro del **mensaje** de Kira, no en un panel lateral. El único dueño del estado, las acciones y los permisos sigue siendo `GenerativeCanvas` en React 18.

## Capacidades reales

- **Nativo `ui_canvas`**: grupos responsive (column/row/grid), títulos, texto, métricas, badges, barras de progreso, alertas, cronologías, tablas, gráficos de barras, pestañas, inputs, selectores, toggles, sliders y botones. Las tablas permiten filtros y las entradas retienen estado local.
- **assistant-ui**: puente de un *subconjunto* de su árbol declarativo `$type`/`children` (`Card`, `Row`, `Fact`, `Chart`, etc.). No se monta el runtime `@assistant-ui/react-generative-ui` ni se interpretan sus acciones `$action`.
- **Vercel json-render**: puente de un *subconjunto* de su estructura `root`/`elements`/`props`/`children`, sin su renderer `@json-render/react` que requiere React 19. No permite `$state`, `repeat`, `visible`, scripts ni acciones externas.
- **OpenAI Apps SDK UI**: patrón visual de referencia (superficies, espaciado, contraste, accesibilidad y componentes de aspecto nativo del chat). No se incorpora la biblioteca Tailwind 4 en el host React 18. Las vistas conservan los tokens CSS existentes de Phoenix.

El catálogo canónico consumido por el puente está en `packages/client/ui-conversation/src/client/chat/IntelligentUiInterop.ts`. Las instrucciones del perfil `standard` indican a Kira exactamente qué puede presentar y qué no. Evita describir como instaladas bibliotecas que solo tienen compatibilidad parcial.

## Formato recomendado para Kira

Devolver un bloque delimitado `generative-ui` con un único JSON de estructura `ui_canvas`, por ejemplo:

```generative-ui
{
  "component": "ui_canvas",
  "version": 1,
  "props": {
    "title": "Estado MCP",
    "subtitle": "Datos de ejemplo",
    "children": [
      { "type": "group", "layout": "grid", "children": [
        { "type": "metric", "label": "Listos", "value": "5" },
        { "type": "metric", "label": "OAuth", "value": "9" },
        { "type": "metric", "label": "Fallidos", "value": "4" }
      ] },
      { "type": "input", "id": "buscar", "label": "Buscar conector" },
      { "type": "table", "columns": ["Conector", "Estado"], "rows": [
        ["Notion", "OAuth"], ["Canva", "Error"]
      ] },
      { "type": "button", "label": "Actualizar estado", "prompt": "Comprueba el estado real de los MCP", "action": "submit" }
    ]
  }
}
```

Para compatibilidad de entrada con assistant-ui:

```generative-ui
{
  "component": "assistant_ui",
  "version": 1,
  "props": {
    "title": "Indicadores",
    "tree": { "$type": "Card", "title": "MCP", "children": [
      { "$type": "Fact", "label": "Activos", "value": "5" }
    ] }
  }
}
```

Para json-render (solo subconjunto estático):

```generative-ui
{
  "component": "json_render",
  "version": 1,
  "props": {
    "title": "Indicadores",
    "spec": {
      "root": "root",
      "elements": {
        "root": { "type": "Card", "props": { "title": "Conectores" }, "children": ["n"] },
        "n": { "type": "Metric", "props": { "label": "Activos", "value": "5" }, "children": [] }
      }
    }
  }
}
```

## Seguridad y rendimiento

1. El modelo solo puede usar nodos y propiedades aprobados; no se evalúa JavaScript ni HTML arbitrario.
2. Límite de 64 nodos y profundidad 6; referencias cíclicas, tipos desconocidos y propiedades dinámicas se rechazan.
3. Los controles filtran/actualizan localmente sin llamadas al modelo. Un botón nunca ejecuta MCP directamente: solo prepara o envía texto por el compositor **tras un clic del usuario**; la ejecución posterior sigue las autorizaciones normales de Phoenix.
4. La UI se procesa dentro del chat existente, sin nuevos providers globales ni cargas de Tailwind 4 o React 19.
5. Para integrar las tres bibliotecas npm completas en el futuro habrá que evaluar permisos, tamaño de bundle y coste, actualizar `pnpm-lock.yaml` y completar pruebas de React/estilos.

## Verificación

`pnpm exec vitest run packages/client/ui-conversation/tests/generative-canvas.client.spec.tsx`

La integración de los formatos se prueba mediante la ruta real `splitGenerativeUiText` → `parseGenerativeUiBlock` → `GenerativeCanvas`, además de pruebas de inyección, ciclos y componentes desconocidos.
