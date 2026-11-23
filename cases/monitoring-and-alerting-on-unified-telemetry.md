---
type: case
status: active
created: 2026-11-23
topics:
  - observability
  - alerting
  - freshness
  - kafka
  - databricks
---

# Monitoring and alerting on unified telemetry

> **Handoff (2026-11-23)**
>
> - **Running on QA:** one scheduled monitoring job (batch metrics, hourly metrics, end-to-end freshness, then a scoring notebook); a separate alerting notebook with generic and job- or source-type-specific rules.
> - **First production release, 25 November:** monitoring collects history; the alerting job is deployed but does not run, and no rules are active. Includes one low-criticality Kafka Bronze job and its Silver consumer as the end-to-end demo. Full Kafka pipelines proposed for 1 December; weekly releases.
> - **Not verified:** false-alarm rate of baseline rules (H17); baseline validity (pooled vs per-slot, history length); alerting behaviour with no matching observations, disabled specific rules and corrected earlier hours.
> - **Next:** accumulate production history; demonstrate the monitoring to the business side and ask for a freshness threshold for critical Kafka flows; add rules one at a time with shadow alerts; staleness check on the statistics; quiet-topic handling; QA rollback test.

Split on 2026-11-23 from `cases/unified-data-observability-and-lineage.md`, which keeps the telemetry model, identity, ledger, lineage and the mechanism of end-to-end freshness (what the two values mean). This case covers how those tables are used to monitor and alert, and how that is rolled out. Text below was moved verbatim; dates are when it was written. References to H1–H16, H18, R-items and the Freshness, Evidence and Design sections point to that case.

## Problem

How do I turn unified telemetry from about 200 heterogeneous jobs into monitoring that people trust: rules that fire on real problems and stay quiet otherwise, when each job behaves differently and history is only starting to accumulate?

---

## What I currently think

*(Written 2026-11-23.)*

Monitoring is trustworthy if it operates on clear and consistent values, gives insight that is useful and not misleading, fires alarms when needed and in general improves our clarity about our system.

All the rules are set inside the rules table without exception. Since we have roughly 200 modules and even more jobs that behave differently, we can't expect rules to apply uniformly to them. This is why we can define the most basic one, such as job activity, to apply to everyone, but more and more specific rules are the key to being flexible enough to really bound our jobs correctly with well-designed rules.

There should be a balance in who decides what. There are expectations defined by the business, where they have to lead in terms of what they want, and there are more technical parts, like how the trends are calculated and how much history is taken into account, which should be the engineer's task to maintain. The translation of a business requirement into the actual row inserted into the rules table should also be an engineer's task.

QA data is in many ways different from production. We have Kafka and Delta tables plugging into telemetry that we did not have before, so the business requirements are not yet defined. We also don't have enough history to really rely on scores and trends, and some buffer time will give us a chance to see the data side by side with the jobs' behaviour, so we can judge whether we are measuring things correctly and emitting shadow alarms correctly.

Where I am guessing: I'm not yet confident in scores and trends. I think it will take some time for them to be up and running and be used as an actual alert.

---

## Objects (2026-11-23)

The telemetry tables are listed in the telemetry case (Design → Objects).

| Object | Written by | One row per | Read by |
|---|---|---|---|
| `process_scores_and_trends` | monitoring job, scoring task (after the batch, hourly and end-to-end tasks) | job × metric at BATCH or HOUR grain, depending on the metric | alerting job |
| `process_alert_rules` | by hand: engineering defaults, business overrides | rule | alerting job |

