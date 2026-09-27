# Build task deployment — September 27, 2026

## Final release

- Application: TestManage3, PR #1, branch `feat/integration` (PR remains open).
- Destination: SSH alias `252`, existing Docker service `testmanage3`.
- Public page: `https://test3.nfvd.net/main/build-tasks`.
- Application revision: `58a08e49d7f23a3c646c3f59a72281bd88c31edd`.
- Image: `testmanage3:build-tasks-58a08e4`.
- Image ID: `sha256:dfbfea30fb87151c966032565242d613b6503b62d4b2e62e6b01fc565eb8dcdd`.
- Archive SHA-256: `20c5af8e018240cd53d2737cae29c72879d61e6b6ed44b2f1b75083ce8f0a25e`.
- Platform: Linux x64, glibc, Node 24, ABI 137.
- Switched at `2026-09-27T06:54:30Z` (14:54 Singapore time).

The first build-task release, `b3c444f10cf1a9f59609ccc64fe0954292efcc99`, went live
at `2026-09-27T05:11:26Z`. The final release fixes timestamp serialization: SQLite
UTC timestamps now have an explicit zone in API responses, and the browser renders
them in the user's local timezone. This replacement did not submit another factory
run. A later documentation-only commit does not change the deployed artifact.

The image contains the production build, dependencies and example configuration.
Runtime secrets and business storage remain in the existing host mounts. The
archive excludes `.env` files, and the final switch verified that runtime
configuration bytes were unchanged.
The GitHub trigger credential is in the private runtime configuration only.
The factory companion PR #382 was merged as
`24c0eb1d2457b48fbc3d369ef8a0e5aafb6295e4`, and the
`factory:external` label was provisioned before enabling dispatch.

## Upgrade and preservation

The new migration creates `build_tasks`, `build_task_comments` and
`build_task_runs`. The new seed adds `build-task-operator` without changing
existing permission sets or assigning permissions to existing users. Administrators
assign the **Build task operator** role through Users.

A production-data clone, with no network or published ports, passed startup,
migrations, native administrator authentication, anonymous rejection, ordinary
user rejection, granting the operator role, task creation/editing, commenting,
disabled-dispatch rejection and restart persistence. Saving or commenting
created no execution. The clone's sessions were revoked. The final image repeated
these checks against the latest production snapshot, including the existing
completed task and its history.

The final pre-switch consistent SQLite and storage backup is retained at
`/srv/testmanage3-backups/pre-build-tasks-20260927T065413648771Z`.
The previous image is `testmanage3:build-tasks-b3c444f`. The initial deployment also
retains its backup at
`/srv/testmanage3-backups/pre-build-tasks-20260927T051110866426Z` and previous image
`testmanage3:metadata-ea403dd`. Rollback switches code and
configuration; it does not discard accepted business writes or reverse schema
history. The added tables do not replace existing ones.

Exact comparisons at the final switch preserved all 33 feature points, 136 problems,
93 missing items, 140 activities, 21 report records, 16 report subjects, three
archive records, one build task, two comments and one execution. Existing comment,
image and permission records were unchanged. The initial deployment had preserved
129 problems and 14 reports; additional report intake occurred between releases.
SQLite integrity checks passed. The application's base path, public
origin, port binding, data mount and stable authentication secrets were retained.

## Verification

- Client, server and node-project type checks passed. Local checks used the Node
  selected by pnpm; they are not evidence of a local Node 24 test run.
- Scoped formatting, ESLint and client/server locale checks passed.
- The six-file regression run passed 92 tests. Subsequent focused verification
  passed all 17 build-task tests (12 logic and five component tests), including
  report races and continuation ancestry. These scoped runs cover 94 distinct
  tests overall.
- Linux x64 production build, native-module retargeting, archive inspection and
  all 28 server runtime dependency checks passed. The image and live container
  were independently verified as Node 24 / ABI 137.
- Public HTTPS Chrome validation created a task, added a comment and clicked
  the explicit run confirmation. No browser page errors occurred.
- Replaying the same idempotency key returned the same run. A second comment
  during execution did not change the submitted snapshot. Automatic refresh
  preserved an unsaved comment draft. The 390-pixel mobile view did not overflow.
- Production restart and final container replacement preserved the task, two
  comments, execution and successful result. Authentication, existing Problems
  and Build Tasks APIs remained functional. Test sessions were revoked.
- Final browser verification at `2026-09-27T06:54:53.001Z` confirmed UTC API
  timestamps and the first comment displayed as `2026/9/27 13:13:39` in
  Asia/Singapore. Exactly one run remained, Run once was available, PR/report links
  were correct and the original report returned HTTP 200. Production logs contained
  no error-level entries at the final check.

## Live execution and callback

- Task: `e91bf52c-2b6f-4123-bd82-49e40b9ef0e8`.
- Run: `5d027168-ecc5-4c19-89ff-2bb3d8fb3b2d`.
- Factory Issue: `gchust/nb3-factory#384`.
- GitHub workflow run: `36300103008`.
- Published code PR: `gchust/nb3-factory#385` (open).
- Receipt/report ID: `fb4faa25-6d6d-4db4-a40c-a7f185d031f2`.
- Report stored at `2026-09-27T06:41:12.372Z`; authenticated import returned HTTP 201. The callback completed on the server while the browser was closed.
- Final result: execution `completed`, acceptance `passed`, delivery `published`.
  The active-task lock was released, and the result appears in run history.
- The saved requirements and first comment are present in the submitted Issue.
  The second comment is retained for a later submission.
- The automatic Issue-opened workflow `36300104015` skipped every job, confirming
  that Issue creation did not start a duplicate build. The replacement deployment
  kept the single original execution.

Original report:
`https://gchust.github.io/nb3-factory/reports/issues/384/runs/36300103008/attempt-1/index.html`.

## Evidence and cleanup

Final image, trial, deployment, browser and health evidence is stored on 252 under
`/srv/testmanage3-build-tasks-58a08e4/`. Initial deployment, restart and receipt
evidence remains under `/srv/testmanage3-build-tasks-b3c444f/`. Credentials are
excluded from evidence. Both isolated validation containers and temporary database
copies were removed; consistent backups and previous images remain available.

API and configuration contract: [Build tasks](build-tasks.md). Earlier intake
history: [Evaluation integration](evaluation-integration.md).
