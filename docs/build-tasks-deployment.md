# Build task deployment

What a deployment has to prepare before enabling build tasks, and what to check
afterwards. The API and configuration contract is in [Build tasks](build-tasks.md);
earlier report intake is in [Evaluation integration](evaluation-integration.md).

## Prerequisites

1. Deploy the factory side first. Its selected workflow must declare the
   `factory:external-closed-v1` capability marker and an `external_run_id`
   input, and its run name must end with `request <external_run_id>`. The
   repository needs the `factory:external` label, which keeps the Issue-opened
   event from starting a second build. TestManage checks all three before it
   creates an Issue.
2. Store a credential scoped to the factory repository (Issues write, Actions
   write, Contents read) in the private runtime configuration as
   `buildTasks.token` or `FACTORY_GITHUB_TOKEN`. It never reaches the browser,
   a snapshot, an Issue or a report.
3. Keep `buildTasks.enabled: false` until the factory side is merged. Tasks can
   be drafted and commented while it is disabled; runs stay disabled.

## Upgrade

The migration creates `build_tasks`, `build_task_comments` and
`build_task_runs`; existing tables are unchanged. The seed adds the unassigned
`build-task-operator` permission set without changing existing sets or
assigning anyone. Administrators assign the **Build task operator** role
through Users.

Before switching a production instance, apply the release to an isolated copy
of production data with integrations disabled and no network, and compare
business rows and permission sets before and after. Back up the database
consistently and keep the previous image for rollback. Rolling back switches
code and configuration; it does not discard accepted business writes or reverse
schema history.

## Verification

- Anonymous requests and users without the operator role are refused (401 and
  403); after assigning the role the task list loads.
- Saving or commenting a task creates no execution; a run with the integration
  disabled returns 503 and creates none.
- With the integration enabled, one confirmed run creates a new Issue, closes it
  for archival, dispatches the workflow and appears in run history. Replaying
  its idempotency key returns the same run, and the Issue-opened workflow skips.
- The factory's authenticated report import completes the run, and its
  execution, acceptance and delivery appear with the original report link.
- A run released from the UI shows as released with who released it, and the
  task can run again.
- API timestamps carry an explicit zone and display in the viewer's time zone.