- **`process_scores_and_trends`:** the z-score and EWMA results, with sample count, unit, time span, and flags saying whether a value is good enough to use.
- **`process_alert_rules` (early version, schema recited from memory):** `rule_id`, grain (`hour`, `batch`, `lineage`), metric, threshold, unit, comments, time added.
- **Alerting job:** separate from the monitoring job; deployed, not running yet. Reads the metrics tables, `process_end_to_end_freshness` and `process_scores_and_trends`, plus `process_telemetry` directly (`max()` of the last committed row per job, as an activity check), and compares them with `process_alert_rules`.
- **Agent challenge (not verified):**
  - The recited rules schema has no scope (job, source type) or enabled column, yet the alerting notebook selects the most specific rule and a disabled specific rule suppresses a generic one (2026-11-20). Either the columns exist and were not recited, or matching works differently; check the real schema. A comparison direction (above or below the threshold) is also not listed.
  - The activity check over raw: without a date filter, `max()` per job scans history; with one, a job that has been silent longer than the window disappears instead of alerting. Starting from an expected job list avoids both.
  - Scores at two grains in one table: the key must include the grain, or a batch row and an hour row for the same job and metric collide.

---

## Monitoring scope (2026-10-23)

**User decisions:**

- **Responsibility split:** the customer's business side owns alert policy (thresholds, warning/critical, tolerated late shares). Engineering delivers metrics detailed enough to build valuable monitoring on, and establishes trends.
- **Accepted measurements:** CreateTime as publication time; `batch_end_ts` (post-write) as availability time. The caveats stay: CreateTime is producer-supplied; batch end is a writer-side proxy for target availability.
- **Expectation ballpark:** roughly 2–5 min from publication to parsed Bronze for Kafka MESSAGE jobs.
- **Two metric families to trend:**
  - **Volume per time window** (primary): `SUM(input_message_count)` per hour/day and source. Messages per batch stays a diagnostic only: it depends on trigger cadence and batch size, and a batch catching up on backlog looks like a volume spike although the source did not change. Growing batch sizes can indicate a consumer falling behind.
  - **Message age:** completion-age shares at the 120/300 s bounds (exact from merged histograms) plus interpolated p50/p95; means from sums.
- **Granularity:** engineering stores hourly (`process_metrics_per_hour`); daily is derived. How fast a problem must be noticed, and therefore whether alerts act hourly or report daily, stays with the business side.

**Revision (2026-11-17):** engineering owns default per-job baseline rules and the parameters that decide whether a statistic is valid (history length, flags); the business side sets exact thresholds and rules for critical sources in a lookup table, which takes precedence over the defaults. Production alerting starts with crude rules. See the 2026-11-17 log entry. *(First release: no active rules; rules added one at a time afterwards, see 2026-11-20.)*

**Agent proposals, not decided:**

- *(Decided 2026-10-25: hourly base.)* Histograms and sums merge exactly at any window, so the facts support both granularities; an hourly base with daily rollups is a reasonable default. For a 2–5 min expectation, daily works as a trend, not for reacting. The deciding question for the business side: how fast must someone notice a problem?
- Trend baselines should account for seasonality (shifts, production schedules): compare with the same hour on previous weeks rather than the previous hour.
- Zero volume is invisible as rows (no input, no batch); detect it from the expected-process list left-joined to observations, as above.

---

## Investigation log

### 2026-10-31: volume detectors (synthetic lab)

- **Lab (synthetic, agent-built, not evidence about the real tables):** `labs/hourly-volume-detectors/` compares robust z against the same hour on 7 previous weeks, EWMA and CUSUM on simulated hourly volume. Hypotheses to test on `process_metrics_per_hour`: per-hour 7-point MADs make the scale too noisy (a false alarm every 15–21 h on clean simulated data) while a pooled relative scale does not; robust z misses a sustained −8 % shift that EWMA and CUSUM catch within 6–8 h.

### 2026-11-17: statistics notebook and monitoring direction

