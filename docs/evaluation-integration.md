# nb3-factory problem collection

## Supported workflow

GitHub Actions selects unresolved findings and final failed QA checks, then submits explicit problems, structured report metadata and an immutable report URL. TestManage validates and records the submission in the existing Problems page. It does not run another evaluation. New problems are automation/pending and Uncategorized; staff use the existing form to classify them.

The problem list and detail distinguish Issue, code PR and PR preview environment links. Reports open in a sandboxed iframe with an “Open original report” link. Missing PR/environment data is shown explicitly. For gchust/nb3-factory, preview URLs follow https://nb3-<PR>.nfvd.net/main/; FACTORY_PREVIEW_DOMAIN can mirror a changed factory domain. A link is not a claim that the preview is currently running.

## Repository configuration

```text
FACTORY_EVALUATION_DELIVERY=true
EVALUATION_ENDPOINT=https://test3.nfvd.net/main/api/evaluations/import
EVALUATION_AUTH_MODE=x-api-key
EVALUATION_DELIVERY_FORMAT=testmanage3-links-v1
EVALUATION_TIMEOUT_SECONDS=180
```

Keep the source-bound credential in GitHub Actions secret `EVALUATION_TOKEN`. Single-attempt timeouts support 30–300 seconds with up to three bounded attempts. Dispatch `Deliver Evaluation Results` (`deliver-evaluation.yml`) with `mode=replay`, `type=evaluation-report`, the full report key and revision to resend an existing report without another Agent build or model evaluation.

## Receiver and credentials

`POST <app-base>/api/evaluations/import` accepts `application/json` with `{version: 1, document, reportUrl, problems}`. Required headers are `Idempotency-Key`, `X-Evaluation-Schema-Version: 1`, `X-Evaluation-Type`, `X-Evaluation-Bundle-SHA256` and `X-Evaluation-Payload-SHA256`. Use either `x-api-key` or Bearer, exclusively. JSON is limited to 4 MiB. This mode transfers no ZIP, HTML or screenshot bytes, and the receiver does not fetch the linked report.

The payload digest verifies the actual request body. The bundle digest identifies the producer's registered archive; it is a producer assertion in link mode. Report URLs must match the immutable GitHub Pages report location declared by the report. Actions owns finding/QA selection. The receiver checks that submitted problem references exist in the metadata; it does not interpret scores or select problems itself.

A first import returns HTTP 201 with an unwrapped receipt. Identical retries return HTTP 200 and the original receipt; changed report or problem data under the same source/type/key/revision returns 409. Empty problem lists store metadata without inventing problems. Protocol batch documents are accepted as metadata for producer compatibility; there is no batch dashboard or batch evaluation. Producer chronology chooses the current evidence, preventing late older reports from replacing it.

Native API Keys use the separate non-session `evaluation-import` configuration and repository/project source binding. Keys cannot authenticate browser sessions or call ordinary APIs. Source management remains at `GET/POST /api/evaluations/sources` and `DELETE /api/evaluations/sources/:id`, protected by native Authentication and Authorization. Create with `{name, sourceInstance, project}`; tokens are returned once, expire after 365 days and can be revoked. The native permission set key `evaluation-manager` is retained for deployed assignments and displayed as “Factory integration manager”; only credential management remains. Staff report access follows the existing Problems permission and record scope.

Use the application-local NocoBase 3 Skills. Credentials, permission sets, policy-bound Repositories, transactions, File Repository, Drive, API client, i18n and UI primitives come from the installed infrastructure. The application owns only the protocol adapter and problem collection behavior.

## Removal and compatibility boundaries

The standalone evaluation page, score/batch display, comparison, module mapping, finding review and regression services/API routes are removed with their helpers, locale strings, browser contracts, tests and obsolete acceptance screenshots. There are no hidden evaluation pages or unadvertised review endpoints. Unknown paths under `/api/evaluations/` return 404.

Historical migrations and seeds have run on 252, so their checksums and stored data are preserved. A new seed removes retired page/read/review grants and empty seeded reader/reviewer roles, preserves custom grants and titles, and retains the deployed manager identity. The original resource declaration is a frozen dependency of the old seed and is never registered in the live authorization model. Historical review tables have no active API; only prior human finding dispositions are read to avoid resurrecting dismissed problems.

The deployed import path, JSON envelope, source identity, headers and receipt format remain compatible with the configured factory sender. Intake now accepts only `testmanage3-links-v1` JSON; multipart/ZIP uploads return 415. The receiver validates only consumed metadata fields with the existing Zod dependency. Full evaluation schemas, generated contract types, code generation and new archive writes are removed; all other report fields remain opaque and are retained verbatim for replay checks and JSON downloads. Legacy ZIPs keep authenticated problem-scoped downloads through `/api/test-progress/problems/:id/report`. Linked reports load directly from their source in an opaque sandboxed iframe with no referrer. Legacy inline HTML is sanitized and rendered with restrictive CSP; the original download is unchanged. There is no standalone report archive API. Replays do not duplicate or resurrect deleted problems, or overwrite human titles, descriptions, ownership, classification or lifecycle state.

