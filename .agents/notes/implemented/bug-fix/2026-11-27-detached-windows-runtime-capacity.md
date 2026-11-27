# Agent Note: Keep isolated updates moving past one detached runtime

Status: implemented

## Problem

Windows can retain an obsolete runtime directory after Git removes its worktree registration. With the default two-directory capacity, a healthy Host and one locked directory can prevent every isolated update.

## Decision

When the default per-checkout limit is reached during a supervised Windows update, reserve one candidate slot if exactly one local managed directory has no Git registration, no Git metadata, and no keep marker. The recorded healthy Host must still occupy a registered slot. Both preparation and activation check the reserve. Disk headroom, shared capacity and explicit limits apply independently.

## Alternatives considered

Raising all caps would admit unrelated runtime growth. Trying to close arbitrary Windows file handles would risk disrupting other applications. Retry cleanup remains eligible for the detached directory.

## Consequences

One detached directory can coexist with the active runtime and one candidate under the default policy. Additional detached directories block the reserve, and the shared cap bounds total directory growth.
