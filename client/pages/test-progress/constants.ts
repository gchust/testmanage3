import type {
  AvailabilityStatus,
  CriteriaState,
  ExampleExistsStatus,
  FeatureStatus,
  ProblemStatus,
  ProblemType,
} from './api.js';

export const FEATURE_STATUSES: readonly FeatureStatus[] = [
  'testable',
  'developed',
  'testCompleted',
  'refactoring',
  'inProgress',
  'deferred',
  'unspecified',
];

export const AVAILABILITY_STATUSES: readonly AvailabilityStatus[] = [
  'available',
  'missing',
  'unspecified',
];

export const EXAMPLE_EXISTS_STATUSES: readonly ExampleExistsStatus[] = [
  'yes',
  'no',
  'unspecified',
];

/** Order used by the problem page filter and the form. */
export const PROBLEM_TYPES: readonly ProblemType[] = [
  'skills',
  'docs',
  'example',
  'automation',
  'manual',
];

export const PROBLEM_STATUSES: readonly ProblemStatus[] = [
  'pending',
  'fixing',
  'regression',
  'verified',
  'cancelled',
];

/** Material gaps count towards a criteria cell; test findings do not. */
export const MATERIAL_PROBLEM_TYPES: readonly ProblemType[] = [
  'skills',
  'docs',
  'example',
];

/**
 * Status colors are semantic rather than generic: green is done, amber is work in
 * progress, blue is a reached milestone, red is blocked or missing, and a dashed
 * grey chip means "not filled in yet" — the one state that must never be mistaken
 * for a filled one.
 */
export const FEATURE_STATUS_CELL_CLASS: Record<FeatureStatus, string> = {
  testable: 'bg-info-muted',
  developed: 'bg-info-muted',
  testCompleted: 'bg-success-muted',
  refactoring: 'bg-warning-muted',
  inProgress: 'bg-warning-muted',
  deferred: 'bg-destructive/5',
  unspecified: '',
};

export const FEATURE_STATUS_DOT_CLASS: Record<FeatureStatus, string> = {
  testable: 'bg-info',
  developed: 'bg-info',
  testCompleted: 'bg-success',
  refactoring: 'bg-warning',
  inProgress: 'bg-warning',
  deferred: 'bg-destructive',
  unspecified: 'bg-muted-foreground/40',
};

export const FEATURE_STATUS_TEXT_CLASS: Record<FeatureStatus, string> = {
  testable: 'text-info',
  developed: 'text-info',
  testCompleted: 'text-success',
  refactoring: 'text-warning',
  inProgress: 'text-warning',
  deferred: 'text-destructive',
  unspecified: 'text-muted-foreground',
};

/** Derived criteria cell: see criteriaState() in api.ts. */
export const CRITERIA_STATES: readonly CriteriaState[] = [
  'unspecified',
  'missing',
  'complete',
  'hasGaps',
];

export const CRITERIA_DOT_CLASS: Record<CriteriaState, string> = {
  unspecified: 'bg-muted-foreground/40',
  missing: 'bg-destructive',
  complete: 'bg-success',
  hasGaps: 'bg-warning',
};

export const CRITERIA_TEXT_CLASS: Record<CriteriaState, string> = {
  unspecified: 'text-muted-foreground',
  missing: 'text-destructive',
  complete: 'text-success',
  hasGaps: 'text-warning',
};

/** Soft cell tint so a criteria column reads as filled / gaps / missing at a glance. */
export const CRITERIA_CELL_CLASS: Record<CriteriaState, string> = {
  unspecified: '',
  missing: 'bg-destructive/5',
  complete: 'bg-success-muted',
  hasGaps: 'bg-warning-muted',
};

export const PROBLEM_STATUS_CELL_CLASS: Record<ProblemStatus, string> = {
  pending: '',
  fixing: 'bg-warning-muted',
  regression: 'bg-info-muted',
  verified: 'bg-success-muted',
  cancelled: 'bg-muted/60',
};

export const PROBLEM_STATUS_DOT_CLASS: Record<ProblemStatus, string> = {
  pending: 'bg-muted-foreground/40',
  fixing: 'bg-warning',
  regression: 'bg-info',
  verified: 'bg-success',
  cancelled: 'bg-muted-foreground/50',
};

export const PROBLEM_STATUS_TEXT_CLASS: Record<ProblemStatus, string> = {
  pending: 'text-muted-foreground',
  fixing: 'text-warning',
  regression: 'text-info',
  verified: 'text-success',
  cancelled: 'text-muted-foreground line-through',
};

export const EXAMPLE_EXISTS_DOT_CLASS: Record<ExampleExistsStatus, string> = {
  yes: 'bg-success',
  no: 'bg-destructive',
  unspecified: 'bg-muted-foreground/40',
};

export const EXAMPLE_EXISTS_TEXT_CLASS: Record<ExampleExistsStatus, string> = {
  yes: 'text-success',
  no: 'text-destructive',
  unspecified: 'text-muted-foreground',
};

export const AVAILABILITY_DOT_CLASS: Record<AvailabilityStatus, string> = {
  available: 'bg-success',
  missing: 'bg-destructive',
  unspecified: 'bg-muted-foreground/40',
};

export const AVAILABILITY_TEXT_CLASS: Record<AvailabilityStatus, string> = {
  available: 'text-success',
  missing: 'text-destructive',
  unspecified: 'text-muted-foreground',
};

/**
 * Timeline node colors. A node reads from the state the entry produced, and the
 * palette stays brighter than the status chips so a long history scans as colour
 * instead of a row of grey dots.
 */
export const PROBLEM_ACTIVITY_DOT_CLASS: Record<
  'created' | ProblemStatus,
  string
> = {
  created: 'bg-primary',
  pending: 'bg-muted-foreground',
  fixing: 'bg-warning',
  regression: 'bg-info',
  verified: 'bg-success',
  cancelled: 'bg-destructive/50',
};

/**
 * Score colour bands, so a filled score reads at a glance instead of hiding among
 * the muted labels: >=8 green, 7–8 blue, 6–7 amber, below 6 red, unrated grey.
 */
export function scoreClass(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 8) return 'text-success';
  if (score >= 7) return 'text-info';
  if (score >= 6) return 'text-warning';

  return 'text-destructive';
}

/** Solid bar colors matching the chips, for the overview's distribution bars. */
export const FEATURE_STATUS_BAR_CLASS: Record<FeatureStatus, string> = {
  testable: 'bg-info',
  developed: 'bg-info/50',
  testCompleted: 'bg-success',
  refactoring: 'bg-warning',
  inProgress: 'bg-warning/50',
  deferred: 'bg-destructive/60',
  unspecified: 'bg-muted-foreground/25',
};
