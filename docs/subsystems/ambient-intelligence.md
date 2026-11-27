# PHOENIX Ambient Intelligence — initial native slice

Available to every model through `phoenix_ambient` in tool-living. Observations are read-only and on demand. No model-specific routing, network scanning, GPS inference, background scheduler or additional paid credentials.

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

Remaining work: OS permission-backed geolocation, mDNS/SSDP inventory, import of OSM/Overture catalogs, MapLibre UI, persistent graph and change events, weather/news/satellite/ephemeris adapters, proactive alerts and Windows integration validation.
