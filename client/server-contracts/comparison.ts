import type { Report_finding } from './evaluations.js';
export interface Comparison {
  comparable: boolean;
  reasons: string[];
  modules: Array<{
    key: string;
    name: string;
    subjectKeys: string[];
    matched: boolean;
    scores: Array<{
      dimension: string;
      before: number | null;
      after: number | null;
      delta: number | null;
    }>;
  }>;
  findings: {
    added: Report_finding[];
    repeated: Report_finding[];
    notObserved: Report_finding[];
  };
}