- **Draft (QA, few jobs):** a notebook computing MAD, EWMA and basic freshness per job; notes to follow. The metrics tables, `process_end_to_end_freshness` and these statistics are meant as the base for monitoring jobs that fail and alert when thresholds are broken.
- **Monitoring direction (my decisions, under construction):**
  - About 200 jobs behave differently, so general rules apply to every job against its own historical baseline. A lookup table lets the business side set exact thresholds and rules for critical sources of their choice; a lookup row takes precedence over the general rule.
  - How much history (days, batches, hours) makes a baseline statistically valid is an engineering parameter, guided by accuracy, not by the business.
  - First release computes the statistics with flags (for example "insufficient history") that say whether a value should be used; no alerting on them yet.
  - Production alerting starts with a few crude rules, such as "has this job produced something in the last 2 hours?", while production data accumulates and more jobs are connected.
  - Shadow alerts: Databricks alerts sent only to my email address.
  - Alerting job (planned): reads the persisted statistics, compares them with expectations, collects every breach and fails once with a summary. It also checks the statistics themselves: if the latest evaluation in the statistics table is older than allowed, that is a breach in the same summary, so a stalled statistics notebook cannot pass as healthy. The allowed age follows from the notebook's schedule (not yet set).
- **Agent challenge (not verified):**
  - History sufficiency depends on the baseline: same hour of week needs several weeks per slot, a pooled or rolling baseline needs hours. The synthetic lab already found 7 points per slot noisy. Measurable on real data: how much the baseline moves as history grows, and how often each rule fires on healthy data.
  - Store the evidence behind a flag (point count, baseline window, reason codes such as `insufficient_history`, `partial_hour`, `recomputed_after_evaluation`), so the validity threshold can change without recomputation.
  - The crude rule needs an expected cadence per job; daily or irregular jobs break a fixed 2 h window. "Produced" needs a definition: a completed batch, or non-zero input.
  - The lookup table should be keyed on a stable identity (`job_name` vs `job_id`, R5), or a renamed job silently loses its thresholds.
  - A failing monitoring job as the alert signal mixes four things: a breach and a crash in the monitoring code look the same; raising on the first breach skips the remaining checks; a green run can mean nothing was evaluated; platform retries re-run a breach. Alternative: write one row per check and target to a results table (value, threshold, flags, status, evaluation time), fail only on own errors, alert from the table (shadow alerts become SQL alerts on it), and check that evaluations are recent.
    - **My answer:** the statistics notebook persists its results in a Delta table; a separate alerting job compares them with expectations. It collects every breach, raises one exception with a summary at the end, and the failure alert brings people to read it. Collecting before failing is what keeps one job's breach from hiding another's. An extra job only to crash is accepted; the statistics must be persisted anyway.
    - **Agent note (not verified):** remaining gaps: the alerting job should also fail when the statistics are stale (last evaluation too old), otherwise a stalled notebook makes it compare old values and pass; disable retries on the alerting job; breaches exist only in run history unless also written to a table, which H17 needs for counting firings.

### 2026-11-18: presentations, release plan

- **Presented:** to the client, the monitoring layout: current state (only file jobs report, several disconnected monitoring solutions, no connection to platform system tables, legacy reporting inconsistent and physically fragmented), how everything connects to `process_telemetry`, the metrics jobs, end-to-end freshness, and that the existing operational dashboards could be reworked on the new tables. Demo: end-to-end freshness tracing a Kafka pipeline from source to Gold. Again to the client with the project manager: what gets deployed, what it means for business and developers, rollout and rollback. At sprint review: a short overview of the release bundling the runtime migration with the monitoring rollout; new datasources and legacy migrations must target the new runtime and reporting afterwards; a migration guide promised later.
- **Client questions (two lines):**
  - Transition: how do downstream consumers move from `processed_files` to `process_telemetry`, and how is the history in `processed_files` kept?
  - Kafka flows (the most visible): what can be seen after this release, what will be monitored; a request for a demo and examples.
