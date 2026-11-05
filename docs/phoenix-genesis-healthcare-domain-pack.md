# PHOENIX Genesis · Hospital 360° (paquete de dominio)

Este módulo convierte las matrices del **Plan Maestro Genesis + Fabric v4**
en un catálogo operativo de referencia, consultable por Genesis sin
introducir dependencias hospitalarias en el núcleo universal.

## Alcance

El archivo \`scripts/phoenix-genesis-healthcare-catalog.json\` contiene
datos de referencia derivados del libro
\`PHOENIX_Genesis_Fabric_Matrices_v4.xlsx\`:

| Catálogo | Registros |
| --- | ---: |
| Áreas/funciones hospitalarias | 60 |
| Indicadores con fórmula, fuente y responsable sugeridos | 135 |
| Informes institucionales | 34 |
| Comités y órganos colegiados | 20 |
| Entidades de datos canónicos | 49 |
| Riesgos y controles propuestos | 20 |
| POE iniciales | 12 |
| Referencias públicas investigadas | 19 |
| Métodos de integración y software tradicional | 10 |
| Plantillas de seguimiento de envíos y acuses | 34 |
| Flujos interdepartamentales | 15 |
| Categorías de presupuesto | 13 |
| Entradas de responsabilidad RACI | 11 |

El catálogo **no es un inventario real** de ningún centro. Nada se crea,
instala, activa, contrata o reporta a autoridades por figurar aquí.
El hospital debe definir con su equipo cuáles unidades existen y
validar fuentes, fórmulas, responsables, plantillas y obligaciones
específicas antes de su incorporación al registro institucional.

Los indicadores clínicos no deben ser considerados métricas oficiales
sin la versión vigente de su definición y validación del establecimiento.
Los datos personales no se incluyen en este paquete.

## API local y consola

Tras ejecutar \`pnpm genesis\`, entrar desde el ordenador local a
\`http://127.0.0.1:8767/\`, autenticarse, elegir institución y abrir la
sección **Catálogo 360°**. El panel permite seleccionar un dominio y
buscar por palabra, responsable, definición o código. Las tablas usan
datos textuales sin interpretarlos como HTML ejecutable.

Rutas autenticadas:

- \`GET /v1/catalog/summary?organizationId=<id>\`
- \`GET /v1/catalog?organizationId=<id>&category=indicators&query=ocupación&limit=40&offset=0\`

Los resultados son páginas con máximo 100 registros. La consulta
no altera inventarios ni declara informes entregados.

Para organizaciones ajenas a salud, la API responde con
\`available:false\` y mantiene la plataforma universal. Los sectores
restaurante, educación, manufactura, comercio y gobierno tienen sus
propias propuestas de estructura en
\`scripts/phoenix-genesis-sector-packs.mjs\`.

## Próxima etapa

El paquete se conectará al **Organization Compiler** para crear una
lista de verificación por jefatura, asociar el indicador y la obligación
a fuentes concretas, solicitar datos faltantes, comités y manuales,
proponer interfaces inteligentes y construir POA/POE completos con
aprobaciones y firma. Ninguna operación clínica o entrega al gobierno
debe activarse sin las condiciones de verificación.

## Pruebas

~~~powershell
node --test scripts/phoenix-genesis-healthcare-catalog.test.mjs
~~~

Se verifican cantidades, fórmulas conservadas, filtros/acento, búsquedas,
paginación, autenticación y ausencia de efectos sobre la institución.
