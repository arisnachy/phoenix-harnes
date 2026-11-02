# Architecture

- Model configuration: settings UI -> host settings/credentials API -> `llm-pi-ai` provider catalog and discovery.
- Authentication: authorization capability -> `llm-pi-ai` login session -> OAuth browser/device flow -> credential store.
- Updates: fetch into quarantine ref -> inspect diff -> identity/security/Windows gates -> human/KIRA approval -> promotion -> signed application update.
- Evolution: request -> isolated lab/worktree -> evaluation evidence -> frozen versioned capability -> explicit activation.
- Memory: consented profile facts with provenance, visibility, edit/delete controls, and local protection.

## Provider-neutral KIRA routing

KIRA roles are capability labels, not model ids. A deployment maps named
profiles such as `fast`, `builder`, or `judge` to any configured
`provider/model` route. The roster reports the subagent transport separately
from the LLM provider and model.

A fresh JUDGE using the Lead's same provider and model is operationally
independent but cognitively correlated. KIRA records that limit and never
claims independent-model review. Different names, prompts, or contexts do not
establish model independence. Profile routes are allowlisted configuration;
model-authored arbitrary routes do not authorize account spend.
