# @phoenix-ai/dsh-tool-home-gateway

English | [中文](README.zh.md)

Model-facing Home Assistant tools over [`ctx.home`](../home-gateway/README.md). `home_list_devices` reads current state for configured entities. `home_control` invokes a configured service for a configured entity and forwards the caller cancellation signal.

The plugin registers a system-prompt section that prohibits direct LAN access, invented entity ids, network discovery, and services outside the deployment allowlists. Its generic execute cards show the selected entity or read operation without exposing credentials.

## Model Experience

### Allowlisted device tools

#### What the model sees

The model sees two JSON tools with stable names and bounded outputs. A control result reports the entity, fully qualified service, HTTP status, and success flag. Errors remain tool failures so the mission persistence layer can replan instead of treating a denied device operation as mission completion.

##### Tool schemas

```markdown
See the generated [home_control and home_list_devices catalog entries](../../../docs/tool-catalog.md#phoenix-aidsh-tool-home-gateway).
```

#### Token effect

The two stable tool schemas and one bounded result add a small fixed request cost; device state is included only in the result of an explicit call.

#### KV Cache effect

Tool definitions remain prefix-stable while the package is loaded. Device state and control results append after the reusable request prefix.

## Known Limitations and Deferred Work

- The tool is usable only when the `home-gateway` service is explicitly enabled and configured.
- It does not provide voice commands, automatic device discovery, or direct support for platforms other than Home Assistant.
