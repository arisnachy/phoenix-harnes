# Phoenix · Sistema editorial universal para PDFs (v1)

## Objetivo

Un PDF no está terminado solo porque un motor consiga abrirlo: debe ser legible, fiel a sus fuentes y estar compuesto con intención editorial. Esta habilidad es **un servicio transversal** del arnés universal Phoenix, no un comportamiento exclusivo de investigaciones médicas.

## Perfiles de presentación

- `academic`: prioriza las reglas editoriales obligatorias del usuario, universidad o revista. No incorporar portada creativa, colores ni gráficos adicionales que infrinjan APA, Vancouver/ICMJE o instrucciones institucionales.
- `editorial`: diseño contemporáneo, portada de alto nivel, retícula consistente, títulos jerarquizados, navegación, gráficos y tablas trazables. Pensado para informes, propuestas, publicaciones divulgativas, diagnósticos, productos comerciales y materiales de negocio.
- `hybrid`: rigor bibliográfico y redacción científica con una capa editorial discreta. Es la presentación preferida cuando el usuario pide un informe científico profesional con diseño moderno y no está sometido a una plantilla institucional estricta.


## Catálogo de estilos modernos (selector `design_preset`)

Se mantienen dos dimensiones independientes: el modo de entrega editorial (`presentation`) y los tokens/ilustración vectorial de la portada (`design_preset`). Así un documento `hybrid` puede usar cualquiera de las cinco identidades sin cambiar el contenido ni las citas.

| Valor | Identidad de portada | Cuándo utilizarlo |
| --- | --- | --- |
| `auto` | Selección determinista contextual | Valor recomendado: elegir por tipo de documento y tema del título |
| `editorial_navy` | Azul tinta, órbita verde y detalle dorado | Revistas, libros, monografías y reportes generales |
| `clinical_teal` | Fondo limpio, banda vertical, círculos de precisión | Salud, ciencias, clínica y revisiones de evidencia |
| `executive_amber` | Encabezado oscuro, geometría angular y acento ámbar | Estrategia, políticas públicas, negocios, informes ejecutivos |
| `minimal_graphite` | Blanco editorial, líneas finas y tipografía sobria | Tesis, análisis técnicos y lectura prolongada |
| `creative_coral` | Contraste berenjena-coral, formas asimétricas | Cultura, diseño, divulgación y propuestas creativas |
| `academic_classic` | Sin diseño decorativo | Únicamente `presentation: "academic"` |

La selección automática usa el **tipo de documento** primero y luego palabras clave no sensibles del título. No usa aleatoriedad ni cambia sin aviso de identidad entre reintentos. El usuario puede fijar la misma identidad para varios documentos mediante un preset explícito; el modo `academic` prevalece sobre las preferencias visuales.

Ejemplo de modelo de informe:
```json
{
  "title": "Informe de política sanitaria",
  "presentation": "hybrid",
  "design_preset": "executive_amber",
  "document_type": "policy_report"
}
```
Este ejemplo muestra solo campos de presentación; la publicación real exige las secciones, referencias verificables y demás datos validados por `phoenix_research_publish`.

## Comprobación automatizada

La CI ejecuta el publicador en Windows y Ubuntu y comprueba cinco portadas visualmente diferentes mediante hash del raster PDF, título y metadatos visibles, páginas con contenido dentro de los límites físicos, integridad PDF/DOCX, ruta `auto` y protección del formato académico estricto. No declara `visual_page_review: passed` por el mero hecho de hacer una comparación de píxeles: la inspección visual editorial humana o de un evaluador con capacidad de ver páginas es un paso adicional.

**Alcance real:** estos presets se ejecutan hoy en `phoenix_research_publish`. El contrato permite reutilizar su lenguaje visual en otros productores de Phoenix cuando adopten el servicio de composición; ello no demuestra que todos los productos existentes usen ya estas portadas.

## Reglas de composición

1. **Portada**: masthead vectorial, título claro, subtítulo cuando exista, metadatos únicamente suministrados, sin inventar logotipos, autores ni afiliaciones. Evitar portadas formadas por una sola línea perdida en medio de la página.
2. **Sistema tipográfico**: jerarquía de títulos, contraste y cuerpo cómodo de 10.5–11 puntos aproximadamente en A4; interlineado proporcionado, buen soporte Unicode y fuentes locales con fallback.
3. **Paleta coherente**: azul oscuro `#142b3a`, verde azulado `#117e84`, ámbar sobrio `#d59a54`, fondo suave `#f7faf9`. Nunca usar colores para fingir certeza estadística.
4. **Retícula**: márgenes seguros y encabezado/pie fuera de la región de lectura. Respetar sangrías, viudas/huérfanas y evitar títulos huérfanos.
5. **Tablas**: anchos ponderados según el contenido en vez de columnas iguales cuando las explicaciones son largas; repetir la cabecera, envolver texto y dividir solo entre filas completas. Cuando la tabla sea demasiado ancha, preferir bloques de evidencia legibles sin alterar datos.
6. **Gráficos**: únicamente a partir de números, poblaciones, periodos y fuentes reales. Deben indicar unidades, eje, procedencia y límites de interpretación. No inventar datos ni producir gráficos ornamentales.
7. **Índice y secciones**: marcadores enlazables, títulos consistentes, numeración de páginas y separadores discretos. DOCX, HTML y PDF deben expresar la misma información.
8. **Referencias**: conservar DOI/URL, estilo elegido y correspondencia con citas. No generar bibliografía automática ficticia.
9. **Identidad de Phoenix**: la marca de autoría no debe confundirse con la institución ni con la identidad de quien encargó el informe.

## Contrato de verificación

Previo a `REPORT_READY` validar: cabeceras PDF y DOCX, página A4/Letter, contenido no vacío, enlaces y tablas, ausencia de recortes, desbordamientos y solapes. Diferenciar validación estructural automática de revisión visual efectiva. El campo `visual_page_review` debe permanecer en `not_performed` si no se han renderizado e inspeccionado las páginas.

La verificación de fidelidad tiene prioridad sobre el diseño. Una estética moderna no convierte una revisión narrativa en revisión sistemática ni permite afirmar resultados sin soporte.

## Continuidad

La presentación forma parte de un esquema universal de documentos. El productor científico puede seguir usando su modelo de datos actual, pero el mismo motor de composición debe poder servir a libros, informes financieros, documentos técnicos, proyectos, planes de negocio y propuestas comerciales. La fuente de verdad es el documento estructurado; la salida PDF es un render, no la fuente primaria.
