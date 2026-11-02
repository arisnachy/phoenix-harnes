# Ajuste del wordmark PHOENIX en el lateral

English | [中文](2026-03-10-sidebar-phoenix-wordmark-design.zh.md)

## Objetivo
Hacer que la palabra `PHOENIX` del logo lateral tenga una presentación horizontal y compacta, inspirada en la referencia de ChatGPT: sans-serif limpia, oscura, seminegrita y sin espaciado amplio entre letras.

## Alcance
- Cambiar únicamente la instancia del wordmark dentro del panel lateral.
- Mantener sin cambios el logo de bienvenida/hero.
- Mantener el emblema, sus dimensiones, el espaciado entre emblema y nombre, la accesibilidad y el comportamiento del botón.

## Diseño
El contenedor `.brandName` del sidebar conservará su estructura actual, pero usará la tipografía sans-serif de la interfaz, color primario, peso 600 y `letter-spacing` ligeramente negativo para lograr una palabra más compacta. El tamaño seguirá siendo proporcional al emblema actual y se mantendrá en una sola línea.

La implementación será un ajuste CSS localizado en `packages/client/ui-sidebar/src/client/SidebarRoot.module.css`; no se modificará `PhoenixBrandName`, porque ese componente también alimenta el hero.

## Validación
- Ejecutar la prueba focal del branding/sidebar.
- Construir el frontend web.
- Verificar `http://127.0.0.1:3080` tras recargar.
- Confirmar en escritorio y, si es posible, en un viewport móvil que el nombre no se corte ni se desborde.
