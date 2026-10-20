# Agent Note: Native publication of evidence-based geographic maps

Status: implemented

English | [中文](2026-10-20-native-geographic-map-publication.zh.md)

## Problem

The geographic renderer already accepted declarative geo_map data, but Kira had no model-facing native publisher that generated a reliable chat artifact. It could announce a map that existed only in prose. Its missing-map recovery button unconditionally requested a fictional scene_map even for real public-health geography.

## Decision

Register phoenix_geo_map in the existing hardness tool composition. It validates a bounded WGS84 geometry set, source metadata, geographic layer IDs and optional numeric variables, derives a visible viewport and emits the same non-executable native MIME accepted by GeoMap. Like the existing fictional map publisher, the returned artifactId confirms emitted payload metadata, not verified rendering on the end user's screen. Native chat projection mounts the existing React map rather than opening MiniBrowser or a new graphics framework.

The missing-map recovery action now routes real geographic work to phoenix_geo_map and fictional atlases to phoenix_scene_map. In research and healthcare, a small study cannot automatically be turned into provincial prevalence, a heatmap or a ranking. Lack of verified locations or required data blocks publication instead of inventing coordinates.

## Alternatives considered

**Always tell the model to write a special JSON fence.** Rejected because the observed failure was a prose-only success claim; a callable tool provides explicit artifact emission.

**Rebuild the cartographic renderer or invoke an external browser.** Rejected because GeoMap already provides a native 2D/3D viewer, legend, selection and export and the browser workaround would repeat the hidden-render failure.

**Insert approximate research-study points or provincial polygons automatically.** Rejected because that would misattribute local samples to larger populations and risk producing misleading health maps.

## Consequences

Geographic tasks can now use a durable, replayable tool output and native chat renderer. New tests cover the model-facing receipt, invalid geographic input, frontend rendering and geographic recovery. Real source verification remains part of the research mission; the tool validates structure but cannot certify epidemiological representativeness or that the user saw and clicked the final map. An insufficient-data answer is appropriate when geolocation is not justified.
