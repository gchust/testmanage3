# nb3-factory problem collection

## Supported workflow

GitHub Actions selects unresolved findings and final failed QA checks, then submits explicit problems, structured report metadata and an immutable report URL. TestManage validates and records the submission in the existing Problems page. It does not run another evaluation. New problems are automation/pending. The factory classifies each problem into a feature point before delivery (see [Problem classification](#problem-classification)); one it did not classify stays Uncategorized, and staff use the existing form either way.

The problem list and detail distinguish Issue, code PR and PR preview environment links. Reports open in a sandboxed iframe with an “Open original report” link. Missing PR/environment data is shown explicitly. A report the configured factory repository produced for its own pull request links to its preview at `https://nb3-<PR>.<domain>/main/`, set by `factoryPreview.repository` and `factoryPreview.domain` (`FACTORY_PREVIEW_DOMAIN` overrides the domain; an empty repository turns preview links off). A link is not a claim that the preview is currently running.

## Repository configuration

```text
FACTORY_EVALUATION_DELIVERY=true
EVALUATION_ENDPOINT=https://<testmanage-host>/<app-base>/api/evaluations/import
EVALUATION_AUTH_MODE=x-api-key
EVALUATION_DELIVERY_FORMAT=testmanage3-links-v1
EVALUATION_TIMEOUT_SECONDS=180
```

Keep the source-bound credential in GitHub Actions secret `EVALUATION_TOKEN`. Single-attempt timeouts support 30–300 seconds with up to three bounded attempts. Dispatch `Deliver Evaluation Results` (`deliver-evaluation.yml`) with `mode=replay`, `type=evaluation-report`, the full report key and revision to resend an existing report without another Agent build or model evaluation.

## Receiver and credentials

`POST <app-base>/api/evaluations/import` accepts `application/json` with `{version: 1, document, reportUrl, problems}`. Required headers are `Idempotency-Key`, `X-Evaluation-Schema-Version: 1`, `X-Evaluation-Type`, `X-Evaluation-Bundle-SHA256` and `X-Evaluation-Payload-SHA256`. Use either `x-api-key` or Bearer, exclusively. JSON is limited to 4 MiB. This mode transfers no ZIP, HTML or screenshot bytes, and the receiver does not fetch the linked report.

The payload digest verifies the actual request body. The bundle digest identifies the producer's registered archive; it is a producer assertion in link mode. Report URLs must match the immutable GitHub Pages report location declared by the report. Actions owns finding/QA selection. The receiver checks that submitted problem references exist in the metadata; it does not interpret scores or select problems itself.

A first import returns HTTP 201 with an unwrapped receipt. Identical retries return HTTP 200 and the original receipt; changed report or problem data under the same source/type/key/revision returns 409. Empty problem lists store metadata without inventing problems. Protocol batch documents are accepted as metadata for producer compatibility; there is no batch dashboard or batch evaluation. Producer chronology chooses the current evidence, preventing late older reports from replacing it.

Native API Keys use the separate non-session `evaluation-import` configuration and repository/project source binding. Keys cannot authenticate browser sessions or call ordinary APIs. Source management remains at `GET/POST /api/evaluations/sources` and `DELETE /api/evaluations/sources/:id`, protected by native Authentication and Authorization. Create with `{name, sourceInstance, project}`; tokens are returned once, expire after 365 days and can be revoked. The native permission set key `evaluation-manager` is retained for deployed assignments and displayed as “Factory integration manager”; only credential management remains. Staff report access follows the existing Problems permission and record scope. The API Keys settings page lists only the signed-in user's default-configuration keys; integration keys are managed only here.

Use the application-local NocoBase 3 Skills. Credentials, permission sets, policy-bound Repositories, transactions, File Repository, Drive, API client, i18n and UI primitives come from the installed infrastructure. The application owns only the protocol adapter and problem collection behavior.

## Problem classification

Before sending, the delivery workflow reads the feature point tree with the same source credential: `GET <app-base>/api/evaluations/feature-points` returns `{version: 1, featurePoints: [{id, name, level, parentId}]}` to an enabled source, and 401 to anything else, including browser sessions. It maps each problem's subject keys through its own rules, asks its Agent about the rest, and adds an optional `classification: {featurePointId, method, reason}` to the problem. `method` is `rule` or `model`, `reason` is 1–1000 characters, and `featurePointId: null` states why no feature point fits; any other key or value rejects the submission with 400.

The receiver files a problem under that feature point only if it still exists at the `feature` level; otherwise the problem stays unclassified and the decision is dropped. The source and reason are stored in `issues.classificationSource` and `classificationNote`, audited as `problem.classify`, and shown as an “Auto · rule/AI” badge with the reason on the Problems list and detail. Classification is excluded from the submission digest, so a retry or replay may carry a different one without a 409.

Only a problem with no feature point and no classification source is ever classified automatically. That covers new problems, and existing ones when their report is replayed, which is how problems collected before this change are classified. A superseded revision still collects nothing, but its replay classifies the problems it collected while it was current. A person changing the feature point sets the source to `manual`, clears the reason and badge, and no later delivery changes it again. An earlier automatic decision is likewise kept. Uncategorized is only where factory intake waits for a person: staff must choose a feature point for a problem they create, may leave an uncategorized one there while editing it, and cannot move a classified problem back.

A problem filed under a feature point while it has no owner inherits that point's owner (name and account, whichever the point has), unless the request itself says who owns it. That happens when the factory classifies it, when staff create it without naming an owner, and when staff move an ownerless problem there without naming one. An explicit "no owner" (`ownerId: null`) is kept, including while moving the problem. A problem that already has an owner keeps it, including when it moves to another feature point. The problem form makes the choice visible: a new problem defaults to "Feature point owner (name)", moving an ownerless problem proposes the new point's owner, and either can be changed to another person or to Unassigned. Feature point owners are often names without accounts; the form shows such an owner as “(no account)” and saving the form keeps it.

The Problems list and detail read each stored report once per process and keep the links it yields; only the report link, which a replay may add later, is read on every request. A stored report that can no longer be read is logged and its problems are listed without report links rather than failing the list.

## Removal and compatibility boundaries

The standalone evaluation page, score/batch display, comparison, module mapping, finding review and regression services/API routes are removed with their helpers, locale strings, browser contracts, tests and obsolete acceptance screenshots. There are no hidden evaluation pages or unadvertised review endpoints. Unknown paths under `/api/evaluations/` return 404.

The migrations and seeds have already run on the production database, so they stay byte-for-byte unchanged: an executed seed whose source changes is refused at startup, and a changed migration no longer matches its recorded checksum. Seeds 202609270001 and 202609270002 import permission definitions that are frozen for that reason; the providers register `registered*Resource` instead. Seed `202609280001_seed_assign_problem_owners` was removed before merging: it backfilled owners for factory problems classified before inheritance existed, which only happened on the production database where it has already run, and its broader query would have reassigned staff problems elsewhere. A retired seed's history row is ignored. A new seed removes retired page/read/review grants and empty seeded reader/reviewer roles, preserves custom grants and titles, and retains the deployed manager identity. The original resource declaration is a frozen dependency of the old seed and is never registered in the live authorization model. Historical review tables have no active API; only prior human finding dispositions are read to avoid resurrecting dismissed problems.

The deployed import path, JSON envelope, source identity, headers and receipt format remain compatible with the configured factory sender. Intake now accepts only `testmanage3-links-v1` JSON; multipart/ZIP uploads return 415. The receiver validates only consumed metadata fields with the existing Zod dependency. Full evaluation schemas, generated contract types, code generation and new archive writes are removed; all other report fields remain opaque and are retained verbatim for replay checks and JSON downloads. Legacy ZIPs keep authenticated problem-scoped downloads through `/api/test-progress/problems/:id/report`. Linked reports load directly from their source in an opaque sandboxed iframe with no referrer. Legacy inline HTML is sanitized and rendered with restrictive CSP; the original download is unchanged. There is no standalone report archive API. Replays do not duplicate or resurrect deleted problems, or overwrite human titles, descriptions, ownership, classification or lifecycle state.

Full database Collection snapshots are generated tooling output, remain locally available via `pnpm collections:generate` and are gitignored. Migrate and generate before `pnpm collections:generate --check` on a fresh checkout. Application migrations, the minimal metadata contract and regression tests remain tracked.

## Verification and deployment

Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm nocobase app i18n:check` and `pnpm build --target linux-x64 --node-version 24 --tar`. Verify the retirement seed against a real database, preserving custom grants and testing repeat execution. Cover credential isolation, receipts, empty submissions, duplicate prevention, record/field policies, removed routes and ordinary problem report access.

In production, preserve the storage directory, `config.yml` and container identity. Back up SQLite consistently before switching images and retain the previous image for rollback. Validate migrations and seeds on an isolated production clone first. Never edit applied migration checksums or clear production data to simplify a change.

## Producer compatibility

The receiver validates only the metadata it consumes in `document.ts` and keeps every other producer field opaque, so the factory can add report metadata under the same schema version. Do not strip fields from a registered report or disable validation globally; keep authentication, source binding, payload digests, report URL checks, supported schema versions and conflict checks strict. When the producer changes what the receiver consumes, deploy the compatible receiver first, then replay the affected reports (`mode=replay` for a rejected record) and check for a 201 or an identical-revision 200, the stored receipt and the submitted problems.