- **Release plan:** 24 November: a handful of jobs move to the new runtime and report to `process_telemetry`; the monitoring jobs are deployed; production alerting covers only time since the last `process_telemetry` record per job, while the statistics gather history. Weekly releases afterwards, building step by step; Kafka pipeline alerting is proposed for the next release, as the most important business item. A trends and alerting call with the client is planned for Friday.
- **Planned:** a platform dashboard as the first stop for ad-hoc investigation of a job: metrics and trends joined with system tables (cost, cluster metrics), with releases (number and date, recorded manually) overlaid to look for correlations. Partly built; to be connected to the new metrics tables.
- **Agent challenge (not verified):**
  - End-to-end freshness is visible only for pipelines whose every hop reports, producers before consumers. Whether the first jobs form a complete Kafka chain decides what the Kafka stakeholders see after the first release.
  - Quiet topics: a `processingTime` query without new data runs no micro-batch (stateless queries; to verify), so no telemetry row is written and "time since last record" fires. Per-job thresholds or known quiet hours are needed.
  - Kafka alerting one week after the first release has too little history for baseline rules; it must be threshold-based (needs the business threshold) or crude.
  - The release overlay cannot separate the runtime migration from the telemetry overhead (H4) in a bundled release. System tables do give a pre-release baseline for cost and run duration. A small release table is sturdier than values typed into the dashboard.

### 2026-11-20: scoring, alert rules and revised release

- **Implemented:** a scheduled monitoring job runs the batch metrics, hourly metrics and end-to-end freshness tasks before the scoring task. The scoring notebook persists results for the evaluated hour.
- **Scoring implementation:** a 28-day rolling baseline uses the median and MAD of log-transformed observations; sample count and history span determine a provisional baseline status. An exploratory EWMA is reconstructed over seven days. Hourly scoring covers input volume and file/message size measures; batch scoring covers processing duration. These choices and validity thresholds still need evaluation on production data.
- **Alerting implementation:** a separate notebook matches generic and job- or source-type-specific rules, selects the most specific match, evaluates raw measurements or end-to-end source-to-target age, and collects findings before failing once. Score- or trend-based generic alerts are intended later; the current evaluator does not use modified z-scores or EWMA.
- **Release revision:** the first production release is planned for **25 November**, bundled with the 18 LTS migration, followed by weekly releases. The monitoring job will collect history; the alerting job will be deployed but will not run, and no rules will be active. This supersedes the 24 November and initial crude-alert plan above.
- **Validation direction:** accumulating production history makes evaluation possible; it does not by itself establish validity. I still need to demonstrate how the reworked monitoring behaves to the business side. We will define rules step by step and judge readiness for activation using both shadow-alert results and known examples, aiming to avoid unwanted false alarms.
- **Open implementation questions (agent review, not verified in runtime):** an alert run with no matching observations can pass without checking whether expected jobs were evaluated or statistics are stale. A disabled specific rule suppresses a matching generic rule because specificity is selected first; confirm whether this is the intended exemption. The scoring notebook replays history for EWMA but persists only the target hour, so a later correction to an earlier hour does not automatically update its persisted score. Test these behaviors before activating rules.
- **Freshness caution:** source-to-target and origin-start-to-target ages are separately maximized across origins in the alert notebook; the two maxima can describe different origins. Source timestamp meaning and lineage coverage remain open.
- **My answers (2026-11-20, exploratory):**
  - Kafka and Delta sources had only basic crash detection before, which also covers new jobs such as the monitoring job. The first release therefore changes nothing for them; rules the business side asks for are added after 25 November, knowing what the data shows by then.
  - The first release shows the customer what the monitoring looks like and what it can do; rules are then inserted into the lookup table one at a time, using the weekly releases to adjust as the migration goes on.
  - The log transform is `log1p`, so zero observations are defined.
  - Rules are scoped by job or source type on any measure, not only end-to-end freshness. Source-to-target age is expected to be specific to a few jobs; origin-start-to-target age per source type. Examples: a tighter rule for Kafka Bronze jobs later; a generic activity rule for file jobs ("a row in `process_telemetry` in the past x hours").
- **Agent note (not verified):** a generic origin-start-to-target rule cannot see Bronze falling behind (consumer backlog sits before origin start), so it should not be the only generic freshness check. File deliveries can be daily or irregular, so the generic activity window x likely depends on the source or job (expected cadence, see Open questions).

### 2026-11-23: Kafka demo pair and full-pipeline proposal

