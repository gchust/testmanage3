import type { EvaluationDocument } from './protocol.js';
import type { Report_finding, Report_module } from './contracts/report.js';

/** Comparison is descriptive. A disappeared finding is never an automatic fix. */
export function compareReports(
  left: EvaluationDocument,
  right: EvaluationDocument,
) {
  if (left.type !== 'evaluation-report' || right.type !== 'evaluation-report')
    return {
      comparable: false,
      reasons: ['report-required'],
      modules: [],
      findings: { added: [], repeated: [], notObserved: [] },
    };
  const reasons: string[] = [];
  const same = (label: string, a: unknown, b: unknown) => {
    if (a === null || a === undefined || b === null || b === undefined)
      reasons.push(label + ':unknown');
    else if (JSON.stringify(a) !== JSON.stringify(b))
      reasons.push(label + ':different');
  };
  same('source', left.source.instance, right.source.instance);
  same('project', left.source.project, right.source.project);
  same('track', left.baseline.track, right.baseline.track);
  same('case-input', left.run.case?.inputHash, right.run.case?.inputHash);
  same('case-review', left.run.case?.reviewHash, right.run.case?.reviewHash);
  same(
    'review-criteria',
    left.baseline.inputs.reviewCriteriaHash,
    right.baseline.inputs.reviewCriteriaHash,
  );
  same('rubric', left.baseline.rubric, right.baseline.rubric);
  for (const key of ['engine', 'model', 'version', 'buildReviewMode'] as const)
    same('agent-' + key, left.baseline.agent[key], right.baseline.agent[key]);
  same(
    'browser-fixtures',
    left.baseline.environment.browserFixturesSha256,
    right.baseline.environment.browserFixturesSha256,
  );
  const a = left.reviews.find((r) => r.selected),
    b = right.reviews.find((r) => r.selected);
  if (a?.state !== 'completed' || b?.state !== 'completed')
    reasons.push('review-incomplete');
  if (left.run.identity === 'unresolved' || right.run.identity === 'unresolved')
    reasons.push('identity-unresolved');
  if (
    left.limitations.some((l) => l.code === 'agent-config-drift') ||
    right.limitations.some((l) => l.code === 'agent-config-drift')
  )
    reasons.push('agent-config-drift');
  // Batch comparability also needs its coordinator snapshot. The route enriches
  // this decision only after locating the exact batch/sample identities.
  const moduleKey = (m: Report_module): string =>
    [...m.subjectKeys].sort().join('\n');
  const before = a?.modules ?? [],
    after = b?.modules ?? [];
  const modules = after.map((m) => {
    const matches = before.filter((old) => moduleKey(old) === moduleKey(m));
    const old =
      m.subjectKeys.length &&
      matches.length === 1 &&
      after.filter((other) => moduleKey(other) === moduleKey(m)).length === 1
        ? matches[0]
        : undefined;
    return {
      key: m.key,
      name: m.name,
      subjectKeys: m.subjectKeys,
      matched: !!old,
      scores: Object.entries(m.scores).map(([dimension, score]) => {
        const previous = old?.scores[dimension]?.score ?? null;
        return {
          dimension,
          before: previous,
          after: score.score,
          delta:
            reasons.length || previous === null || score.score === null
              ? null
              : score.score - previous,
        };
      }),
    };
  });
  const findingKey = (f: Report_finding): string =>
    JSON.stringify([[...f.subjectKeys].sort(), f.kind, f.title.trim()]);
  const oldFindings = a?.findings ?? [],
    newFindings = b?.findings ?? [];
  const oldKeys = new Set(oldFindings.map(findingKey)),
    newKeys = new Set(newFindings.map(findingKey));
  return {
    comparable: reasons.length === 0,
    reasons,
    modules,
    baselines: { before: left.baseline, after: right.baseline },
    acceptance: {
      before: left.outcome.acceptance,
      after: right.outcome.acceptance,
    },
    usage: {
      before: left.metrics.usage.totals,
      after: right.metrics.usage.totals,
    },
    findings: {
      matching: 'same-subject-kind-title',
      added: newFindings.filter((f) => !oldKeys.has(findingKey(f))),
      repeated: newFindings.filter((f) => oldKeys.has(findingKey(f))),
      notObserved: oldFindings.filter((f) => !newKeys.has(findingKey(f))),
    },
  };
}
