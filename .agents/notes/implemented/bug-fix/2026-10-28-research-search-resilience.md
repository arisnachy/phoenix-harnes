# Agent Note: Recover institutional research leads without retry loops

Status: implemented

English | [中文](2026-10-28-research-search-resilience.zh.md)

## Problem

The keyless Bing and DuckDuckGo search provider relied on fixed HTML attribute ordering and rejected DuckDuckGo redirect URLs instead of recovering their original destinations. Long natural-language questions about theses, doctoral dissertations, and bibliographic requirements could also fall through to a generic research category. When every search failed, the research tool raised one generic exception, discarding the number of failed queries and leaving agents little information to decide when to stop.

## Decision

The HTML provider extracts result anchors independently of attribute order, accepts results with no snippet, and unwraps DuckDuckGo `uddg` redirects only when they originate from DuckDuckGo. The research planner routes thesis and postgraduate regulations to an academic category and uses shorter university-scoped searches while preserving the original broad question. The research tool excludes obvious off-topic academic hits, returns explicit zero-source and failed-query outcomes when searches are unavailable, and instructs agents to stop equivalent retries and report evidence gaps. Sources remain unverified leads until their primary documents are read.

## Alternatives considered

**Keep relying on fixed HTML regexes.** Rejected because one missing snippet or reordered attribute could hide a valid academic source.

**Treat all universities and thesis requirements as general web search.** Rejected because institutional guidance demands direct university documents and explicitly scoped queries.

**Retry alternate public HTML search engines indefinitely.** Rejected because anti-bot restrictions and blocked institutional pages need a clear partial outcome instead of repeated searches consuming time and context.

**Infer reference counts from search snippets.** Rejected because a local academic guideline does not establish a universal minimum for all qualifications.

## Consequences

Free search still depends on third-party HTML and cannot promise availability. Academic relevance checks may omit a legitimate page with an uninformative title; broader discovery and direct university URLs remain valid alternatives. The result now exposes missing evidence without inventing citations, and the bounded query plan preserves normal behavior outside academic research.

## Testing

Unit coverage exercises result HTML with optional snippets, DuckDuckGo redirect recovery, academic domain routing, irrelevant search hits, and a completely unavailable provider.
