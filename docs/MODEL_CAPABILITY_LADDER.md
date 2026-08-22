# PHOENIX Model Capability Ladder

PHOENIX does not use a single universal model leaderboard to decide authority. A model can be excellent at coding and poor at orchestration, or excellent at critique and inefficient at routine execution. Collective Evolution therefore assigns work from a multidimensional, evidence-backed ranking.

## Lifecycle of a new model

```text
provider discovery
      ↓
PROVISIONAL
      ↓
short capability exam
      ↓
planning / orchestration / reasoning / coding / debugging
research / tool use / critique / judging / security / reliability / efficiency
      ↓
role-specific scores + confidence + sample count
      ↓
QUALIFIED for roles it actually earned
      ↓
continuous live + collective evidence
      ↓
rank can rise or fall
```

A discovered model is never granted command merely because the provider calls it frontier or because it is newer than existing models.

## Role-specific authority

The current roles are:

- `orchestrator`: highest authority gate. Requires strong orchestration, planning, reasoning and reliability plus high confidence/sample count.
- `judge`: independent evaluation authority. Requires judging, critique, reasoning and reliability, with security/research support.
- `builder`: coding/debugging/tool-use specialist.
- `analyst`: reasoning/research/planning specialist.
- `critic`: adversarial critique/security/debugging specialist.
- `reproducer`: deterministic reproduction/tool/debugging specialist.
- `benchmark`: reliability/efficiency measurement specialist.
- `observer`: low-authority evidence contribution.

If no model clears a command gate, PHOENIX leaves the role unfilled. It does not lower the threshold merely to form a cell.

## Evidence weighting

Scores are built from PHOENIX evidence, not marketing labels. Evidence records include:

- dimension score;
- success rate;
- reproducibility;
- sample count;
- fresh-token use and latency when available;
- timestamp;
- source: benchmark, live workload, or collective reproduction.

Recent reproducible collective evidence receives strong weight. Older evidence decays so a formerly strong model cannot retain authority forever if newer execution data shows regressions.

## Collective Evolution integration

`RankedEvolutionCellCoordinator` forms a temporary evolution cell in this order:

1. choose an explicit orchestrator that clears the command authority gate;
2. allocate contributor roles by the model ranking for each specific role;
3. select judges only from independently qualified judge models;
4. exclude the orchestrator and contributor nodes from judging;
5. exclude a judge model if that same model family instance was used to contribute to the candidate;
6. fail closed when enough qualified independent judges do not exist.

This prevents a weak model from commanding stronger models and prevents the model that helped build a challenger from certifying its own work.

## Ranking is dynamic

The ladder is intentionally non-static. Every model can move as PHOENIX accumulates evidence. New models enter provisional, established models can be demoted by regressions, and specialist models can rank #1 for one role while remaining ineligible for another.

The desired invariant is:

> Authority follows demonstrated capability for the exact role, not provider reputation, parameter count, price, popularity, or model age.
