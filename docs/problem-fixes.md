# Claude Code problem fixes

A problem's detail page can send the problem to the factory's Claude Code
workflow. Claude Code re-checks the problem against the latest
`nocobase/nocobase3` source; when it is confirmed, it fixes it and the factory
opens a draft PR under the maintainer's GitHub account. The conclusion returns
to TestManage as one problem comment, and a PR moves a `pending` problem to
`fixing`. Every run spends the maintainer's Claude Code subscription quota, so
nothing starts without an explicit, confirmed click.

Clicking **交给 Claude Code 复核修复** freezes the current description and all
existing comments into the run, then dispatches the configured workflow. Later
comments reach only the next run. One run may be active per problem; a click has
a durable idempotency key, so a retry returns the same run. No Issue is created.
An uncertain GitHub submission stays active as `dispatch_unknown` and is
reconciled by Refresh through its external request id, never resubmitted.

A maintainer can also start the workflow manually from GitHub with a problem id.
That execution registers itself as a run (origin `github`) under the same lock
and history, and reports back the same way.

## Staff API

Paths are relative to the application API base
(`https://test3.nfvd.net/main/api`). They require a session or native user API
key and the `problemFixes` resource permission.

| Method | Path                                                  | Purpose                    | Permission |
| ------ | ----------------------------------------------------- | -------------------------- | ---------- |
| GET    | `/problem-fixes/problems/:problemId/runs`             | Runs and integration state | read       |
| POST   | `/problem-fixes/problems/:problemId/runs`             | Submit one frozen run      | run        |
| POST   | `/problem-fixes/problems/:problemId/runs/:id/refresh` | Reconcile with GitHub      | run        |

`GET` returns `{ data: { runs, configured, repository } }`, newest first. `POST
…/runs` requires a UUID `Idempotency-Key` header and returns 202 `{ data: run }`;
another key while a run is active returns 409 `ACTIVE_RUN`, and a missing
integration returns 503 `NOT_CONFIGURED`. A run view is
`{ id, problemId, origin, status, active, requestedByName, createdAt, updatedAt,
workflowRunId, workflowRunUrl, error, result }` with
`result: { verdict, summary, pullRequestUrl, branch } | null`. Snapshots and
credentials are never returned to the browser.

Statuses: `dispatching`, `queued`, `running`, `awaiting_result` (the workflow
finished without reporting; the lock is released), `completed`, `failed`,
`cancelled`, `dispatch_failed`, `dispatch_unknown`.

The **问题修复操作员** (`problem-fix-operator`) permission set grants both
actions. It is not assigned to anyone; administrators assign it through Users.

## Factory protocol

The factory authenticates with the same source-bound integration key that
`POST /evaluations/import` accepts (`x-api-key` or `Authorization: Bearer`).
Sessions and ordinary user API keys are rejected with 401. A run belongs to the
source that dispatched or registered it.

`POST /problem-fixes/factory/claims` with
`{ problemId, externalRunId: uuid | null, workflowRunId: "digits", workflowRunAttempt }`
binds the execution to its run and returns `{ data: { runId, snapshot } }`:
200 for an existing run, 201 when a manual GitHub dispatch registers a new one.
A claim of another workflow run id, or of a run that already has a result, is 409. A GitHub rerun of the same workflow run may re-claim a run that Refresh
released as failed, cancelled or `awaiting_result`, while no other run holds the
problem.

The snapshot is
`{ version: 1, capturedAt, problemUrl, problem: { id, title, description, type,
status, featurePointName, owner, factorySource }, comments, commentsOmitted }`.
`problemUrl` needs `app.publicOrigin`; it is null otherwise. `comments` keeps the
newest 200 comments within 200 KiB, chronologically; `commentsOmitted` counts the
older ones left out.

`POST /problem-fixes/factory/runs/:runId/result` with
`{ workflowRunId, workflowRunUrl, verdict, summary, analysis, pullRequestUrl,
branch, baseSha }` records the single result. `verdict` is one of `confirmed`,
`not_reproducible`, `already_fixed`, `not_framework`, `needs_info`, `error`; a PR
is accepted only with `confirmed`. `workflowRunUrl` must name the source
repository and `workflowRunId`, and the run must already be bound to that
workflow run id (by its claim or the dispatch response). The result, one
comment by **Claude Code**, and the `pending` → `fixing` change with its timeline
entry commit in one transaction; a replay returns the stored run without writing
again. Other statuses are never changed. The comment stays within the 20,000
character comment limit by truncating the analysis.

## Configuration

```yaml
problemFixes:
  enabled: false
  repository: gchust/nb3-factory
  workflow: framework-fix.yml
  ref: develop
  token: '' # empty reuses buildTasks.token
```

`PROBLEM_FIXES_ENABLED` and `PROBLEM_FIXES_GITHUB_TOKEN` override enablement and
the credential. The credential needs Actions write and Contents read on the
factory repository; the existing factory credential already has both. It stays
on the server.

## Deployment prerequisites

1. Merge the factory workflow first. Before each dispatch TestManage reads the
   workflow at `ref` and requires the `testmanage:problem-fix-v1` marker and an
   `external_run_id` input. Its run name must end with
   `request <external_run_id>` so Refresh can find an unconfirmed submission.
2. The factory must hold an enabled source-bound integration key for its
   repository (the existing report-delivery key serves).
3. Deploy TestManage. The migration creates `problem_fix_runs`; the seed adds the
   unassigned operator permission set. Existing tables are unchanged.
4. Set `problemFixes.enabled: true`, assign the operator permission set, and
   verify one run end to end.