Full database Collection snapshots are generated tooling output, remain locally available via `pnpm collections:generate` and are gitignored. Migrate and generate before `pnpm collections:generate --check` on a fresh checkout. Application migrations, the minimal metadata contract and regression tests remain tracked.

## Verification and deployment

Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm nocobase app i18n:check` and `pnpm build --target linux-x64 --node-version 24 --tar`. Verify the retirement seed against a real database, preserving custom grants and testing repeat execution. Cover credential isolation, receipts, empty submissions, duplicate prevention, record/field policies, removed routes and ordinary problem report access.

On 252, preserve `/srv/testmanage3-production/storage`, `config.yml` and container identity. Back up SQLite consistently before switching images and retain the previous image for rollback. Validate migrations/seeds on an isolated production clone first. Never edit applied migration checksums or clear production data to simplify the PR.

## PR cleanup verification — 2026-09-25

The PR now contains problem intake and report display, without full evaluation contracts, ZIP uploads or copied scoring fixtures. One small metadata fixture covers receiver behavior; explicit problem submissions are tested independently of the factory's selection logic. The already-deployed migration files and original permission seed remain byte-for-byte unchanged. Historical archives remain readable, while new imports never create archive files.

Validation passes: 46 test files / 344 tests (`pnpm test --maxWorkers=2`), typecheck, lint, i18n and the Linux x64 / Node 24 production build. The unrestricted parallel test run exposed timing failures in two unchanged UI tests; their isolated rerun and the complete bounded-concurrency rerun pass. The actual nb3-factory delivery function also accepts all seven original report/batch scenarios through the reduced receiver parser, with unchanged top-level receipt validation. No live Actions or model run was triggered.

At the end of the September 25 cleanup, PR #1 had been updated but 252 still ran the preceding report-link revision. The September 26 deployment below supersedes that production state.

## Additive metadata rejection — 2026-09-26

Factory delivery run `36232945703` rejected Issue #369 revision 1 with HTTP 422. Factory PR #353 added `health` and `baseline.agent.configuration` under `schemaVersion: 1`; production then ran `testmanage3:report-links-cabf024`, whose copied full-document schema rejected unknown properties. Read-only inspection confirmed that the old production schema lacked both fields. The original report failed on exactly those two paths, while the metadata-only receiver accepted the complete original submission.

The existing `document.ts` and `validateDocument()` implementation is the compatibility fix: validate consumed identity, chronology, link and finding-reference fields, allow opaque producer metadata, and preserve the original document for storage, downloads and immutable replay comparisons. Keep authentication, source binding, payload digests, report URL checks, supported schema versions and conflict checks strict. Do not strip fields from a registered report or disable validation globally. A route-level regression now covers the new fields, first import, identical replay, preserved JSON, changed-content rejection and duplicate prevention.

Recovery requires deploying the compatible receiver, then explicitly replaying `type=evaluation-report`, `key=gchust/nb3-factory/issues/369/initial`, `revision=1`. Verify HTTP 201 (or 200 for an identical stored revision), a stored receipt and the three submitted problems. The factory's scheduled scan only selects `pending`; a `rejected` record requires `replay` or `retry-rejected`. The investigation and local regression initially made no production changes; the completed recovery is recorded below. Future producer changes must be checked against the deployed receiver contract, with receiver compatibility deployed before new metadata is emitted.

## Compatible receiver deployment — 2026-09-26

Deployed to 252 at **18:38:06 Singapore time** (10:38:06 UTC), from application revision `ea403ddbea47035d13511a6b97cb48447ce63b60` on `feat/integration` in [PR #1](https://github.com/gchust/testmanage3/pull/1). The production image is `testmanage3:metadata-ea403dd`, ID `sha256:c7e9a852b6b5e162e5677835a418abeaa17608dcd1d6675e04c46c823edbf049`. Subsequent deployment-documentation commits do not change the running application revision.

The Linux x64 / glibc / Node 24 build uses `APP_BASE_PATH=/main`. Its archive SHA-256 is `4300bf600c6bb72802617cba3133c59d46974fb51ff61c321d7c80e9a1084eec`; runtime Node 24 and ABI 137 match the build target. The build includes client/tooling type checking, server compilation, deployment dependency verification and 17 compiled migration/seed manifests. No `.env` is included in the archive. Before deployment, all 77 tests pass in the four affected files: `tests/logic/evaluations.test.ts`, `tests/logic/app-server.test.ts`, `tests/logic/client-routes.test.ts` and `tests/components/factory-problem-source.test.tsx`, using `--maxWorkers=2`. The added receiver regression also passes targeted ESLint and Prettier checks.

An isolated production database/storage clone, with no network access or published port, verifies the original Issue #369 submission: first import 201, identical replay 200 with the same receipt, changed content at the same revision 409, anonymous import 401 and machine-key access to ordinary staff APIs 401. Both new metadata fields survive unchanged. Database structure and applied migration records remain unchanged. The new `202609250002_retire_evaluation_permissions` seed removes the two empty retired reader/reviewer roles while preserving unrelated grants and integration-manager access.

The live replay [36236400811](https://github.com/gchust/nb3-factory/actions/runs/36236400811) completes plan, send and record successfully. It submits the original registered report once, receives **HTTP 201 / stored** in 8,573 ms and records receipt `d7ab7903-b44b-4a71-b3cf-fca9efa65cc1`. The original bundle digest remains `9766f1f4dcaa1d64d5650ae8cb2d9486db166e2b30bc4eda30b3e1dc037e3acc`. Exactly one report and three problems, IDs **195, 196 and 197**, are stored. No application build or model evaluation is rerun in the factory.

All 101 existing problems and all other pre-deployment business rows remain byte-for-byte unchanged. Production now contains 104 problems, eight report records and the original three archive files. The original JSON downloads unchanged, including `health` and `baseline.agent.configuration`; the legacy archive for problem 187 remains byte-identical. Configuration, storage mounts, container identity and restart policy are preserved. A container restart confirms the new report and problems persist, and container health returns to `healthy`.

Public HTTPS checks cover the homepage, direct Problems route, built JavaScript/CSS assets, authentication, Problems API, all three new problem details, original JSON and legacy ZIP downloads, and revocation of the temporary verification session. Chrome also confirms the new problems, Issue #369 / PR #370 / preview links, and the complete original report rendered in its sandboxed iframe with `no-referrer`; there are no browser console errors. The initial scripted probe encountered edge filtering for its non-browser user agent; browser access and the corrected HTTP probe pass without changing edge security settings.

The consistent pre-switch backup is `/srv/testmanage3-backups/pre-metadata-compatibility-20260926T103756428279Z`. The previous `testmanage3:report-links-cabf024` image is retained. Deployment metadata and verification records are under `/srv/testmanage3-metadata-ea403dd/`, with active deployment identity also in `/srv/testmanage3-production/deployment.json`. The isolated trial container and storage are removed after acceptance; production storage and backups are retained.

## Report link delivery acceptance — 2026-09-25

Deployed to 252 at 21:45 Singapore time using image `testmanage3:report-links-cabf024`, application revision `cabf024d75c17940ac27863d818c9ae8369c466a`, pushed to `gchust/testmanage3` branch `feat/integration`. Factory PR [#336](https://github.com/gchust/nb3-factory/pull/336) is merged into `develop` as `5f646e3eee4184e6f9ceee289d3e6445f7f63682`. Repository variables now select `testmanage3-links-v1` and `EVALUATION_TIMEOUT_SECONDS=180`; the existing endpoint, source-bound secret and enabled delivery setting remain valid. Single-attempt timeouts support 30–300 seconds, with at most three attempts.

The report for Issue #333 previously required a 2,287,438-byte ZIP. Its link submission is 26,845 bytes and transfers no ZIP, HTML or screenshot content. The receiver stores its structured metadata and immutable report URL without creating a File Repository archive. Its selected unresolved problem list is empty, so receiving the report correctly creates no problem. This acceptance reuses existing reports and does not trigger another application build or model evaluation.

| Validation                                  | Factory Actions run                                                           | Actual result                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| First formerly failing workflow, attempt 2  | [36138107190](https://github.com/gchust/nb3-factory/actions/runs/36138107190) | Success; one HTTP 201 submission in 2,315 ms                                                               |
| Second formerly failing workflow, attempt 2 | [36138245692](https://github.com/gchust/nb3-factory/actions/runs/36138245692) | Success; scan plans zero pending items after the first run records its receipt, so send/record are skipped |
| Existing Issue #320 replay, attempt 1       | [36143184418](https://github.com/gchust/nb3-factory/actions/runs/36143184418) | Success; HTTP 200 in 6,106 ms, original receipt and problem preserved                                      |

Issue #333 has exactly one report, receipt `6aeb3205-0a79-492a-9a7f-af70fc8d0b9b`, with no local archive. Issue #320 retains receipt `fe20f948-6625-45d9-9b39-13a93a0d5c73`, its original archive, and problem `187`; replay only adds its report link. All 94 existing problems and the other business rows retain their original content digests. There are now four report records and still three native archive files. SQLite integrity and container health pass.

Production Chrome verifies direct GitHub Pages iframe loading, the original-report link, Issue source display, expanded reading, mobile layout, English/dark and Chinese/light. The report cannot access its parent page, normal inline reading does not request TestManage's report download endpoint, and the legacy HTML download remains byte-identical. There are no browser or unexpected HTTP errors. This sample has no published PR, and the page explicitly shows the absence of a PR and preview environment. The temporary verification session was revoked (subsequent access returns 401), its credential files were removed, and the isolated trial container and storage were removed.

An isolated production clone also verifies HTTP 201/200 idempotency, no archive upload, empty problem handling, rejected invalid report URLs, rejected unauthenticated/invalid-key requests, and machine-key isolation. Application validation passes: 47 files / 351 tests, typecheck, lint, locale check, 55 generated Collection definitions and the Linux x64 / Node 24 production build. Factory validation passes: 94 local tests and both PR regression/preflight checks. The rollback backup is `/srv/testmanage3-backups/pre-report-links-20260925T134508Z`.
