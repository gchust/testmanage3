# Build tasks

Tasks and append-only comments live in TestManage. Running a task captures an
immutable requirements/comment snapshot, creates a new factory Issue for that
execution, closes the new Issue for archival, and explicitly dispatches the
existing factory workflow. Saving or commenting never
starts a build. Each click has a durable idempotency key and only one active run
is permitted per task. GitHub execution success and business acceptance remain
separate facts. Existing factory report imports supply the final results.

Every intentional new run has its own Issue, Actions execution and result history.
An idempotent retry returns the existing run without creating or closing another
Issue. Earlier Issues and snapshots are never rewritten or reopened. Closing an
external Issue does not mean the build passed or stopped: task status comes from
Actions and authenticated reports. A failed close is recorded on the run and
prevents dispatch; its Issue link remains visible for diagnosis.

The task-level Issue link is the latest submission; every run in history links to
its own Issue. Earlier unmerged PRs do not block another explicit external run;
the factory creates a separate work branch and PR against the configured target.

The `factory:external` Issue label prevents the Issue-opened event from starting
a second build; the explicit workflow dispatch is the only submission path.
The factory integration change must be deployed before enabling dispatch here;
the entry's `factory:external-closed-v1` capability marker is required. Its prepare
step accepts closed externally labelled Issues only for explicit external runs
and their validated recovery/continuation chain. Ordinary closed Issues retain
their existing stop behavior.
GitHub credentials are server configuration and never reach the browser, task
snapshot, Issue or report. Existing Problems intake and historical data remain.

The page follows existing Test Progress pages: a task table, a task editor, and a
detail page containing requirements, comments and run history. The run button
explains that it submits saved requirements and comments. Comments added during
a build are included in the next run. Status, errors, Issue, Actions, PR and
original report links are visible in the run history.

## API and authorization

All paths below are relative to the application API base
(`<public origin><base path>/api`). Requests use the application's authenticated
session or native user API key and the `buildTasks` resource permissions.
The source-bound evaluation-import credential cannot create or run tasks.

| Method | Path                                    | Purpose                        | Permission |
| ------ | --------------------------------------- | ------------------------------ | ---------- |
| GET    | `/build-tasks`                          | List tasks and latest run      | read       |
| POST   | `/build-tasks`                          | Save a draft                   | manage     |
| GET    | `/build-tasks/:id`                      | Task, comments and run history | read       |
| PATCH  | `/build-tasks/:id`                      | Edit saved requirements        | manage     |
| POST   | `/build-tasks/:id/comments`             | Append `{ "content": "..." }`  | comment    |
| POST   | `/build-tasks/:id/runs`                 | Submit one saved snapshot      | run        |
| POST   | `/build-tasks/:id/runs/:runId/refresh`  | Reconcile an existing run      | run        |
| POST   | `/build-tasks/:id/runs/:runId/release`  | Release a run holding the task | run        |
| GET    | `/build-tasks/:id/runs/:runId/snapshot` | Read the submitted snapshot    | read       |

The run endpoint requires a UUID `Idempotency-Key` header. A retry with the same
key returns the same run; another key while a run is active returns 409.
202 returns a local run record, not a claim that acceptance passed. The existing
`POST /evaluations/import` source-authenticated protocol attaches results.
Concurrent report deliveries preserve the highest producer/review/revision rank.
Task, comment and execution timestamps are returned as ISO 8601 UTC instants
with a zone suffix; the browser displays them in the user's local timezone.

Statuses: `dispatching`, `queued`, `running`, `awaiting_result` and
`dispatch_unknown` hold the task; `completed`, `failed`, `cancelled`,
`dispatch_failed` and `abandoned` do not. A run view also carries `active`
(whether it holds the task) and `released: { byName, at } | null`.

The **Build task operator** permission set grants page access and the four
actions above. Administrators assign it through Users; it is not automatically
granted to every existing account. Task editing is locked during an active run;
comments remain appendable for the next run. The target branch is fixed once an
Issue has been created.

## Configuration

Set `buildTasks.enabled`, `repository`, `workflow`, `ref` and `token` in the
private runtime configuration. `FACTORY_BUILDS_ENABLED` and
`FACTORY_GITHUB_TOKEN` can override enablement and the server-side credential.
Use a credential scoped to the factory repository with Issues write, Actions
write and Contents read access. The browser never receives this credential.
The factory's selected workflow must contain the `factory:external` guard and
`external_run_id` input, and the repository label must exist before enablement.

An uncertain GitHub submission remains active as `dispatch_unknown`. Refresh
finds the workflow using its external request identifier, paging through the
dispatches created since the request; it never automatically resubmits a
request whose delivery cannot be confirmed. While the integration is disabled,
Refresh only replays stored reports and does not call GitHub, and the run
button stays disabled. The menu entry remains, because route navigation cannot
depend on configuration; an empty list says builds are not enabled.

## Releasing a stuck run

A run that will not finish on its own keeps the task locked: a
`dispatch_unknown` submission GitHub never started, a workflow that finished
(`awaiting_result`) but whose report never arrived, or a submission interrupted
mid-dispatch. **Release** on that run, confirmed in a dialog, calls
`POST /build-tasks/:id/runs/:runId/release`. It succeeds only while the run
still holds the task (otherwise 409 `RUN_NOT_ACTIVE`), marks it `abandoned`, and
records who released it and when in the integration audit log
(`evaluationAudit`, action `buildTaskRun.release`); run history shows both.
The task can then be edited and run again. Every write after a run takes the
lock is conditional on still holding it, so a release made while GitHub is
being called is not undone and a released run is not dispatched. A report that
arrives later is still recorded on the released run; a non-final report leaves
it `abandoned`, a final one sets its final status, and neither takes the task
back.
