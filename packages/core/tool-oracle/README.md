# PHOENIX ORÁCULO · Scientific prediction core

Model-facing, offline mathematical nucleus for bounded scientific forecasts and causal what-if scenarios. It **does not** claim to predict every possible future. Kira may invoke the tools after fetching evidence with existing research tools. The research and source-backed forecasting tools use the existing PHOENIX web provider. Source discovery/retrieval is not independent scientific authentication.

## Model Experience

- oracle_scientific_forecast receives a JSON object containing a required source and mode.
- free-fall calculates time for an ideal body initially at rest, ignoring drag.
- rgb-light performs explicitly linear additive RGB channel mixing, **not** pigment mixing.
- time-series takes equispaced numeric history, an integer horizon (1–30 steps), stepHours, lastObservedAt and unit; compares persistence with linear drift using walk-forward tests and an empirical 80% nominal interval. The model selection and interval are **not an independent holdout**.
- causal-scenario evaluates a user-supplied acyclic graph of linear structural equations and optionally a do-style intervention. Coefficients are **not** learned or causally identified.
- oracle_audit_prediction accepts numeric observed outcomes after the target horizon; returns an absolute error, labeled as **unverified report**, never certified truth.
- oracle_forecast_scorecard reads local append-only records.

## Example

Use oracle_scientific_forecast with inputJson:
{"mode":"time-series","source":"User-supplied daily dataset, not independently verified","values":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24],"horizonSteps":2,"stepHours":24,"lastObservedAt":"2026-11-04T00:00:00Z","unit":"count"}

## Security and scientific limits

Model-supplied sources are **not verified**; do not pass personal health records, passwords or secrets. Registry path is in the owner-local PHOENIX home, not the disposable runtime. The current MVP has an existing web-retrieval connector but **no independent prospective accuracy guarantee**, no independent primary-data authenticity certification, no causal identification from observational data, and no universal world model. Calibration measures report diagnostics only, not guaranteed performance. The observation audit is self-reported and is not an authoritative outcome until a trusted source is verified separately.

## Checks

