# Phoenix Geo Intelligence — contrato de UI integrada (v1)

**Estado:** base cartográfica nativa UI v1. No implica geocodificación, enrutamiento ni análisis espacial de servidor.
Forma parte de Phoenix Universal Mission Engine; no es una aplicación separada.

## Generación desde Kira

Cuando haya **coordenadas verificadas** y el usuario requiera una visualización espacial, Kira puede entregar un bloque de código **generative-ui**:

\`\`\`generative-ui
{
  "component": "geo_map",
  "version": 1,
  "props": {
    "id": "sucursales-octubre",
    "conversationId": "id-opcional-si-se-conoce",
    "title": "Rendimiento de sucursales",
    "subtitle": "Selección territorial",
    "theme": "business",
    "source": "Archivo de sucursales proporcionado por el usuario",
    "updatedAt": "2026-10-20",
    "metric": "Ventas",
    "center": { "lng": -70.704, "lat": 19.451 },
    "zoom": 11,
    "layers": [
      {
        "id": "puntos", "name": "Sucursales", "kind": "points",
        "features": [
          {"id":"s-1","label":"Sucursal A","coordinates":[[-70.704,19.451]],"value":120,"color":"#15926b"}
        ]
      }
    ]
  }
}
\`\`\`

Solo se aceptan \`geo_map\` validos. Coordenadas y geometrías se expresan en orden **[longitud, latitud] (WGS84)**; la vista se define con \`center: {lng,lat}\`. Capas: \`points\`, \`line\`, \`polygon\`, \`heat\`. \`heat\` v1 es simbología circular, no interpolación de densidad. El mapa real ofrece zoom, desplazamiento, visibilidad de capas, selección, etiquetas, contexto hacia el compositor de Kira y exportaciones GeoJSON, CSV y SVG vectorial. El SVG carece de basemap raster y declara esa limitación para prevenir confusiones en informes.

\`conversationId\` **debe** ser el ID real y estable del contexto conversacional; jamás reutilizar uno genérico entre sesiones. Persiste únicamente el centro y el zoom localmente bajo una clave aislada por conversación y mapa. La especificación es parte del propio mensaje, por lo que permanece en el historial y puede ser regenerada. Los datos se obtienen de documentos o conectores mediante las herramientas existentes: no deben inventarse lugares, cifras ni rutas.

Para informes académicos, exportar SVG y adjuntar leyenda completa, fuente, fecha, unidad, sistema de coordenadas y método. Los informes se componen mediante el flujo editorial/PDF existente; el componente no asegura generar PDF por sí solo. Se prioriza SVG de geometrías y GeoJSON para reproducibilidad.

## Límites y extensiones

- Primer render sin nueva dependencia npm, teselas raster de OpenStreetMap sujetas a su política, atribución visible y sin descarga offline. Para uso comercial intenso, configurar un proveedor licenciado o un servidor propio antes de producción.
- Carga máxima 12 capas / 3 000 geometrías / 400 vértices por entidad. Agregaciones extensas: backend futuro con PostGIS/H3/deck.gl, no ejecutarlas silenciosamente en el navegador.
- La interacción no otorga a los modelos permisos ni acceso a ubicación del dispositivo. Selección solo añade texto al compositor, sin acciones silenciosas.
- Acceso espacial y geocodificación externos solo con proveedores autorizados, consentimiento y trazabilidad. Evitar identificar pacientes mediante puntos o áreas pequeñas.
- Roadmap pendiente: motor geocodificador, ruteo/isócronas, estadísticas espaciales agregadas, exportador de PDF integrado, mapas 3D/PMTiles, capas temporales e integración bidireccional con datasets persistentes del host.

## Criterios de aceptación v1

Validar especificaciones inválidas sin ejecutar código, dos conversaciones con IDs distintos, carga visible de teselas con red, desplazamiento y zoom, selección que alimenta el compositor, desactivación de capas, SVG vectorial, GeoJSON válido, CSV protegido contra inyección de fórmulas y aislamiento de viewport en localStorage.

La UI aplica **automáticamente el ID real de la sesión** desde `AssistantNodeView` al renderer; el campo opcional de la especificación no puede sustituir ni invalidar el aislamiento del host. También puede renderizarse un artefacto JSON con MIME `application/vnd.phoenix.geo+json`, sin ejecutarse scripts.
