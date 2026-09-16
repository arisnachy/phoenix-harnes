# HARDNESS Mission Telemetry

HARDNESS exposes secret-free mission metrics derived from the durable `hardness/mission` audit rows. The in-memory observer is attached to a runner and receives the same rows after the durable audit succeeds.

The snapshot records attempts, completed and blocked missions, recovery attempts, per-step completed/blocked counts, non-negative duration count/total/maximum, and stable blocked reason counts. Replay reconstructs an equivalent snapshot from retained audit rows without retaining arguments, credentials, provider errors, or live runtime objects.

Telemetry is observational. A telemetry observer failure is contained and cannot change approval, execution, verification, judge, or terminal-state decisions. Direct runner calls without a live session still expose metrics, while production audit persistence remains owned by the calling session.

Controlled synthetic samples cover a blocked execution followed by a successful presentation, replay equivalence, reset behavior, and non-negative duration normalization. The adapter README documents the public observer and replay functions.