node --experimental-strip-types --test packages/core/tool-oracle/tests/*.mjs


## Investigación universal y porcentaje fundamentado
- `oracle_research_forecast(question,targetAt)` usa el proveedor web real de PHOENIX para investigar cualquier pregunta sobre un acontecimiento futuro: aporta fuentes, fechas y tareas de verificación. No autentica fuentes ni inventa probabilidades.
- `oracle_scientific_forecast` ahora admite `mode=binary-event`: evento falsable con `question`, `targetAt`, `currentSignal`, `source` y al menos 80 casos históricos (cada uno con `id`, `observedAt`, `signal`, `happened`). Entrenamiento cronológico 70 %, prueba futura 30 %, suavizado binomial, contraste contra tasa base y Brier; se abstiene si faltan subgrupos, hay fuga temporal o no supera la referencia.
- El intervalo Wilson del 80 % mide incertidumbre de muestreo, no predicción perfecta. Todo porcentaje depende de los datos aportados, todavía **no autenticados por el motor**.
- `oracle_audit_prediction` permite evaluar resultados binarios 0/1 después del horizonte y guarda Brier en registro local inmutable. Los resultados externos siguen sin verificar.
- Tarjetas visuales nativas de GenerativeCanvas muestran porcentaje, horizonte, incertidumbre, Brier, fuentes y controles de reinvestigación. Solo resultados de herramientas oficiales generan tarjetas; no se ejecuta HTML de fuentes externas.

**Límite actual:** la búsqueda es descubrimiento de fuentes, no un modelo universal entrenado de meteorología, salud, economía u otros campos. Se requieren datos primarios validados y predictores especializados antes de publicar porcentajes fiables sobre eventos del mundo real.

## Public CSV numerical forecast (live-source adapter)

After oracle_research_forecast discovers a relevant primary source, Kira may call `oracle_forecast_public_csv` with the public HTTPS CSV URL, the exact date and value column names, the measurement unit, the interval in hours, and the forecast horizon (1-30 intervals). It fetches through the existing PHOENIX hardened web provider, rejects truncation, HTML, malformed CSV, uneven or missing dates, stale series that would only predict the past, non-finite data and embedded URL credentials. It then performs the numeric rolling-origin comparison and persists the calculated forecast with a SHA-256 content fingerprint and retrieval metadata shown in a native chat card. The source has been retrieved, **not authenticated**: independent data provenance, assumptions, missingness and causal validity still need inspection. An empirical numeric interval is **not** a calibrated probability for an arbitrary future event. This improves directly usable data retrieval; it does not turn ORÁCULO into a universal omniscient predictor.

Example call: `oracle_forecast_public_csv(url: "https://example.org/data.csv", dateColumn: "date", valueColumn: "cases", unit: "cases", stepHours: 24, horizonSteps: 3)`.

The focused CI suite exercises the actual CSV parser, source retrieval adapter, chronological checks and chat-safe presentation.


### Public CSV binary event probabilities

The additional `oracle_forecast_public_event_csv` tool accepts a HTTPS CSV with five explicitly mapped columns: unique case identifier, signal timestamp, resolved outcome timestamp, binary prior signal (0/1 or true/false), and binary realized outcome. A measurable future question, target timestamp, and CURRENT observed binary signal are also required. At least 80 prior cases are needed; the engine uses 70/30 chronology, purges training cases whose outcome was unresolved when holdout began, evaluates Brier against a simple base rate, and abstains if the model does not beat it. Resolutions must occur after the signal and not be in the future; datasets are hashed and provenance is displayed beside the probability in the same native chat card. The engine cannot independently certify data authenticity, cohort comparability, or causal identification. A published CSV is evidence of retrieval, not conclusive proof of source truth.

For one-off events, questions without repeatable historical outcomes, or cases with insufficient/poorly calibrated data, ORÁCULO explicitly abstains from printing a numeric probability.


## ORÁCULO · Universal scientific intelligence and elegant charts

The universal research router (`oracle_plan_research`) builds an inspectable plan for any arbitrary future hypothesis: observable event, horizon, scientific domain, evidence requirements, model route and explicit missing information. It does **not** invent outcome rates, physical laws or scientific certainty. `oracle_research_forecast` shows freshness, source diversity and evidence-risk diagnostics, based only on unverified search metadata.

`oracle_fuse_series` consumes 3–5 source-labelled, dated numeric histories, rejects incompatible units, duplicate timestamps, fabricated future observations and inconsistent intervals; computes a median only for agreeing observations. Its source list and reconciliation errors are visible. It does not magically fetch every format nor certify source independence.

For numerical CSV or user-provided time series, a **separate chronological model-selection and holdout** (`forecast-ensemble.ts`) compares persistence, local linear trend and optional validated seasonal period. The ensemble is used only if it improves held-out MAE versus persistence. The chart uses original observed dates and calculated future values, with bounded 80% nominal historical error bands. Bands are not calibrated confidence guarantees; no user-facing figure is fabricated. The first-party chart validates every point, supports positive/negative values and offers a keyboard-accessible chart/table toggle, optional uncertainty band, responsive SVG and theme-aware styling. The existing original numerical estimator remains separately available for compatibility.

`oracle_calibration_report` reads frozen probabilities and user-reported event outcomes; it excludes results whose predictions were registered after their forecast horizon, then computes Brier, 10-bin reliability, expected calibration error and comparison graphics. Outcomes remain **unverified**. `oracle_forecast_history` supplies a local interactive library of archived prediction IDs. `oracle_revision_prediction` creates a new immutable version pointing to the previous prediction; it never overwrites a historical assertion. `oracle_forecast_due` surfaces predictions past their horizon that still need an independently researched outcome; it does not watch the network automatically.

A user question is not assumed to have a meaningful probability. One-off geopolitical events, unique technological inventions and other poorly observed questions require explicit scenario ranges, qualified assumptions and possible abstention; per-domain scientific calibration is a separate requirement. Standardized model cards, validated domain connectors, automated independent outcome retrieval and persistent scheduled monitoring require additional specialist infrastructure beyond this increment.

### Scientific UI

- Source and research-quality panels with domain, horizon, missing evidence, dated links and caveats.
- Historical series chart with observed/forecast paths, 80% nominal uncertainty fan and alternative tabular view.
- Model-selection panels with independent holdout error, baseline, weights and evaluation limitations.
- Causal scenario baseline/counterfactual comparison, with hypothesis labels.
- Reliability curve and table for scored event forecasts.
- Source agreement/contradiction panel, version library and due-outcome review queue.

All first-party UI is schema-bounded and rendered through PHOENIX GenerativeCanvas; untrusted source HTML is never executed.
