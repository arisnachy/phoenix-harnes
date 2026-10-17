# Phoenix Business Engine — núcleo comercial inicial

**Alcance incorporado:** biblioteca local persistente fuera de entornos temporales; productos genéricos; capítulos estructurados para libros; archivos con SHA-256; precalificación editorial; compilación real de EPUB3 (ZIP, índice, metadatos, XHTML) y manuscrito Markdown; generación de una galería HTML local; preparación de fichas comerciales; clasificación de herramientas MCP candidatas y fallback de navegación; registro de ingresos declarados sin atribuirles validación comercial inexistente. **No** incluye todavía un botón integrado en la barra lateral ni un publicador autónomo para Amazon. No confundir «preparado» con «publicado».

## Ejecución

```bash
pnpm business help    # o: node scripts/phoenix-business.mjs help
node scripts/phoenix-business.mjs init book "Mi primera novela"
node scripts/phoenix-business.mjs list
node scripts/phoenix-business.mjs chapter ID 1 path/to/capitulo-1.md
node scripts/phoenix-business.mjs asset ID path/to/ebook.epub --role ebook
node scripts/phoenix-business.mjs check ID --chapters 24 --words 60000
node scripts/phoenix-business.mjs compile ID --author "Nombre real" --chapters 24 --words 60000
node scripts/phoenix-business.mjs route amazon-kdp --tools mcp__servidor__publicar,mcp__servidor__buscar
node scripts/phoenix-business.mjs prepare ID amazon-kdp 4.99 --currency USD
node scripts/phoenix-business.mjs gallery
node --test scripts/phoenix-business.test.mjs
```

La `gallery` se guarda en `~/.dsh/business-library/gallery.html` (Windows: `%USERPROFILE%\.dsh\business-library\gallery.html`). Un solo `library.json` conserva todos los productos y sus referencias, con escritura atómica y exclusión por archivo lock. Directorios de producto: `products/ID/`. Configurar `PHOENIX_BUSINESS_HOME` si se requiere otro destino persistente. Los archivos registrados se copian, no dependen de la ruta temporal original. Todo queda local; la copia a Google Drive es una operación distinta autorizada.

## Enrutamiento comercial

1. Descubrir servidores MCP en la galería existente, comprobar `ready` y la capacidad de escritura real en la API. La salida `mcp-candidate` **solo** expresa compatibilidad aparente por nombre, no autorización ni éxito.
2. Verificar el esquema y la política de la tienda. Si no existe una integración usable, evaluar el mininavegador **con login del usuario y vault**, sin eludir mecanismos de seguridad.
3. Preparar y comprobar formatos, metadatos, derechos y declaración de IA. `prepare` no ejecuta transacciones externas.
4. Solicitar aprobación interactiva antes de enviar, publicar, iniciar publicidad pagada o aceptar contratos; recopilar comprobante real de la plataforma y guardarlo en el expediente.
5. Medir visitas, pedidos, regalías y beneficio neto con procedencia. El comando `sale` representa una observación *no verificada* hasta contrastarla con el canal oficial.

## Límites intencionales y siguiente integración

- `compile` produce EPUB3 validado estructuralmente en pruebas locales, **no** una cubierta de impresión, DOCX ni PDF final. El EPUB debe comprobarse en Kindle Previewer y pasar revisión tipográfica y editorial.
- `check` compara extensión de capítulos y la estructura; **no verifica** estilo literario, continuidad narrativa real, originalidad, maquetación ni conteo de páginas del PDF. Esas pruebas siguen pendientes hasta disponer de motores y validadores dedicados.
- `prepare amazon-kdp` exige capítulos, cubierta y EPUB/DOCX/KPF y deja la publicación en revisión; la subida a KDP y el estado de tienda deben implementarse como adaptadores gobernados, no como simulación de envío.
- La galería HTML estática se puede abrir de inmediato, pero para convertirla en una pestaña nativa de Phoenix se necesitan un gateway local con operaciones seguras y una vista de cliente conectada al almacenamiento host.
- Antes de activar canales de venta, integrar conciliación verificada, permisos con auditoría, control de presupuesto de anuncios, material fiscal, país y métodos de cobro.
- Se necesitan pruebas en Windows y CI de monorepo además de las pruebas autónomas de Node.

La instrucción de operación para Kira está en `.agents/skills/phoenix-business/SKILL.md`, que el proveedor local de habilidades detecta al ejecutar Phoenix desde el repositorio con su configuración predeterminada.