- **Briefed:** the team, in a written message.
- **25 November release:** deliberately includes one Kafka Bronze job and its Silver consumer, one of the least critical Kafka flows, as the end-to-end freshness demo.
- **Proposed to the customer for 1 December:** migrate Kafka jobs together with their full pipeline (Bronze, Silver, Gold), so end-to-end freshness is visible for whole flows.
- **My reasoning:** any job can be rolled back at any time by restoring the previous jars and parameters, and it runs as before; release downtime and these risks are already communicated. I consider the rollout low risk.
- **Agent note (not verified):** restoring jars restores code, not the state written on the new runtime. Check once on QA (run on 18 LTS, roll back, restart): whether the older runtime reads a streaming checkpoint written by the newer one; whether any table the job writes gained a newer Delta protocol or table feature that the older runtime cannot write. While a file job is rolled back it does not write `process_telemetry`, so the new ledger misses that window unless dual reporting and the import cover it.

---

## Hypotheses

Numbering continues from the telemetry case.

| # | Hypothesis | Status |
|---|---|---|
| H17 | General per-job baseline rules with validity flags give an acceptable false-alarm rate across ~200 jobs on real data | Open; shadow alerts planned |

---

## Conclusion

Not yet.

## What changed in my understanding?

Not yet.

## Reusable lesson

Not yet.

---

## Open questions

**Expectations and thresholds (moved from the telemetry case)**

- To agree with the business side: how fast must a problem be noticed (sets hourly vs daily), which thresholds and late shares become warning/critical, and through which channel?
- Which baseline defines a trend (same hour previous weeks, rolling window), and which volume deviation is meaningful?
- Do expectations describe processing cadence or arrival cadence? What should a support engineer read from the morning email or a dashboard?

**Monitoring and alerting (2026-11-17)**

- How will score- and trend-based rules use baseline-validity flags, and how will missing or stale evaluations be detected before alerting is activated?
- When facts for an earlier hour change, should persisted scores be recomputed, and how will that be detected?
- Does a disabled specific rule intentionally exempt its scope from a generic rule?
- Is the 28-day baseline pooled across hours, or per hour of day / hour of week? Pooling hides seasonality; per-slot baselines leave few points per slot (4 per hour-of-week slot in 28 days).
- Are the sample count and history span persisted next to each score, or only the resulting baseline status?
- How much history makes a baseline valid, per baseline type (same hour of week vs pooled or rolling)? Which flags and reason codes are stored?
- Where does each job's expected cadence come from for the crude "produced something" rule (lookup table, inferred maximum gap, exclusion)? Does "produced" mean a completed batch or non-zero input?
- What key does the threshold lookup table use, and does it survive job renames?
- *(Answered 2026-11-17: statistics persisted to Delta; a separate alerting job collects all breaches and fails once with a summary.)* How is a breach signalled? *(Planned 2026-11-17: a staleness check on the latest statistics evaluation in the alerting job.)* What tells us the statistics are still being evaluated? Open: the allowed age.
- What firing rate in shadow alerts is good enough to activate a rule?

**Release and stakeholders (2026-11-18)**

- What freshness threshold does the business side set for critical Kafka flows?
- *(Answered 2026-11-23: a Kafka Bronze + Silver demo pair on 25 November; full Kafka pipelines proposed for 1 December.)* Do the first jobs form a complete Kafka chain, so that end-to-end freshness is visible after the first release?
- Does a rollback to the previous runtime work with state written on the new one (streaming checkpoints, Delta protocol), and does the ledger cover the rollback window?
- How does the basic alert treat quiet topics that produce no micro-batches?
- Where are releases recorded for the dashboard overlay (manual values vs a small table)?

---

## Connections

- `cases/unified-data-observability-and-lineage.md`: the telemetry this case monitors; end-to-end freshness mechanism, ledger, lineage limits, and the slow population that will meet the first freshness rules.
- `labs/hourly-volume-detectors/`: synthetic comparison of robust z, EWMA and CUSUM; its hypotheses are this case's baseline questions.
- `cases/databricks-cost-intelligence-loop.md`: the planned dashboard joins these metrics with cost and cluster metrics from system tables.
- `cases/databricks-comment-metadata-ownership.md`: business owns expectations; engineering owns the mechanism.
