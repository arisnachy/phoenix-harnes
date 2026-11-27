# PHOENIX Location Awareness

Reality Context separates client location, configured location and physical Host location.

- Browser permission must already be granted. Settings > General > Test location is the explicit consent/sensor test.
- On a personally controlled Windows Host, set `PHOENIX_REALITY_WINDOWS_LOCATION=1` in the Host launch environment and enable Windows Settings > Privacy & security > Location, including desktop apps. Restart the Host. Only then will the periodic native probe run, independently of chat, without a permission dialog. Do not enable this on a shared or remote host unless its physical location is relevant and authorized. The sensor samples are held in RAM, and failures/expiration remove the observation. The source identifies the Windows **Host**, not the person or a remote client.
- Existing explicit coordinate configuration keeps precedence; a valid browser observation comes before native fallback. Native coordinates feed the existing location-dependent Open-Meteo weather path, which sends coordinates to the weather provider. Enabling native location therefore also enables that existing weather lookup.
- Optional offline civic labels: set `PHOENIX_REALITY_CIVIC_CATALOG` to a local JSON array of curated areas with latitude, longitude, radiusMeters, country, optional region, city and sector. Areas are approximate circles; use conservative radii that fit the actual boundary. Full sensor uncertainty must fit inside an area. Conflicting labels remain unknown. No public reverse-geocoding requests, API keys or billing. A geographic catalog is not bundled, and sector precision depends on its coverage and accuracy.
- To inspect the result, invoke `phoenix_reality_now` with mode=full. Verify source, status, observation time, expiry, accuracy, and civic provenance. No location is inferred from timezone.

Native Windows access and real sensor quality must be validated on the target machine; CI unit tests are not a real sensor test.

## Automatic place names

Ask where you are, or call `phoenix_reality_now` with `mode=location`. PHOENIX downloads the public GeoNames `cities500.zip` and `admin1CodesASCII.txt` catalog on the first authorized lookup, and attempts a country detail file (for example `DO.zip`) to improve locality/sector coverage. The downloads use fixed dataset URLs; no coordinates are sent to GeoNames, but the country file request exposes the country code and usual connection metadata. No API key or paid service. Only public catalog files are cached in `~/.phoenix/geonames-v1`; sensor readings remain ephemeral. Local lookup is available after downloading, including offline. GeoNames provides nearest named places, not authoritative boundary or street-level proof. If uncertainty or coverage is insufficient, the relevant name remains unavailable. Source: [GeoNames](https://www.geonames.org/export/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Existing weather calls remain separate.
