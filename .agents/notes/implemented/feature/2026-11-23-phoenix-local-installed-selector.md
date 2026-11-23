# Agent Note: Select installed Phoenix Local artifacts in the chat menu

Status: implemented

## Problem

The generic local adapter row hides actual installed models and forces users into Settings to switch between them.

## Decision

Project the Host inventory into concrete local rows. Verify and activate the chosen artifact through the local Host remote with an installed-only flag, never downloading weights implicitly. The stable local adapter remains the wire route. Use the official product emblem for the group and packaged family marks for local models.

## Alternatives considered

**Expose uninstalled catalog models.** Rejected because selecting a model from chat must not initiate a download.

**Independent runtime per session.** Deferred because the existing local runtime is a shared Host service and GGUF processes have a single lifecycle owner.

## Consequences

The chat picker displays the active model and installed alternatives without navigating to Settings. Local runtime selection remains shared across sessions. Cloud selection behavior is unchanged.
