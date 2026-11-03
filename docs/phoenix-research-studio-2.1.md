# Phoenix Research Studio 2.1 — master implementation plan

English | [中文](phoenix-research-studio-2.1.zh.md)

This is the implementation contract for verifiable scientific research, document publishing, automatic browser observation, and authorized delivery. It extends Phoenix Universal 3.0 and UME without replacing existing governed tools. A plan is not proof of implemented capability.

## Completion and evidence

- Brief factual questions receive cited chat answers without unnecessary files; in-depth research and academic document requests require a readable on-screen report plus actual verified files in the requested formats.
- Scientific completion requires source-to-claim provenance, accurate dates, research limitations, a validated document, and genuine paths/openable download links; a textual claim or invented receipt is never sufficient.
- Track report status independently from email and Telegram delivery status: REPORT_READY does not imply SENT, ACCEPTED does not imply read, and a failed channel does not erase a valid report.
- Preserve the original user objective, approvals, mission checkpoints, artifacts, and receipts across Sol/Luna handoffs, restarts, and retry recovery.

## Browser and conversation experience

- The live MiniBrowser activity sidecar must automatically follow the newest agent message, including incremental streaming and resize, independently of the main ChatView scrollport.
- Manual reader scrolling disables follow until the reader returns near the bottom or activates a clearly labelled return-to-latest action. Never steal keyboard focus or page interaction.
- Prefer the existing Chrome/CDP DOM tools, screenshots, video frame inspection, public captions, and accessible in-page audio capture automatically before asking for help.
- Chrome getDisplayMedia tab, window, screen, and audio selection requires real user approval through the native chooser. Do not counterfeit gestures, remove permission dialogs, or silently record external tabs.
- When page rendering fails for PDF, XML/JATS, or scholarly HTML, offer a supported reader/extractor and visible error, not a blank view represented as proof of reading.

## Research project and evidence workflow

- Persist a project record containing the question, scope, method, search queries and timestamps, authorized sources, bibliography, evidence assertions, draft sections, data, figures, format profile, deliverable files, and channel preferences.
- Route to appropriate connected primary sources such as PubMed, Europe PMC, ClinicalTrials.gov, Crossref, OpenAlex, official government and sports feeds; registry candidates must never masquerade as authenticated API connections.
- Deduplicate DOI/PMID/URL identities; record whether an assertion comes from full text, abstract, metadata, primary data, or an unverified search snippet.
- Extract study design, sample, outcome, methods, conflicts, limitations, and retraction status only from real available material. Never fabricate a cohort, effect size, statistical significance, selection count, or scientific citation.
- Support narrative, systematic, and scoping reviews, research protocols, meta-analyses with adequate data, clinical and policy reports, journal manuscripts, monographs, and theses.
- Apply PRISMA, STROBE, CONSORT, or discipline-specific reporting requirements only when the corresponding procedures and verified data were actually performed.

## Document model and scholarly output

- Create one durable structured report model with sections, traceable claims, references, dataset references, figures, table captions, footnotes, layout metadata, and optional attachments.
- Support APA 7, Vancouver/ICMJE, and institution-specific rules, with consistent citation and bibliography reflow. DOI/PMID/author/title/year verification must fail visibly on mismatches.
- Export a genuinely editable DOCX, a print-tested PDF, and a faithful accessible HTML chat preview from the same validated model. Do not promise DOCX/PDF where no installed renderer exists.
- Generate matrices and quantitative figures only from reproducible datasets, with labels, units, provenance, methodology, and figure numbers; never decorate reports with invented charts.
- Validate file existence, parseability, page margins, clipped tables, broken images, bibliography cross-links, and readability before the REPORT_READY transition.

## Institution cover designer

- Permit user upload of an approved original institutional logo, editable institution/faculty/department, author, lecturer, course, date, program, and academic title.
- Offer reusable profiles for student APA, professional APA, biomedical Vancouver, university thesis, and custom institutional variants.
- Provide live cover preview with Letter/A4 page size, margins, pagination, front matter, and predictable DOCX/PDF rendering.
- Never invent logos, author identities, or academic affiliations; preserve personal information only in the project authorized for that purpose.

## Delivery Hub: Phoenix, email, Telegram

