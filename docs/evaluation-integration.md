# nb3-factory evaluation integration

## Factory problems: the user-facing workflow

GitHub Actions owns selecting unresolved review findings and final failed QA checks. It sends an explicit problem submission together with the unchanged complete report bundle. TestManage only validates, stores and displays those submissions in the existing Problems page (`type=automation`, initially `pending`). Uploading a report alone never creates problems. No additional evaluation is run by TestManage.

Set the factory repository variable `EVALUATION_DELIVERY_FORMAT=testmanage3-problems-v1`. The existing delivery workflow includes a multipart text field `problems` containing `{version: 1, problems: [...]}` alongside `bundle`. Each problem carries a stable key, title, description, subject keys and report finding IDs or a QA criterion ID. The receiver rejects invalid references, oversized submissions and differing issue payloads for the same report revision. Default `bundle-v1` delivery remains compatible with other receivers.

Issue details include the original ZIP, HTML and JSON reports, GitHub task Issue, PR when recorded, and Actions run links. An absent PR is shown explicitly. Problems without an unambiguous feature mapping enter the same list as Uncategorized; no synthetic feature points are created. Replays do not duplicate problems, resurrect deleted problems, or overwrite human titles, notes, ownership and lifecycle status. Old report revisions cannot replace the current evidence.

The standalone evaluation navigation entry is removed. Its old URL and archival API remain for backward compatibility and to retain already received evidence; ordinary work starts and ends on the existing Problems page. Migration rollback requires categorizing all uncategorized problems first.

## Scope

The receiver implements the fixed report, batch, ZIP bundle and top-level receipt v1 contracts from nb3-factory commit `ff7e1e12225bdb868865b36bd4032b423e57e66d`. Original schemas are in `server/providers/evaluations/contracts/`; regenerate TypeScript with `node scripts/generate-evaluation-contracts.mjs`.

- T1: source-bound credentials, strict ZIP/schema/hash validation, archived bundles, database-enforced idempotency, history and current revision selected by protocol precedence.
- T2: module subject-key mapping to existing feature points, rubric scores, requirements, evidence, findings linked to existing issues and human dispositions.
- T3: all planned batch samples, missing/not-received/not-executed states, comparable baselines, finding changes and explicit human regression records.

Machine evaluations never update manual scores or issue status. Reviewer claims remain distinct from human disposition. A finding absent in a comparison is “not observed”, never automatically “fixed”. Usage is the cumulative total from one selected revision, never the sum of revisions. Missing baseline identities, incomplete reviews or batch Agent configuration drift suppress score deltas. Modules match exact subject-key sets; findings match subject keys, kind and title.

## Native NocoBase 3 infrastructure

Run `pnpm skills:sync` and follow the application-local Skills. No standalone plugin or replacement authentication, authorization or storage system is introduced.

| Concern                | Native capability                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Composition            | App ServiceProvider and container tokens                                                        |
| Browser authentication | Authentication `auth.required()`                                                                |
| Machine credentials    | API Keys `ApiKeyService`, separate non-session `evaluation-import` configuration                |
| Permissions            | Fluent Authorization business resources, Permission Sets, record scopes and Repository policies |
| Archive storage        | File Repository uploads/metadata and configured private local Drive disk                        |
| Database               | App migrations, seeds, transactions and Collection/Repository APIs                              |
| Client                 | `useApiClient`, application navigation, i18n and shadcn components                              |

Only evaluation protocol validation, revision selection, comparison and review workflows are application-specific. Import needs a custom endpoint because its contract requires a fixed multipart field, ZIP inspection, a multi-table transaction and a top-level receipt. Staff endpoints bind the exact database policies returned by the business action; they do not re-resolve broader collection grants. The separate machine path enforces its source/project binding.

## Roles

New editable native Permission Sets are installed once:

- `evaluation-reader`: page and read access to reports, batches, mappings, findings and regressions.
- `evaluation-reviewer`: reader access plus mapping, finding review and explicit regression records. Existing feature points and issues are read through the review action’s database policies.
- `evaluation-manager`: reviewer access plus issuing/revoking factory credentials.

Existing administrators retain access through their current unrestricted role. Ordinary users are not silently assigned a new role. Use native Users/Authorization pages to assign the new sets or narrow record scopes. Seeds preserve administrator-edited sets. Report JSON is an atomic evidence document; record permissions do not split individual JSON properties.

## Receiver

`POST <app-base>/api/evaluations/import` accepts exactly one multipart `bundle` field of type `application/zip`. Authenticate with the integration token using either `x-api-key` or Bearer, exclusively. Required headers are `Idempotency-Key`, `X-Evaluation-Schema-Version: 1`, `X-Evaluation-Type` and `X-Evaluation-Bundle-SHA256`.

Initial import returns HTTP 201; identical retry returns HTTP 200 and the original receipt ID. Different bytes at the same source/type/key/revision return 409. Receipts are top-level JSON, never wrapped in `data`, and HTTP 202 is never returned. The batch receipt uses its full subject key. Arrival order and largest revision do not determine the current report.

Limits: 64 MiB ZIP, 128 MiB unpacked, 2,048 entries, 4 MiB JSON, 32 MiB HTML, 10 MiB per PNG and 48 MiB PNG total. The store-only ZIP format is checked for local/central header agreement, UTF-8 paths, duplicate names, links, compression, CRC, manifest hashes and evidence references. Four imports per process may run concurrently; overflow receives 429 with `Retry-After: 5`.

