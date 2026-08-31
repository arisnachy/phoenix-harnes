# Home

English | [中文](README.zh.md)

The Home group contains the private-network Home Assistant capability and its model-facing tools. The capability owns HTTP authorization, endpoint validation, entity and service allowlists, and bounded state projections; the tool package owns the model schema and presentation.

The default bundle keeps these plugins disabled. An operator enables them with `PHOENIX_HOME_ASSISTANT_URL`, `PHOENIX_HOME_ASSISTANT_TOKEN_ENV`, `PHOENIX_HOME_ASSISTANT_ALLOWED_ENTITIES`, and `PHOENIX_HOME_ASSISTANT_ALLOWED_SERVICES`. The endpoint must be local or private, and the token value remains in the referenced environment variable.

See [`home-gateway`](home-gateway/README.md) for the provider contract and [`tool-home-gateway`](tool-home-gateway/README.md) for model behavior.

## Known Limitations and Deferred Work

- The integration targets Home Assistant's REST API; other home platforms require a separate capability provider.
- No automatic LAN discovery is exposed. Devices and services must be explicitly allowlisted.
