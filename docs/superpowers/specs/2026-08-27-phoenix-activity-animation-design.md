# Animación de actividad PHOENIX azul-dorada

## Objetivo

Mejorar el indicador visual mostrado mientras PHOENIX trabaja para que el logotipo permanezca nítido, la animación sea coherente con el azul de la interfaz y el naranja identitario del Fénix, y el movimiento resulte elegante durante ejecuciones largas.

## Diseño aprobado

- Aumentar el logotipo activo de 24 px a 28 px.
- Sustituir el halo radial rojo/naranja difuso por un aro orbital fino con degradado azul, violeta y dorado.
- Mantener un resplandor interior naranja controlado que no cubra el logotipo.
- Usar rotación lenta, aproximadamente 2,4 segundos por vuelta, y una respiración suave sin escalados bruscos.
- Pausar ligeramente el shimmer azul del texto para que no compita con el icono.
- Sustituir el rebote final grande por un destello breve azul-dorado.
- En `prefers-reduced-motion`, conservar una composición estática sin rotación ni pulso.

## Archivos

- `packages/client/ui-conversation/src/client/chat/ChatView.tsx`
- `packages/client/ui-conversation/src/client/chat/ChatView.module.css`
- pruebas focales bajo `packages/client/ui-conversation/tests/`

## Verificación

- Pruebas focales de `ui-conversation`.
- Compilación de los artefactos web afectados.
- Refresco de la GUI existente en `http://127.0.0.1:3080/`, sin iniciar otro servidor.
- Inspección visual, consola y captura de evidencia.
- Confirmación de que `prefers-reduced-motion` elimina las animaciones.

## Criterios de aceptación

- El Fénix se distingue con claridad en todo momento.
- El indicador combina visualmente con el texto azul y conserva el acento naranja.
- No existe una mancha roja dominante alrededor del icono.
- El movimiento es suave y no distrae durante ejecuciones largas.
- La versión de movimiento reducido permanece legible y estable.
