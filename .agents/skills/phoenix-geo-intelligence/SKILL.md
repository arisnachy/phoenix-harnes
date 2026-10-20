---
name: geo-intelligence
description: >-
  Use whenever the user wants a geographic map, addresses, point locations,
  choropleth or heat layers, neighborhood analysis, real-world routes,
  delivery coverage, GIS, census/statistics by territory, H3/PostGIS, 3D
  geographic visualization, or a publication-ready cartographic PDF.
---

# Phoenix Geo Intelligence — Universal Mission Engine capability

Phoenix is universal. Geographic mapping is a reusable capability for research,
business, logistics, healthcare, policy, statistics, tourism and reporting.
Kira should infer the user's natural intent and choose a sensible output
without asking the user to specify an engine or JSON schema.

## Conversation contract

- Prefer an interactive geo_map block (version 1) **inside the same chat**
  when the goal is exploration or choosing places; preserve surrounding
  human-friendly explanation and allow map selection back into the composer.
- For finished studies create reproducible GeoJSON, a geo-map.json, data
  tables, statistics and a PDF, with clean legend, source, unit, date,
  coordinate system and methods. Use the native map's PDF export button
  or the CLI PDF command. Avoid giant raw JSON walls in the chat.
- For one location: marker + address and verified point. For travel: **real
  provider route**, never a straight line described as a driving route.
  For territorial statistics: use actual data and color by declared metric
  and polarity; do not invent denominators, regions, boundaries or claims.
- Bind each map to the **actual conversation/session ID** through the chat UI.
  Do not reuse MiniBrowser state across conversations. Persist datasets in a
  durable workspace directory; never trust staging as permanent storage.
- Access private location data only with authorization; do not send clinical
  case addresses, precise locations of patients, secrets or private household
  records to external providers without informed consent. Prefer aggregated
  reporting with minimum-size thresholds for sensitive data.

## Existing tools (check executable availability first)

Convert CSV or GeoJSON with real coordinates to a map with metadata and PDF:

    pnpm geo --input datos.geojson --output mapa.geo-map.json --source "Fuente real" --title "Análisis territorial" --theme research --polarity neutral --report metodo.md --pdf mapa.pdf
    pnpm test:geo

Nominatim-compatible geocoding (requires a privately configured instance or
licensed provider; do **not** call nominatim.openstreetmap.org for generic
Phoenix geocoding, and do not use forbidden autocomplete/bulk lookup):

    pnpm geo:operations geocode --address "DIRECCION" --endpoint https://geocodificador-autorizado.example --output lugares.geojson
    pnpm geo:operations reverse --position "[-70.7,19.45]" --endpoint https://geocodificador-autorizado.example

Actual OSRM geometry/distance/duration from a configured routing service:

    pnpm geo:operations route --input paradas.json --profile driving --endpoint https://router-autorizado.example --output ruta.geojson

Spatial database (requires PostgreSQL, PostGIS, psql and account configured
via PG* environment vars; H3 also requires h3/h3_postgis extension):

    pnpm geo:db init
    pnpm geo:db import --workspace proyecto --scene mapa1 --input datos.geojson
    pnpm geo:db hex --workspace proyecto --scene mapa1 --size 500 --map hex.geo-map.json --output hex.geojson
    pnpm geo:db h3 --workspace proyecto --scene mapa1 --resolution 8 --map h3.geo-map.json --output h3.geojson

The geo_map UI can represent points, routes/lines, polygons and circles;
supports layer visibility, color metrics, 2D/3D thematic extrusions, selections,
CSV/GeoJSON/SVG/PDF export. The 3D mode is a projected thematic surface: it
does NOT claim DEM-accurate terrain altitude without actual DEM data.
The Node PDF and chat PDF contain source-attributed vector geography rather
than pretending to show unlicensed raster map tiles.  Do not claim PostGIS,
routing, geocoding, H3, live GPS, real-time traffic or publication unless a
real response was obtained and checked.

Use the tools already connected to Phoenix for data collection and authorized
geocoding; do not ask for provider credentials in public chat. If a provider
is not configured, preserve the project, explain exactly what configuration is
missing, and continue completing the parts that can be executed offline.

## Report quality gate

Check underlying data and statistical definitions; never silently use sums
for rates, count of points for prevalence or reverse polarity of heat colors.
Record source/year/unit/denominator and spatial resolution. For H3 geometry
the PostGIS H3 extension is authoritative, not a planar imitation.
Always distinguish 2D basemap, map 3D extrusions and actual DEM terrain.
Validate output PDFs and GeoJSON before declaring them ready.
