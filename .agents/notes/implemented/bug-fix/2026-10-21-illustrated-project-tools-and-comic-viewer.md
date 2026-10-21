# Agent Note: Illustrated project tools and nested comic viewer

Status: implemented

English | [中文](2026-10-21-illustrated-project-tools-and-comic-viewer.zh.md)

## Problem

A resumed comic request mentioning generated illustrations activated a standalone-image preference that hid filesystem, assembly and publication tools. Successful image calls retained that restriction until idle. Separately, the comic publisher omitted nested presentation metadata, so Code Mode could report publication without delivering the reader artifact to the client.

## Decision

Illustrated projects retain the complete permitted catalog; standalone image requests keep native image precedence until the first attempt settles. New user instructions replace that preference. The comic publisher opts into durable nested artifact metadata, matching map publishers. Existing structural checks, workspace confinement and static iframe permissions remain enforced.

Comic artifacts also expose the existing expanded reader controls and download self-contained HTML with a `.html` extension and a static Content Security Policy, so inline handlers cannot become executable merely by opening the saved edition outside the iframe. Ordinary application HTML retains its existing inline presentation.

## Consequences

The agent can inspect and resume projects before generating missing art, integrate successful images and publish reader artifacts from Code Mode. The keyless browser scenario executes the real worker and publishers, persists their results and opens the comic and map viewers using explicitly synthetic artwork and geographic data. It does not certify artistic quality or a remote image provider.

## Alternatives considered

Adding more prompt instructions cannot restore hidden tools or missing artifact metadata. Removing native-image preference entirely would discard standalone-image routing. Replacing the existing viewers would not repair either causal failure.
