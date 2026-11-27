# Agent Note: Windows local accelerator provisioning pilot

Status: implemented

English | [中文](2026-11-27-local-accelerator-provisioning-pilot.zh.md)

## Problem

Phoenix Local ships a CPU-only managed runtime even when compatible accelerators are available. Installing every accelerator and benchmarking without resource checks can exhaust storage or interfere with local inference.

## Decision

The successful managed PowerShell update launches a detached, user-scoped provisioning worker for llama.cpp b10964. It detects healthy PCI graphics adapters, stages compatible candidates under PHOENIX_HOME (default ~/.phoenix), verifies pinned SHA-256 digests, and requires compute-device enumeration. For an installed managed GGUF selected in on-demand mode, with no observed local inference process, the worker compares the installed CPU runtime and compatible candidates using 256 prompt tokens, 64 generation tokens, three repetitions, and requested 8/16/99 GPU layers. It checks free RAM before each benchmark and bounds each subprocess to two minutes. Without a CPU baseline, provisioning stops at the first usable candidate.

The ranking rejects GPU measurements without positive layer-offload diagnostics and retains CPU unless the estimated workload speedup is at least 1.10. Partial comparisons are marked incomplete. Set PHOENIX_LOCAL_ACCELERATOR_AUTOINSTALL=0 to disable provisioning. Status and installer.log are under local-models/accelerators/b10964; node scripts/phoenix-local-accelerators.mjs --status reads the last recorded result.

## Alternatives considered

**Choose the first enumerated accelerator.** Device enumeration does not establish speed, so calibration compares equivalent workloads instead.

**Replace the CPU runtime during updates.** Rejected to preserve the existing working inference path while validation remains outstanding.

## Consequences

No system drivers are installed. Model files, Ollama, Orión and the active inference runtime remain unchanged. Calibration results are not yet consumed by the production manager. A process check does not guarantee exclusivity against a concurrent launch, and a crashed worker may leave a lock requiring verified manual cleanup. Windows archive extraction, actual device use, benchmark diagnostics, memory safety, production lifecycle integration and CPU fallback during inference remain release gates.