- Show the full reading view, executive summary, citations, and actual DOCX/PDF file actions in Phoenix before or independently of any external delivery.
- Use the existing authorized Kira AgentMail mailbox if active; verify the recipient, sender state, and whether the actual provider interface supports file attachments. Text-only send cannot count as an attached report.
- Use Telegram only after its bot token, chat destination, sending tool, and authorization have been confirmed. Never infer that a previously mentioned bot is currently connected.
- Support user preferences: Phoenix only, email, Telegram, both, and per-project approval. External sending must respect scoped consent and enhanced privacy requirements for sensitive reports.
- Queue provider deliveries with durable idempotency keys to avoid repeat sends after crashes, retries, or model switches.
- Record each channel outcome independently with provider message ID, attachment/link evidence, timestamps, and explicit RETRYABLE_FAILURE/BLOCKED states.
- For large documents, use a permissioned access link with expiration and appropriate access controls; never leak localhost URLs or unrestricted private file paths.

## Efficiency, model routing, and recovery

- Reuse validated source records, article content, citations, and intermediate section drafts across a project instead of re-fetching or re-sending whole documents to an LLM.
- Bound searches, screenshots, retries, extracted text, model context, concurrency, and per-source costs without reducing required scientific quality.
- Instrument actual wall time, provider calls, search queries, token input/output, cache hits, research coverage, validation errors, and delivery receipt states.
- Kira remains lead; use Sol for necessary planning/repair and bounded Luna specialists only when genuine independent subtasks justify them. Do not duplicate the whole mission for each agent.
- Recover from interrupted research using persisted checkpoints; verify already produced artifacts and resend only deliveries whose provider receipt proves no completed transmission.

## Implementation phases

1. Fix live activity pane scroll-follow, user override, browser-first video/audio inspection, and explicit native sharing fallback.
2. Build durable research projects, verified scholarly ingestion, deduplication, and source-to-claim evidence matrix.
3. Add semantic reference management, APA/Vancouver formatting, academic manuscript composer, figures, and cover editor.
4. Implement checked DOCX, PDF, and HTML output through real installed file renderers and register genuine artifacts in ui-deliverables.
5. Integrate authorized AgentMail attachments and Telegram document delivery with user preferences, provider receipts, and resilient idempotent jobs.
6. Optimize and regression-test end to end; publish exact green commit into main and align stable only after Phoenix main guard succeeds.

## Mandatory acceptance demonstration

- Run one cross-domain sports, official Dominican peso exchange rate, and neuroscience literature investigation, preserving source dates and disagreements.
- Ensure the running MiniBrowser activity pane follows streaming agent prose but respects reader scrolling.
- Verify Kira attempts permitted automatic YouTube observation before showing a manual Chrome capture fallback.
- Produce a readable research narrative in the chat, with original references and explicit methodology and limitations.
- Produce and reopen a real editable DOCX and a real printable PDF; include only appropriate data-backed tables or charts.
- Render the user-selected institutional cover and logo without corrupting layout or bibliography.
- Demonstrate user-authorized email and Telegram delivery with distinct genuine provider receipts or honest blocked statuses.
- Interrupt and resume the mission and verify no duplicated emails, Telegram messages, sources, or expensive work.
- Report evidence, risk, duration, real resource usage, and status per acceptance gate; never claim a complete scientific suite when a phase remains unimplemented.

## Current implementation boundary

- Implemented: the live browser sidecar follows streaming conversation; research_search remains bounded federated web search, and research_scholar retrieves live publication metadata from the official Europe PMC API.
- Implemented: phoenix_research_publish produces and opens real DOCX/PDF/HTML documents from a structured claim-to-source manuscript; it keeps the project JSON, supports APA/Vancouver citations, a supplied institution logo, and data-backed bar figures. Publication does NOT independently prove the correctness of source metadata or research methods.
- Implemented code: phoenix_research_deliver uses native approval, a verified Kira mailbox or paired owner Telegram chat, actual provider APIs, independently recorded outcomes, and no blind retries. Live end-to-end owner-account delivery remains unverified until the user's services authenticate and confirm receipts. A full interactive cover designer, general-purpose data extraction and systematic-review engine, and complete cross-model research mission orchestration remain pending.
