# Diseño de la landing promocional de PHOENIX

## Objetivo

Crear una página web promocional moderna y dinámica para usuarios de IA no técnicos. La página debe explicar PHOENIX con lenguaje humano, mostrar una sesión interactiva de ejemplo y llevar al visitante a probar PHOENIX localmente.

## Superficie y alcance

La landing será una superficie promocional separada del shell operativo de `apps/web`. El entrypoint actual de `apps/web/src/main.ts` permanece intacto porque delega al runtime y Vite rechaza servir el shell sin `window.__DSH_BOOT__`. La nueva superficie no modificará el runtime, la autenticación ni las rutas de la aplicación operativa.

La página se implementará como una página estática React/Vite dentro de una superficie web dedicada del checkout, reutilizando solo dependencias ya presentes y sin cargar datos externos ni credenciales.

## Dirección visual

La dirección aprobada es **Local Clarity**: fondo marfil, azul tinta, teal y ámbar fénix; tipografía sans editorial para titulares y mono solo para comandos, estados y métricas. Usará contenedores amplios, bordes finos, radios moderados, sombras suaves y una jerarquía clara. La interfaz evitará el aspecto de dashboard genérico y reservará las tarjetas para agrupaciones semánticas reales.

## Estructura de la página

1. **Navegación.** Wordmark PHOENIX, enlaces a Cómo funciona, Capacidades y Confianza, y CTA “Probar localmente”.
2. **Hero.** Titular “Tu IA. Tu espacio. Tu ritmo.”, explicación breve y CTAs “Probar PHOENIX” y “Ver cómo funciona”. A la derecha, una tarjeta de sesión viva con estado de actividad.
3. **Banda de beneficios.** Local-first, proveedor intercambiable, continuidad y control.
4. **Cómo funciona.** Tres pasos: configurar, conversar y conservar; cada paso conecta con el demo.
5. **Demo interactiva.** Estados Configurar, Conversar y Conservar. Cada estado cambia el texto, el indicador de actividad y la métrica visible sin recarga.
6. **Capacidades.** Grid breve para modelos, herramientas, contexto, extensibilidad y recuperación, descrito sin jerga innecesaria.
7. **Confianza.** Privacidad local, credenciales separadas y límites transparentes; sin promesas absolutas ni métricas inventadas.
8. **CTA final.** Instalación local, comando copiable y enlace a documentación/repositorio.
9. **Footer.** Estado en desarrollo activo, enlaces públicos y atribución downstream cuando aplique.

## Interacciones

- La tarjeta hero muestra un cursor/actividad de sesión con animación de escritura limitada y no infinita.
- El demo usa tres botones nativos con `aria-pressed`; el estado activo cambia descripción, etiqueta y valor mostrado.
- El CTA de instalación copia el comando local y muestra confirmación temporal “Copiado”.
- Los enlaces de navegación hacen scroll suave solo cuando `prefers-reduced-motion` no está activo.
- Las secciones usan `IntersectionObserver` con cleanup para revelar contenido una sola vez.
- El menú móvil usa un botón accesible, `aria-expanded`, foco visible y cierre con Escape.
- Todo el flujo funciona con teclado y tiene estados de foco claros.
- Las animaciones se desactivan o reducen con `prefers-reduced-motion: reduce`.

## Sistema visual

- **Fondos:** marfil `#F7F4EE`, blanco cálido `#FFFDFC`.
- **Texto:** azul tinta `#16324F`, gris pizarra `#607487`.
- **Acentos:** teal `#1E7181`, ámbar `#D88A2B`, verde de confianza `#2D8069`.
- **Tipografía:** sans del sistema o Geist si ya está disponible; mono para comandos y estados.
- **Layout:** contenedor máximo de 1180px, grid fluido, ritmo de 8px, breakpoint principal en 760px.
- **Forma:** bordes de 1px, radios entre 14px y 22px, sombras de baja intensidad, sin gradientes decorativos pesados.
- **Iconos:** SVG inline simples con `aria-hidden="true"` cuando sean decorativos.

## Contenido y claims

La landing comunicará control sin complejidad, continuidad sin perder contexto y elección de proveedor. Se puede afirmar que PHOENIX es local-first, agnóstico de proveedor, extensible por plugins y capaz de conservar sesiones localmente porque está documentado en `README.md` y `docs/architecture.md`.

La página no afirmará que PHOENIX elimina todo riesgo, que el backup cloud está disponible, que el release está firmado o que cualquier gate está verde sin evidencia fresca. Los límites de Windows y `danger-full-access` se expresarán de forma breve y honesta.

## Accesibilidad y rendimiento

Usar HTML semántico (`header`, `nav`, `main`, `section`, `footer`), un único `h1`, botones reales, enlaces reales, etiquetas de estado y foco visible. Mantener contraste AA y no usar color como única señal. La página no necesita imágenes externas; el emblema puede ser SVG/CSS existente. La animación debe ser transform/opacity-first y desactivable. La carga inicial no debe depender de red externa.

## Verificación

- Ejecutar el build de la superficie con Vite.
- Servir la landing en un servidor local dedicado para QA, sin reemplazar el runtime PHOENIX.
- Verificar a 1440px, 1024px y 390px de ancho.
- Comprobar hero, navegación, CTA, estados del demo, copia del comando, menú móvil y enlaces.
- Revisar consola sin errores, foco/teclado, `aria-pressed`, `aria-expanded`, reduced motion y desbordamientos.
- Capturar una evidencia visual de desktop y mobile y revisar que la implementación conserve la composición aprobada.

## Fuera de alcance

No cambiar `apps/web/src/main.ts`, no alterar el shell de runtime, no añadir analítica o trackers, no crear cuentas, no modificar Gmail y no presentar una métrica de adopción, rendimiento o seguridad que no tenga fuente.
