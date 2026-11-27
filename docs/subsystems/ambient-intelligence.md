# PHOENIX Ambient Intelligence — initial native slice

Available to every model through `phoenix_ambient` in tool-living. Observations are on demand by default. Optional public-feed monitoring and local journal persistence are explicitly configured. No model-specific routing, network scanning or additional paid credentials.

- overview: host timezone, UTC, configured geographic context and cosmic hierarchy.
- network: local interface address count and passive Windows private IPv4 neighbor-cache counts (not a complete inventory).
- places: configured local catalog, category/name search, great-circle distance.
- route: optional explicitly configured local OSRM driving service, no live traffic.
- world: USGS M4.5+ past-day observations.
- space: NOAA planetary Kp observation; not ephemerides.

Set PHOENIX_AMBIENT_CONTEXT_JSON in the host environment, not in source control. Example (illustrative coordinates only):
```json
{"location":{"city":"Example","country":"Example","lat":19,"lon":-70},"places":[{"name":"Example hospital","category":"hospital","lat":19.01,"lon":-70}],"osrmPort":5000}
```
Omit the setting to keep geographic location unknown. Routing requires an independently installed local OSRM instance with regional map data. No location is transmitted to public feeds. Feed requests use fixed HTTPS sources, bounded response size, timeout, and a five-minute in-memory cache. Retrieved data is untrusted and not an emergency alert. Missing/stale data must be disclosed. No automatic collection or external action permission follows from observation.

## Extension

Additional operations: location (Windows provider with OS permission and allowWindowsLocation:true), map (GeoJSON output, not an embedded renderer), weather (allowPublicWeather:true only for noncommercial hosted Open-Meteo use; rounded coordinates sent to provider), moon (mean-cycle approximation), ephemeris (NASA/JPL geocentric observer table for supported bodies), journal and graph (bounded observation changes and suggested notable events).

Optional monitorPublicFeeds:true enables a 15-minute lifecycle-managed USGS/NOAA observer, without location or model calls. PHOENIX_AMBIENT_STATE_DIR (absolute path) opts into local persistence of up to 128 numeric observations; no exact location, device identities or raw feed text is stored. Without it the journal is in-memory. Configure a point FeatureCollection in geojson or the places array; these are user-provided data, not a live business directory. No proactive push/voice delivery is claimed. Windows location may be network-derived rather than GPS.

Remaining: service-discovery protocols, full cartographic UI/catalog ingestion pipeline, global news and official local alerts, satellite/constellation views, proactive notification delivery, real Windows and provider validation.
