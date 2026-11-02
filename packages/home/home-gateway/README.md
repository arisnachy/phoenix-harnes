# @phoenix-ai/dsh-home-gateway

English | [中文](README.zh.md)

Home Assistant capability for a private or local endpoint. `HomeAssistantGateway` accepts a token provider, validates every request against the configured entity and service allowlists, and returns bounded state or control results. `HomeAssistantGatewayService` exposes the same operations as `ctx.home`.

Configuration requires `baseUrl`, `tokenEnv`, non-empty `allowedEntities`, non-empty `allowedServices`, and a positive `requestTimeoutMs`. The URL cannot contain embedded credentials and must resolve to localhost, a `.local` host, a private IPv4 range, or a host without a public suffix. The service reads the token only when a request is made.

## Model Experience

### Home Assistant state and control capability

#### What the model sees

The companion [`tool-home-gateway`](../tool-home-gateway/README.md) exposes `home_list_devices` and `home_control`. The model receives only allowlisted entities and cannot scan the LAN or call an unapproved service.

#### Token effect

This package adds no prompt text or tool schema directly; the companion tools add two stable names and bounded JSON results.

#### KV Cache effect

No direct invalidation; changes to the configured allowlists affect tool results, not the request prefix.

## Known Limitations and Deferred Work

- The provider implements Home Assistant's REST endpoints for states and service calls only.
- Response attributes are projected as JSON without provider-specific device history.
