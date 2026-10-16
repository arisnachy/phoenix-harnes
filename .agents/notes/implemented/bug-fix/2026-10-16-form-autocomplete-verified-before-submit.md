# Agent Note: Verify committed autocomplete selections before browser form submission

Status: implemented

English | [中文](2026-10-16-form-autocomplete-verified-before-submit.zh.md)

## Problem

A browser form can keep an autocomplete draft in its input without committing any selected tag. Checking only the input value reports a false success; subsequent submission shows an empty choice. The agent then retries keyboard and mouse actions, repeats the submit, and spends many model turns reporting progress rather than finishing.

## Decision

The structured browser interaction matcher honors CSS selectors together with exact text, so a named suggestion button can be distinguished from the matching draft input or other controls. A `verify_form` call may compare the expected text of a uniquely selected, visible non-input element, such as the committed autocomplete tag. Kira Max's shipped instructions require that selected tag verification precede submission, cap distinct no-progress correction attempts at two, and prohibit autonomous resubmission after receiving a summary. Browser actions retain the existing permission gate.

## Alternatives considered

**Trust the autocomplete input value.** A populated input is not evidence that the widget's selected-option state changed.

**Repeat keyboard and mouse guesses until the summary changes.** Indefinite retries can interact with elements behind an overlay, multiply submissions, and waste model requests.

**Disable autocomplete tests.** This evades the discrepancy instead of making the automated result complete and verifiable.

## Consequences

The form agent can target a suggestion using both CSS and exact text, and verify a selected chip instead of a draft. A form with an unconfirmed option remains incomplete, even if other inputs pass verification. The agent reports the unresolved field after bounded attempts rather than submitting repeatedly. Generic DOM verification cannot prove the internal state of inaccessible cross-origin or native widgets; those remain explicit limitations. On-site timing and model adherence still require live acceptance testing.

## Testing

A keyless DOM test creates an autocomplete input with a draft matching a button label and a separate committed tag. The pre-click tag verification fails, the selector-and-text click chooses exactly one button, and the post-click tag verification succeeds.
