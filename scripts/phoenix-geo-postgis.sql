-- Phoenix Geo Intelligence PostGIS schema. Requires PostgreSQL/PostGIS.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS phoenix_geo;
CREATE TABLE IF NOT EXISTS phoenix_geo.features(
 workspace_key text NOT NULL,
 scene_key text NOT NULL,
 feature_key text NOT NULL,
 label text NOT NULL,
 value double precision,
 props jsonb NOT NULL DEFAULT '{}'::jsonb,
 geom geometry(Geometry,4326) NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (workspace_key,scene_key,feature_key),
 CONSTRAINT phoenix_geo_valid_geom CHECK(ST_IsValid(geom)),
 CONSTRAINT phoenix_geo_wgs84_range CHECK(ST_CoveredBy(geom,ST_MakeEnvelope(-180,-85,180,85,4326)))
);
CREATE INDEX IF NOT EXISTS phoenix_geo_geom_idx ON phoenix_geo.features USING GIST(geom);
CREATE INDEX IF NOT EXISTS phoenix_geo_scope_idx ON phoenix_geo.features(workspace_key,scene_key);
