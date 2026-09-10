# Agent Note: Packaged capability dependencies

Status: implemented

English | [中文](2026-09-07-packaged-capability-dependencies.zh.md)

## Problem

Workspace source resolution can hide dependencies missing from deploy manifests. Shipped presets reference HARDNESS adapters and session learning, the base bundle mounts the MCP connector registry, and conversation components import session and approval services without declaring all required installation relationships.

## Decision

The Python runtime carrier declares the preset plugins and their required workspace peers, including the host services required by HARDNESS adapters. The base bundle declares its configured registry plugin. Conversation declares session and user-approval as matching peer and development dependencies with TypeScript project references.

Session learning builds its declared `./ledger` export as an independent entry, and package constraints retain that public runtime file. Static unused-code analysis names the actual YAML-loaded Python provider and memory fixture, and recognizes Codex as an external executable. Vendored publication metadata identifies PHOENIX's patched source while the vendor manifest preserves upstream provenance.

## Verification

Runtime closure, Cordis configuration and client-package checks validate these relationships. A full build and built-artifact checks remain required for publication; a closed dependency graph alone does not establish runtime behavior.

## Alternatives considered

- Remove capabilities from presets: hides missing installation relationships by reducing available functionality.
- Enable implicit peer installation: makes the deployed closure dependent on package-manager inference.
- Mark required peers optional: permits incomplete installations that fail when used.

## Consequences

The carrier includes more host packages because the existing adapters require them. Splitting host-specific adapters may reduce installation size later, but is separate from supplying the dependencies required by the shipped presets.
