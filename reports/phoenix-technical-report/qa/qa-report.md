# QA visual del informe técnico de PHOENIX

- Fecha: 2026-08-28
- Artefacto: `../phoenix-technical-report.pdf`
- Formato: A4, cinco páginas
- Render de revisión: Poppler `pdftoppm` a 144 DPI, 1192 × 1686 px por página

## Resultado

| Página | Contenido revisado | Resultado |
|---:|---|---|
| 1 | Portada, jerarquía, síntesis, metadatos visibles y pie | PASS |
| 2 | Tarjetas de uso, flujo, llamadas técnicas y fuentes | PASS |
| 3 | Diagrama SVG, tabla de paquetes y tarjetas de seams | PASS |
| 4 | Matriz de controles, contraste de estados y límites | PASS |
| 5 | Operación, comandos, tabla de estado, conclusión y fuentes | PASS |

## Accesibilidad y contenido

- El documento declara `lang="es"` y contiene un `h1` único.
- Los dos diagramas SVG declaran `role="img"`, `<title>` y `<desc>`.
- Ambos diagramas incluyen fallback textual visible.
- Las tablas tienen etiquetas `aria-label` y encabezados semánticos.
- La paleta no usa color como única codificación: los estados incluyen texto.
- El verificador estructural reportó `REPORT_VERIFY_PASS pages=5 bytes=149172`.
- `pdfinfo` reportó `Pages: 5`.

## Evidencia visual

Las capturas `page-1.png` a `page-5.png` muestran composición estable, sin texto cortado, desbordamiento, superposición, encabezados huérfanos ni notas de fuente fuera de página.
