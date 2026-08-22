# PHOENIX Mission Graph Runtime v7

PHOENIX Mission Graph turns a long mission into a validated directed acyclic graph (DAG) of bounded tasks. Independent tasks can be scheduled in parallel; dependent tasks unlock only after upstream success.

## Core rules

- Each task declares a role, dependencies, token budget, attempt limit and risk class.
- `RankedMissionScheduler` assigns only models that clear the Model Capability Ladder gate for that role.
- Blocked/quarantined model keys can be excluded from scheduling even if they rank highly.
- Exhausted paths become `pivot_required`; a pivot replaces the failed path instead of silently retrying it forever.
- Mission snapshots store state and output fingerprints, not raw task outputs.

## Clean-room collective evolution

Remote collective evidence is never treated as executable input. `CleanRoomEvidenceFirewall` rejects peer-supplied code, patches, artifacts, MCP definitions, commands, scripts, secrets, credentials and install/update instructions. Accepted inert evidence is converted into a neutral local reproduction task that instructs PHOENIX to reproduce the hypothesis independently with local fixtures and trusted tools.

```text
remote symptom/evidence
        ↓
observe-only validation
        ↓
CleanRoomEvidenceFirewall
        ↓
NO remote code / MCP / commands
        ↓
local reproduction task
        ↓
Mission Graph
        ↓
ranked specialist model
        ↓
trusted local tools + security leases
        ↓
evidence
        ↓
local challenger / tests / judges
```

The network may help PHOENIX decide *what to investigate*. It never decides *what code to execute* on another user's machine.
