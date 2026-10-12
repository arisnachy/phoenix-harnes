---
name: hackathon-autopilot
description: >-
  Use when entering, building for, resuming, judging, recording a demo for, or submitting a hackathon/Devpost competition.
  Covers event discovery, rules, judging criteria, project planning, implementation, QA, deployment, screenshots,
  demo video, natural English narration, evidence, Devpost copy, and verified submission.
---

# Hackathon Autopilot

Own the competition as one durable mission from event selection through verified submission. Do not treat Devpost as a form-filling afterthought: optimize the product, evidence, demo, and copy against the event's live rules and judging criteria.

## Establish the battle kit

Before relying on a connector, verify it with `connector_list` using the specific target. Never infer readiness from a catalog card.

Core routes:

- **Devpost:** if no relevant ready connector exists, call `connector_install` with `connectorId=devpost`; Phoenix uses its pinned official endpoint and asks for one-shot approval. Re-run `connector_list` and complete provider authorization if it reports `auth-required`.
- **GitHub:** reuse a ready GitHub route. If none exists, use `connector_discover` for the official GitHub MCP identity and install only an eligible verified registry result with approval. Never execute an arbitrary GitHub MCP repository.
- **Deployment:** prefer an already connected Vercel/Firebase/Cloud provider that matches the project. A missing hosted connector does not block a runnable local build.
- **Design:** prefer connected Canva for thumbnails, diagrams, presentation/video assets. Use `image_generation` and local artifact tools when Canva is unavailable.
- **Narration/video:** use connected HeyGen when it materially improves voice-over/video quality. It is optional. Preserve a local route using real screen evidence, generated/local assets and FFmpeg or another already available media tool; do not install a heavyweight editor just to complete a demo.
- **Evidence/quality:** use PostHog/Sentry only when already relevant to the project. Do not add analytics or observability solely to make the connector list look complete.

Record readiness and gaps in `HACKATHON_PLAN.md`. Connector absence is a capability gap, not a reason to invent results.

## Read the competition before building

Use the live Devpost tools exposed by the connected MCP for the selected event. Gather only what is needed: overview, registration state, dates, announcements, rules, prizes/tracks, submission requirements and judging criteria. Devpost is authoritative for event facts.

Create or update `HACKATHON_PLAN.md` with:

- event and deadline;
- chosen track/category;
- judging criteria and their weights when available;
- product thesis and differentiator;
- acceptance criteria;
- architecture/build plan;
- deployment target;
- demo/video limit and required assets;
- evidence matrix mapping every judging criterion to implementation proof;
- reverse schedule with feature freeze, QA, deploy, video, final review and submission buffer.

If registration or acceptance of event terms is a real write/contractual action, show exactly what will be submitted and require explicit human confirmation before doing it.

## Build for judging, not for a checklist

Keep the actual product runnable throughout development. Kira owns the critical path and may use one specialist normally and a second only for an independent front that shortens delivery.

For every material claim, collect evidence:

| Claim | Build proof | Runtime proof | Demo proof |
|---|---|---|---|
| What the project does | source/commit | executed result | scene/timestamp |
| Technical differentiator | architecture/code | test/log | explanation |
| User impact | implemented workflow | observable outcome | screenshot/demo |

Do not promise a feature in the submission unless the final build demonstrates it.

Before media production, require a release candidate: build/tests pass, main flows work, public demo (when required) is reachable, secrets are not exposed, and the visible UX has been reviewed on the applicable desktop/mobile targets.

## Demo Studio

Make the video about the working product, not about slides.

1. Read the event's video requirements and duration.
2. Write `DEMO_SCRIPT.md` with timed scenes: problem, product in action, differentiator, technical proof, impact, close.
3. Capture the real application executing the strongest judge-relevant workflow. Prefer direct screen/browser recording when available; otherwise capture fresh runtime screenshots/clips and compose a truthful demonstration.
4. Write the narration in natural spoken English, not literal translation. Keep sentences short, active and judge-oriented. Verify product names and technical pronunciation.
5. Produce human-sounding voice-over with the best connected route. Prefer HeyGen when connected; otherwise use Phoenix/local neural voice. Never claim a premium voice was used when it was not.
6. Assemble with the lightest available media pipeline. FFmpeg is preferred when already installed. Add captions, readable title cards, restrained zoom/highlights and normalized audio. Avoid decorative effects that hide the product.
7. Export a final MP4 and inspect it end to end. Check duration, audio intelligibility, captions, scene order, stale UI, private data, broken interactions and factual claims.

Keep media under a predictable folder such as `hackathon/video/` with the master video, narration text/audio, captions and scene manifest.

## Judge Mode

Before submission, switch from builder to adversarial evaluator. Score only against the live event criteria. For every criterion report:

- score and confidence;
- exact evidence;
- the biggest point loss;
- one highest-leverage repair.

Repair material weaknesses and re-run only the invalidated checks. A self-awarded score is not proof; concrete runtime evidence is.

## Submission packet

Prepare the final project page from evidence, not aspiration. Include the requested title/tagline, problem, solution, implementation, architecture, AI usage, testing instructions, repository/demo links, screenshots/thumbnail, video URL or required upload, credits and any sponsor-specific answers.

Run a secret scan before publishing a repository or final submission. Never paste secret values into chat or generated files.

The final Devpost submission is consequential. Show a short summary of exactly what will be submitted and require an explicit confirmation such as “yes, submit” before the real submit call. After submission, read the project back from Devpost and report success only when live state verifies it; otherwise report verification pending or failed.

## Completion gate

The mission is complete only when all mandatory event requirements are satisfied, the final build and demo have been reviewed, the evidence matrix contains no unsupported material claims, and Devpost reports the project submitted. If an external auth, verification, upload or human agreement blocks progress, persist the exact blocker and continue every safe independent task.
