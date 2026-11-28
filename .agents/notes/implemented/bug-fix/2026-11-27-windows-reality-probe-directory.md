# Agent Note: Keep Windows probe working directories outside runtimes

Status: implemented

## Problem

A PowerShell thermal probe and an input-idle probe outlived their original Phoenix Host. Both inherited the Host runtime as their working directory. Windows held that directory open after Git removed its registration and the runtime counted against the update quota.

## Decision

Give native Windows Reality Context probes an explicit working directory in the user home. The probes resolve executables through their existing absolute paths and keep their current timeouts.

## Alternatives considered

Runtime cleanup cannot release a directory handle held by a surviving process. Terminating arbitrary subprocesses based on a directory name could affect another application.

## Consequences

A surviving probe no longer pins the retired Host's runtime through its working directory.
