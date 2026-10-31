# Agent Note: Compact moments with contextual visual variety

Status: implemented

English | [中文](2026-10-31-compact-moments-variety.zh.md)

## Problem

PHOENIX already recognizes a few dates, but most occasions have no offline fallback. Three apparent badge variations change little more than the border. Large banners, notifications and popups would obstruct the conversation, particularly on smaller displays.

## Decision

The consent-gated user-profile calendar remains the owner of occasion facts. Its international fixed-date observances and limited offline Dominican fallback are expanded, with deterministic rules for Dominican Mother's and Father's days and United States Thanksgiving. The existing Nager.Date country/year public-holiday lookup continues to supply broader country-specific holidays and remains non-exhaustive. Personal dates keep precedence, and solemn dates retain a restrained presentation.

The browser shell shows only a narrow seasonal badge alongside existing controls. Four appearance variants can be cycled by clicking it; occasion-specific motifs use the existing theme tokens with small local accents. Neither the chat layout nor Kira's avatar identity is changed. The profile service may expose factual context to Kira only with consent. It never inserts prewritten messages or scheduled greetings.

## Alternatives considered

**Show a seasonal banner or permanent calendar panel.** Rejected because its visual footprint competes with the user's work and requires layout changes.

**Fetch a complete worldwide event database with personal details.** Rejected because coverage cannot be guaranteed and uploading private dates would be unnecessary. The country-only public calendar is a supplement.

**Generate automated celebratory chat messages.** Rejected because they are repetitive and may be inappropriate for solemn or culturally irrelevant observances.

## Consequences

The decoration is identifiable without overpowering the light PHOENIX UI, and users can try alternate presentations without changing global appearance preferences. Cultural listings are informational, not assertions that a user celebrates a date. Country-specific religious, municipal, regional and lunar calendars remain incomplete without further authoritative data sources. Unit tests pin consent, civil-time-zone behavior, priority, presentation themes and known movable dates.
