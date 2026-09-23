# Agent Note: Resolve issue policy references only during review

Status: implemented

English | [中文](2026-09-23-lazy-issue-policy-resolution.zh.md)

## Problem

The pull request policy applies only after a human pull request has a requested review or a submitted review. The workflow nevertheless resolved linked issues before checking that condition, so an unreviewed pull request could fail on issue-field or Project API calls that were outside the active policy.

## Decision

The pull request snapshot reads the pull request, requested reviewers, and reviews first. When `requiresPullRequestPolicy` is false, it returns empty issue references and an empty issue map without calling issue or Project endpoints. Once review begins, it resolves and validates linked issues as before. Pull request lifecycle events keep their independent issue-status projection.

## Alternatives considered

**Resolve every linked issue for every pull request.** Rejected because the policy is inactive before human review, and those extra calls can fail before the workflow reaches its existing policy guard.

**Treat issue-field or Project API failures as empty metadata.** Rejected because it would hide a real configuration or API failure when the policy is active.

## Consequences

Unreviewed pull requests no longer depend on linked issue fields or Project access. The first review request or submitted review still activates the same issue validation and reports its API failures. A mocked API test verifies that the inactive path makes no issue or GraphQL requests.
