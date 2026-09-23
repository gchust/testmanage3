import type { Application } from '@nocobase/app-server/application';
import {
  defineRootRoutes,
  type AppRootRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

import { buildApiGuideMarkdown } from '../api-guide.js';

/**
 * Serves the API reference as Markdown for Agents.
 *
 * It is deliberately public: the document describes endpoints and field values but
 * contains no data, and an Agent has to be able to read it before it holds a key.
 * Every endpoint it describes still enforces its own authentication.
 */
export const apiGuideRoutes: AppRootRouteContribution<Application> =
  defineRootRoutes((app) => {
    const router = new Hono();

    router.get('/api-guide.md', (context) => {
      const origin = new URL(context.req.url).origin;
      const base = app.publicBasePath.replace(/\/$/, '');
      return context.body(
        buildApiGuideMarkdown({
          site: `${origin}${base}/`,
          api: `${origin}${base}/api`,
        }),
        200,
        { 'content-type': 'text/markdown; charset=utf-8' },
      );
    });

    return router;
  });
