import { defineAuthorizationResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization';

export const evaluationCollections = [
  'evaluationReports',
  'evaluationSubjects',
  'evaluationFindings',
  'evaluationMappings',
  'evaluationRegressions',
  'evaluationSources',
  'evaluationAudit',
  'evaluationBundleFiles',
  'featurePoints',
  'issues',
] as const;
const data = (name: string) =>
  defineDatabasePermission((p) => p.collection(name).read('*'));
const reports = data('evaluationReports'),
  subjects = data('evaluationSubjects'),
  findings = data('evaluationFindings'),
  mappings = data('evaluationMappings'),
  regressions = data('evaluationRegressions'),
  sources = data('evaluationSources');
const audit = defineDatabasePermission((p) =>
  p.collection('evaluationAudit').read('*').create('*'),
);
export const evaluationResource = defineAuthorizationResource(
  'evaluations',
  (r) =>
    r
      .group('evaluations')
      .title({ key: 'evaluations.title', ns: 'app' })
      .action('read', (a) =>
        a
          .title({ key: 'evaluations.permissions.read', ns: 'app' })
          .grant('reports', reports)
          .grant('subjects', subjects)
          .grant('findings', findings)
          .grant('mappings', mappings)
          .grant('regressions', regressions),
      )
      .action('review', (a) =>
        a
          .title({ key: 'evaluations.permissions.review', ns: 'app' })
          .grant('reports', reports)
          .grant('subjects', subjects)
          .grant(
            'findings',
            findings.update(['problemId', 'status', 'note', 'updatedAt']),
          )
          .grant('mappings', mappings.create('*').update('*'))
          .grant('regressions', regressions.create('*'))
          .grant('features', data('featurePoints'))
          .grant('problems', data('issues'))
          .grant('audit', audit),
      )
      .action('manage', (a) =>
        a
          .title({ key: 'evaluations.permissions.manage', ns: 'app' })
          .grant('sources', sources.create('*').update(['enabled']))
          .grant('audit', audit),
      ),
);
