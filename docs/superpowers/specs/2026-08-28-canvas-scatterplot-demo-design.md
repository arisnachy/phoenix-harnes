# Diseño: demo Canvas2D de 100.000 puntos

## Objetivo

Crear una demo autónoma y visible de la skill `codex-build-web-data-visualization-canvas2d-data-visualization`, sin modificar la conversación principal ni los archivos `SKILL.md`.

## Superficie

- Archivo: `apps/web/public/demos/canvas-scatterplot.html`
- URL esperada: `http://127.0.0.1:3080/demos/canvas-scatterplot.html`
- La página será un recurso estático servido por el mismo host de PHOENIX.

## Comportamiento

- Renderizar exactamente 100.000 puntos deterministas en Canvas2D.
- Ajustar el backing store a `devicePixelRatio` y dibujar en píxeles CSS.
- Usar un modelo retenido de puntos y una transformación mundo-pantalla explícita.
- Zoom con rueda centrado en el puntero.
- Paneo con arrastre de puntero y alternativa de teclado.
- Botón `Reiniciar vista` para restaurar transformación y selección.
- Tooltip al pasar o enfocar un punto, con coordenadas y grupo.
- Punto enfocado navegable mediante teclado y anunciado por una región `aria-live`.
- Fallback textual con conteo, dominios y controles disponibles.
- Métricas visibles de puntos, zoom y FPS aproximados.

## Seguridad y límites

- Sin red, dependencias externas ni datos aleatorios no deterministas.
- El Canvas será decorativo para el árbol accesible; los controles HTML y el resumen proporcionarán la semántica operable.
- Las interacciones no deben secuestrar el scroll fuera del lienzo.

## Verificación

1. Test unitario del generador determinista y límites.
2. Test de interacción con Playwright: carga, 100.000 puntos, zoom, paneo, reinicio, tooltip y teclado.
3. Build de `apps/web`.
4. Navegación y captura en la URL existente de PHOENIX.
