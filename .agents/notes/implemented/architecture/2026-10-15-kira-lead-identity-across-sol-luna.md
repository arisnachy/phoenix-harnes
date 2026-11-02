# Stable Kira Lead identity across Phoenix Auto's Sol and Luna routes

## Observed failure

A real Kira ☀ Sol answer began "Kira, la ruta más directa es...", giving instructions to Kira instead of speaking as her. The `AUTO_SOL_STRATEGY_POLICY` explicitly told the same Lead agent "You are Sol 6.1 consulted by Kira" even though the turn belongs to the **Kira** lead session. This caused identity drift during strategic rescue. The initial plan and resume handoffs also described Kira as a distinct actor.

## Fix

Keep the existing exact Sol-low planning, Sol rescue, and Luna-Max execution routes. In every model-facing policy and resume handoff, assert that **Kira is the single speaking Lead identity**, including Sol planning/rescue. Sol and Luna are internal models, not role-played colleagues. Write first-person messages to the user; do not address "Kira, ..." or narrate what she should do as another person. The shipped standard and Kira Max personas express the same invariant. Real Team specialists retain their own names and dialogs.

## Regression coverage

Existing keyless tests inspect the actual `system-prompt/assemble` Sol strategy, initial plan, Luna coordination, and `agent/turn-stopping` rescue handoff; updated assertions reject the former Sol-as-separate-speaker contract. The CLI Kira Max composition regression verifies the same stable identity instructions.

## Proof limits

These are deterministic prompt/route checks. They do not prove every model output will obey first person; validate the live Phoenix chat in both phases. Model-selection routing, concurrency, quotas, and authorizations were not changed.