HTML is download-only with attachment disposition, `nosniff` and CSP sandbox. Bundles/evidence are only available through authenticated report endpoints. File Repository’s generated access path is deliberately not registered as a public route. Native file metadata and private Drive objects are committed before the receipt. Back up the database together with the entire configured storage directory. A failed/uncertain database commit never returns success; interrupted uploads may leave native file metadata that should only be cleaned after checking report references.

## Factory configuration

Create a source binding using the actual repository as source instance and project. Configure repository variables:

```text
FACTORY_EVALUATION_DELIVERY=true
EVALUATION_ENDPOINT=https://test3.nfvd.net/main/api/evaluations/import
EVALUATION_AUTH_MODE=x-api-key
```

Store the issued token in the GitHub Actions secret `EVALUATION_TOKEN`. The token is shown once, expires after 365 days and is revocable. It never creates a user session or authorizes ordinary application endpoints. Public API Key self-service requests for the reserved configuration are rejected.

Dispatch `Deliver Evaluation Results` (`deliver-evaluation.yml`) with `mode=replay`, `type=evaluation-report`, full run `key` and `revision`. Replay sends the original archived bundle without another application build or model usage. The existing factory workflow owns retry scheduling; the receiver does not add another scheduler.

## Deployment and verification

Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm nocobase app i18n:check` and `pnpm build --target linux-x64 --node-version 24 --tar`. Migrate/seed using the configured application startup tasks. Regenerate Collection artifacts with `pnpm collections:generate` against an isolated migrated database.

On 252, preserve `/srv/testmanage3-production/storage`, `config.yml` and the current container identity. Consistently back up SQLite and save compose/deployment metadata before switching images. Keep the previous image for rollback; never restore the old unrelated misdeployment.

Verify native credential/session isolation, anonymous/unpermitted access, reader write denial, row/field Repository policies, complete batch samples, source binding, unchanged manual data, concurrent duplicate reception and receipt persistence across restart. Use a real factory artifact with its actual `deliverBundle` sender, then dispatch GitHub delivery against the deployed service. Inspect both its stored receipt and the report page in light/dark themes and English/Chinese.

## Production acceptance — 2026-09-25

Deployed to 252 at 18:41 Singapore time using image `testmanage3:evaluations-ba52b7c`, source revision `ba52b7ce692c8eb260857d3fb2a096b76ab2a043`. The entry is `https://test3.nfvd.net/main/progress/evaluations`. The build targets Linux x64 / glibc / Node 24; the container health check passes.

The real factory report is `gchust/nb3-factory/issues/315/initial`, revision 1. All three deliveries use the original 224,620-byte archive with SHA-256 `45f27de9d4791f6b8060043caf669c4a70615c41623cc6c5218800a14997da7a`. No synthetic fixtures were uploaded to production, and replay did not invoke another Agent build or review.

| Validation                                    | Factory Actions run | Receiver result        |
| --------------------------------------------- | ------------------- | ---------------------- |
| First original-bundle delivery                | `36124635435`       | HTTP 201, stored       |
| Replay from the default `develop` branch      | `36124961001`       | HTTP 200, same receipt |
| Replay after replacing/restarting the service | `36125384963`       | HTTP 200, same receipt |

The persistent receipt is `850c0eea-d66a-4a3c-ac09-577160a4fe93`. Both the factory outbox and the receiver confirm `stored`. There is one report and one native File Repository archive after retries. The sample deliberately has independent review disabled and incomplete usage; the UI preserves “not reviewed” and “partial” instead of inventing scores or complete usage.

Production verification also covers:

- Original 33 feature points, 93 issues, 93 missing items and 97 activity records remain unchanged, including row-content digests. SQLite integrity passes.
- Anonymous access and machine-key access to user/session/report APIs return 401. Reserved API-key self-service create/update/delete return 403, and the default key configuration cannot read the integration key (404).
- Chrome: Chinese/light runs and report details, English/dark report details, all five tabs, original ZIP/JSON/HTML downloads, and attached PNG evidence download. No page errors or unexpected HTTP errors occurred. Downloaded ZIP bytes match the registered hash; HTML remains attachment-only with CSP sandbox.
- Application: 46 test files / 329 tests, typecheck, lint, Linux production build, locale check and 55 generated Collection definitions all pass. Factory evaluation tests: 88 pass; factory regression CI and browser preflight pass.

Live testing found and fixed a factory workflow dependency bug: a skipped optional backfill incorrectly skipped the send job after successful planning. Factory PR `gchust/nb3-factory#331` is merged into `develop`; the final two runs use that default-branch fix. The App also uses Better Auth's public `isAPIError` guard at its native provider boundary to preserve credential refusal statuses across duplicate deployment package constructors.

Rollback backups are under `/srv/testmanage3-backups/`, including `pre-switch-20260925T102337Z` (before the feature migration) and `received-report-20260925T104107Z` (with the accepted report). Keep configuration and the entire storage tree together. Previous images remain available.

Machine-readable receipts, build identity and checks: [production.json](verification/2026-09-25/production.json). Browser evidence: [Chinese runs](verification/2026-09-25/runs-zh-light.png), [English dark report](verification/2026-09-25/report-en-dark.png). These files contain no credentials.
