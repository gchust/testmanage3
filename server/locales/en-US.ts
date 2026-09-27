import type { LocaleResource } from '@nocobase/i18n';

// The application's own server-side wording. It is empty because every string the server produces today belongs to a
// plugin's namespace; add keys here as the application starts producing its own, and use `overrides` to reword a
// plugin's.
const enUS = {
  buildTasks: {
    title: 'Build tasks',
    operator: 'Build task operator',
    permissions: {
      read: 'Read tasks and results',
      manage: 'Create and edit tasks',
      comment: 'Append requirements',
      run: 'Trigger builds and synchronize status',
    },
  },
};

export type AppServerResource = LocaleResource<typeof enUS>;

export default enUS;
