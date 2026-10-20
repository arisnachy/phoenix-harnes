# Phoenix Design Intelligence — integration without claiming remote completion

## Decision

Add a narrow CLI-backed, durable visual job ledger plus a discoverable Kira skill. Reuse the existing MCP inventory and any genuinely exposed Canva tools rather than creating a fake Canva API client or modifying the universal agent loop. Keep visual work composable with book, comic, research, course and business engines.

## Why

Visual creation was previously an informal instruction. A returned Canva link, an asynchronous generation job and an exported PDF were easily conflated. A durable job ID with explicit statuses makes recovery and accurate deliverable reporting possible. The source engines remain responsible for character canon, manuscript content, scientific evidence, and product rights.

## Alternatives rejected

- A separate full publishing or comic engine tightly coupled to Canva: would duplicate existing durable engines and break universal routing.
- Pretend an export API is available because Canva supports export elsewhere: the active MCP tool list may not expose it.
- Treat ready or a listed tool as proof of authorization or premium entitlement.
- Mark a generated design or file signature as proof of publication, graphic quality or commercial licensing.

## Delivered components

scripts/phoenix-design-intelligence.mjs implements planning and verifiable file receipts. .agents/skills/phoenix-design-intelligence/SKILL.md provides Kira's workflow. docs/phoenix-design-intelligence.md documents CLI expectations and remaining live integrations. The components use the existing MCP/skill system.

## Limitations and verification

The CLI does not execute Canva jobs. Genuine E2E success still depends on host authorization, reachable MCP operations, Canva quotas, previews, and a viable export method. Run the standalone Node tests and a live design/export smoke on Windows; do not claim full production readiness from the unit tests alone.
