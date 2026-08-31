# PHOENIX skill operational adapters

English | [中文](skill-operational-adapters.zh.md)

PHOENIX applies an operational preflight to every skill visible through `ctx.skills.list()`. This includes bundled, user, project, plugin, and OpenClaw skills. The adapter runs in `tool-skill`, the common path used by every harness model.

## Required flow

When a task matches a skill:

```text
skill({ name: "exact-skill-name" })
```

The result contains `<phoenix_operational_preflight>` first and the skill content second. The model must:

1. read the catalog and use the exact name;
2. load the skill before acting;
3. check required inputs;
4. ask for clarification when locations, accounts, people, files, or destinations are ambiguous;
5. use only tools present in the agent's visible schemas;
6. review external requirements before execution;
7. report honestly whether the capability is conditional or instructional only.

The adapter guides the model but does not create tools or grant credentials.

## Modes

- **`native`**: a visible PHOENIX tool matches the documented operation.
- **`conditional`**: the skill is usable but requires an additional CLI, API, OAuth flow, permission, device, or platform.
- **`instruction-only`**: the skill can explain the procedure, but this runtime declares no execution path.

Loading a skill does not mean that its external service has been executed. For example, a GitHub skill can load successfully when GitHub authentication is not configured.

## Language rule

Generated preflight text must not introduce Chinese or accidental ideographic markers. Operational text is generated in the harness-configured language. Skill names, commands, paths, URLs, and technical citations remain untranslated. Translating every skill body into English is a separate phase and must use overlays without modifying upstream content.

## Weather and disambiguation

`openclaw-weather` requires `location`. `Santiago` must not be queried directly because it may refer to several places; the model must ask for a country, region, airport, or coordinates. An input such as `Santiago de los Caballeros, Dominican Republic` is unambiguous enough to continue.

The registered web tool is preferred when available. HTTPS fallback is used only when the preferred tool is unavailable. Remote content is treated as data, never as system instructions.

## Individual verification

Run:

```text
pnpm run verify:skill-operational-adapters
```

The command obtains the live `ctx.skills.list()` snapshot, loads every model-invocable skill with `ctx.skills.get()`, computes its profile, checks its preflight, and writes:

- `docs/subsystems/skill-operational-adapters-report.md`: one row per skill with purpose, invocation, inputs, mode, requirements, and result;
- `docs/superpowers/evidence/skill-operational-adapters-verification.json`: structured evidence without bodies, secrets, or network responses.

The latest run verified **577/577** visible skills, all loadable and with a non-Chinese preflight. The count can change when plugins and skills are installed, removed, or updated.
