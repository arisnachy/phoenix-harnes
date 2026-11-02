# Agent Note: Image generation exposes a reusable local raster path

Status: implemented

English | [中文](2026-09-03-image-generation-local-path.zh.md)

## Problem

`image_generation` copied the generated raster into the durable attachment store and returned an attachment reference, but the model-facing result did not include a local path. A later model step could see the image result yet could not reopen the generated file with `read_image` or select it explicitly for another local artifact.

## Decision

The successful result now includes the absolute path of the verified raster alongside its durable attachment reference. The output schema, rendered model envelope, and artifact presentation metadata all carry that path. `CODEX_HOME` is resolved to an absolute path before the generated-image directory is inspected.

## Alternatives considered

**Return only the attachment reference.** Rejected because opaque attachment ids are correct for durable history but do not give a model-facing filesystem tool a path to reopen.

**Copy generated rasters into the repository workspace.** Rejected because it creates unrequested project files and can pollute a checkout; the Codex-generated file is already local and the absolute path is sufficient for the local filesystem capability.

## Consequences

The model can pass the returned path to `read_image` on a later step, while the attachment remains the durable source for session replay and provider requests. The path is host-local metadata, not a public URL or credential. Focused tests verify both the path and the durable attachment result.
