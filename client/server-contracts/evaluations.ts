// Type-only protocol boundary. Browser bundles contain no server implementation.
export type {
  EvaluationReport,
  Report_module,
  Report_finding,
} from '../../server/providers/evaluations/contracts/report.js';
export type { EvaluationBatch } from '../../server/providers/evaluations/contracts/batch.js';
