# Agent Note: Windows local accelerator provisioning pilot

Status: implemented

English | [中文](2026-11-27-local-accelerator-provisioning-pilot.zh.md)

## Problem

Phoenix Local ships a CPU-only managed runtime even when compatible accelerators are available. Installing every accelerator and benchmarking without resource checks can exhaust storage or interfere with local inference.

## Decision

The successful managed PowerShell update launches a detached, user-scoped provisioning worker for llama.cpp b10964. It detects healthy PCI graphics adapters, stages compatible candidates under PHOENIX_HOME (default ~/.phoenix), verifies pinned SHA-256 digests, and requires compute-device enumeration. For an installed managed GGUF selected in on-demand mode, with no observed local inference process, the worker compares the installed CPU runtime and compatible candidates using 256 prompt tokens, 64 generation tokens, three repetitions, and requested 8/16/99 GPU layers. It checks free RAM before each benchmark and bounds each subprocess to two minutes. Without a CPU baseline, provisioning stops at the first usable candidate.

The ranking rejects GPU measurements without positive layer-offload diagnostics and retains CPU unless the estimated workload speedup is at least 1.10. Partial comparisons are marked incomplete. Set PHOENIX_LOCAL_ACCELERATOR_AUTOINSTALL=0 to disable provisioning. Status and installer.log are under local-models/accelerators/b10964; node scripts/phoenix-local-accelerators.mjs --status reads the last recorded result.

At managed GGUF startup, the Host accepts a recent calibration for the same model identity and matching pinned installation receipt. It attempts the measured layer and thread settings, then falls back to CPU when startup fails. An accelerated process exit disables that profile for subsequent starts in the current Host; in-flight turns are not replayed. The operational context is sized by total physical RAM, with a separate native maximum and explicit context override. The conservative existing free-memory admission check remains in place.

Device admission reads free and total memory from the pinned llama.cpp device inventory. Calibration selects an enumerated device and tests only layer counts admitted by conservative weight-based memory thresholds. The Host rechecks the same device and its capacity before launch, passes its explicit device name and requests Flash Attention auto and a 1024 MiB fit target for unset parameters. These thresholds are not measured peak allocations; explicitly set layer counts are not guaranteed to fit. A focused Windows CI workflow checks the policy, PowerShell syntax, and the pinned CPU binary, not physical GPU throughput.

## Alternatives considered

**Choose the first enumerated accelerator.** Device enumeration does not establish speed, so calibration compares equivalent workloads instead.

**Replace the CPU runtime during updates.** Rejected to preserve the existing working inference path while validation remains outstanding.

## Consequences

No system drivers are installed. Model files, Ollama and Orión remain unchanged. The existing active inference process is not replaced by the updater. A process check does not guarantee exclusivity against a concurrent launch, and a crashed worker may leave a lock requiring verified manual cleanup. Windows archive extraction, actual device use, benchmark diagnostics, memory safety, production startup and CPU recovery on real hardware remain release gates.
