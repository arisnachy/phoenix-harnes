# Phoenix Geo Pro — operativo

Geocodificación: configurar un Nominatim compatible de pago o propio, sin endpoint demo público.

    pnpm geo:operations geocode --address "Santiago de los Caballeros" --endpoint https://geocoder.example.com --output lugares.geojson
    pnpm geo:operations reverse --position "[-70.704,19.45]" --endpoint https://geocoder.example.com
    pnpm geo:operations route --input paradas.json --endpoint https://osrm.example.com --profile driving --output ruta.geojson

paradas.json contiene al menos dos ubicaciones: matrices [longitud,latitud] WGS84.
Nunca enviar pacientes, ubicaciones privadas ni secretos a proveedores externos.

PDF y chat:

    pnpm geo --input lugares.geojson --output lugares.geo-map.json --source "Encuesta oficial" --title "Cobertura" --theme research --report metodo.md --pdf mapa.pdf

La salida PDF es vectorial (sin calles ni relieve inventados), contiene fuente, estadísticas y metodología. Se integra como artefacto exportable. La vista 3D es extrusión temática de métricas y no equivale a un modelo digital de elevación del terreno.

PostGIS real: requiere PostgreSQL, PostGIS y psql; configurar variables PGHOST, PGPORT, PGDATABASE, PGUSER y PGPASSWORD o PHOENIX_GEO_DATABASE_URL.
H3 auténtico requiere además las extensiones h3 y h3_postgis de PostgreSQL, 4.2.3+.

    pnpm geo:db init
    pnpm geo:db import --workspace proyecto --scene mapa1 --input datos.geojson
    pnpm geo:db hex --workspace proyecto --scene mapa1 --size 500 --output hex.geojson --map hex.geo-map.json
    pnpm geo:db h3 --workspace proyecto --scene mapa1 --resolution 8 --output h3.geojson --map h3.geo-map.json

PostGIS agrupa según centroides; no ajusta tasas por población automáticamente.
El almacenamiento se separa por workspace/scene, pero la autenticación y la política RLS deben configurarse en cada despliegue multiusuario.
La ejecución de tests no demuestra que haya un servidor PostGIS o proveedor licenciado conectado.

    pnpm test:geo
