# Agent Note: Durable Canva-aware visual production without fake exports

Status: implemented

[English](2026-10-20-phoenix-design-intelligence.md) | [中文](2026-10-20-phoenix-design-intelligence.zh.md)

## Problem

Visual production had no single durable receipt distinguishing an MCP generation request from an existing Canva design or an exported file. Canva capabilities also vary by account and exposed tool list. Treating a Canva link as a finished PDF could mislead the user and lose work after an interruption.

## Decision

A zero-dependency CLI at scripts/phoenix-design-intelligence.mjs classifies design intent, inspects a small secret-free MCP inventory, and stores a durable mission record. The CLI records valid Canva design identifiers and URLs separately from copied export files. Each exported file has an extension, a file signature check, a byte count and SHA-256; a later inspection detects missing or altered copies.

Kira uses the discoverable phoenix-design-intelligence skill to call the actual MCP tools. It can also use authorized local generation and export alternatives. Existing comic, editorial, research and business engines retain control of narrative continuity, source data, publication and licensing. The CLI does not modify the agent loop, invoke Canva APIs or pretend to supply a missing export tool.

## Alternatives considered

**Build an isolated Canva-only product engine.** Rejected because it would duplicate book, comic, course and business production and weaken universal task routing.

**Treat ready connectors as full authorization.** Rejected because server readiness says nothing about specific permissions, Pro entitlements, credits or licensing.

**Mark a Canva URL as a downloadable file.** Rejected because links, asynchronous jobs and actual local files provide different evidence.

## Consequences

Design work now has an auditable, resumable mission identifier, capability-driven plans and genuine file-integrity receipts without committing credentials or spending money. The visual quality, content semantics, Canva access, premium quota, complete export validation, publishing rights and live E2E tests remain separate checks. A signature-valid PDF is not certified print-ready and the plan is not itself an MCP execution.
