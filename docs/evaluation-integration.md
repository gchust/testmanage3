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

The payload digest verifies the actual request body. The bundle digest identifies the producer's registered archive; it is a producer assertion in link mode. Report URLs must match the immutable GitHub Pages report location declared by the report. Submitted problems must reference actual selected findings or final failed QA criteria.

A first import returns HTTP 201 with an unwrapped receipt. Identical retries return HTTP 200 and the original receipt; changed report or problem data under the same source/type/key/revision returns 409. Empty problem lists store metadata without inventing problems. Protocol batch documents are accepted as metadata for producer compatibility; there is no batch dashboard or batch evaluation. Producer chronology chooses the current evidence, preventing late older reports from replacing it.

Native API Keys use the separate non-session `evaluation-import` configuration and repository/project source binding. Keys cannot authenticate browser sessions or call ordinary APIs. Source management remains at `GET/POST /api/evaluations/sources` and `DELETE /api/evaluations/sources/:id`, protected by native Authentication and Authorization. Create with `{name, sourceInstance, project}`; tokens are returned once, expire after 365 days and can be revoked. The native permission set key `evaluation-manager` is retained for deployed assignments and displayed as “Factory integration manager”; only credential management remains. Staff report access follows the existing Problems permission and record scope.

Use the application-local NocoBase 3 Skills. Credentials, permission sets, policy-bound Repositories, transactions, File Repository, Drive, API client, i18n and UI primitives come from the installed infrastructure. The application owns only the protocol adapter and problem collection behavior.

## Removal and compatibility boundaries

The standalone evaluation page, score/batch display, comparison, module mapping, finding review and regression services/API routes are removed with their helpers, locale strings, browser contracts, tests and obsolete acceptance screenshots. There are no hidden evaluation pages or unadvertised review endpoints. Unknown paths under `/api/evaluations/` return 404.

Historical migrations and seeds have run on 252, so their checksums and stored data are preserved. A new seed removes retired page/read/review grants and empty seeded reader/reviewer roles, preserves custom grants and titles, and retains the deployed manager identity. The original resource declaration is a frozen dependency of the old seed and is never registered in the live authorization model. Historical review tables have no active API; only prior human finding dispositions are read to avoid resurrecting dismissed problems.

The stable import path, source identity, protocol schemas and legacy multipart receiver remain for existing producers and retries. Legacy ZIPs keep authenticated problem-scoped downloads through `/api/test-progress/problems/:id/report`. Linked reports load directly from their source in an opaque sandboxed iframe with no referrer. Legacy inline HTML is sanitized and rendered with restrictive CSP; the original download is unchanged. There is no standalone report archive API. Replays do not duplicate or resurrect deleted problems, or overwrite human titles, descriptions, ownership, classification or lifecycle state.

Full database Collection snapshots are generated tooling output, remain locally available via `pnpm collections:generate` and are gitignored. Migrate and generate before `pnpm collections:generate --check` on a fresh checkout. Application migrations, protocol contracts and regression tests remain tracked.

## Verification and deployment

Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm nocobase app i18n:check` and `pnpm build --target linux-x64 --node-version 24 --tar`. Verify the retirement seed against a real database, preserving custom grants and testing repeat execution. Cover credential isolation, receipts, empty submissions, duplicate prevention, record/field policies, removed routes and ordinary problem report access.

On 252, preserve `/srv/testmanage3-production/storage`, `config.yml` and container identity. Back up SQLite consistently before switching images and retain the previous image for rollback. Validate migrations/seeds on an isolated production clone first. Never edit applied migration checksums or clear production data to simplify the PR.

## PR cleanup verification — 2026-09-25

PR #1 is reduced from 252 changed files to 67. Client/server source is reduced by 2,823 lines. The 166 full-database Collection snapshot files are untracked but remain locally generated; the old evaluation UI, review services and superseded evidence are removed. Already-applied migration files and the original permission seed are byte-for-byte unchanged.

Validation passes: 46 test files / 351 tests, typecheck, lint, locale check, Linux x64 / Node 24 production build, and fresh native SQLite migration/seed plus Collection generation/check. Regression coverage includes removed endpoints returning 404, manager access through native permissions, preserved custom grants, no new review rows, historical human dispositions, deleted-problem suppression, link delivery, source links and legacy problem-scoped downloads. These checks validate the cleanup in the PR; the production acceptance below describes the preceding deployed revision. This cleanup has not been redeployed to 252.

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

Evidence: [verification record](verification/2026-09-25/report-links.json), [problem list](verification/2026-09-25/report-links-list-zh.png), [Chinese detail](verification/2026-09-25/report-links-detail-zh.png), [mobile detail](verification/2026-09-25/report-links-mobile.png), and [English dark detail](verification/2026-09-25/report-links-detail-en-dark.png).
