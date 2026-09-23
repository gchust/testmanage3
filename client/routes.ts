import {
  Gauge,
  ListChecks,
  Palette,
  TriangleAlert,
} from 'lucide-react';
import {
  defineAppRoutes,
  defineDevRoutes,
  defineSettingsRoutes,
  type AppClientRouteContribution,
} from '@nocobase/app-client/plugins';

// The tracker's pages are the application's top-level navigation: Overview,
// Feature points, Problems. The API reference stays route-addressable but is
// deliberately absent from the menu — it serves Agents, not users.
const appRoutes: AppClientRouteContribution = defineAppRoutes([
  {
    auth: 'required',
    authz: 'skip',
    componentLoader: () => import('./pages/home-redirect.js'),
    name: 'homeRedirect',
    path: '/',
  },
  {
    auth: 'guest',
    componentLoader: () => import('./pages/auth/login.js'),
    name: 'login',
    path: '/login',
  },
  {
    auth: 'guest',
    componentLoader: () => import('./pages/auth/register.js'),
    name: 'register',
    path: '/register',
  },
  {
    auth: 'guest',
    componentLoader: () => import('./pages/auth/forgot-password.js'),
    name: 'forgot-password',
    path: '/forgot-password',
  },
  {
    auth: 'guest',
    componentLoader: () => import('./pages/auth/reset-password.js'),
    name: 'reset-password',
    path: '/reset-password',
  },
  {
    auth: 'required',
    componentLoader: () => import('./pages/test-progress/index.js'),
    name: 'testProgressOverview',
    navigation: { title: 'navigation.testProgressOverview', icon: Gauge },
    path: '/progress',
  },
  {
    auth: 'required',
    breadcrumb: { title: 'navigation.testProgressFeatures' },
    componentLoader: () => import('./pages/test-progress/features/index.js'),
    name: 'testProgressFeatures',
    navigation: {
      title: 'navigation.testProgressFeatures',
      icon: ListChecks,
    },
    path: '/progress/features',
    children: [
      {
        componentLoader: () =>
          import('./pages/test-progress/features/feature-form.js'),
        name: 'testProgressFeatureNew',
        path: 'new',
      },
      {
        breadcrumb: { title: 'navigation.testProgressFeatureDetail' },
        componentLoader: () =>
          import('./pages/test-progress/features/feature-detail.js'),
        name: 'testProgressFeatureDetail',
        path: ':featurePointId',
        children: [
          {
            componentLoader: () =>
              import('./pages/test-progress/features/feature-form.js'),
            name: 'testProgressFeatureEdit',
            path: 'edit',
          },
        ],
      },
    ],
  },
  {
    auth: 'required',
    breadcrumb: { title: 'navigation.testProgressProblems' },
    componentLoader: () => import('./pages/test-progress/problems/index.js'),
    name: 'testProgressProblems',
    navigation: {
      title: 'navigation.testProgressProblems',
      icon: TriangleAlert,
    },
    path: '/progress/problems',
    children: [
      {
        componentLoader: () =>
          import('./pages/test-progress/problems/problem-form.js'),
        name: 'testProgressProblemNew',
        path: 'new',
      },
      {
        breadcrumb: { title: 'navigation.testProgressProblemDetail' },
        componentLoader: () =>
          import('./pages/test-progress/problems/problem-detail.js'),
        name: 'testProgressProblemDetail',
        path: ':problemId',
        children: [
          {
            componentLoader: () =>
              import('./pages/test-progress/problems/problem-form.js'),
            name: 'testProgressProblemEdit',
            path: 'edit',
          },
        ],
      },
    ],
  },
  {
    // Not a menu entry: the reference exists for Agents that read or copy it.
    auth: 'required',
    breadcrumb: { title: 'navigation.testProgressApi' },
    componentLoader: () => import('./pages/test-progress/api/index.js'),
    name: 'testProgressApi',
    path: '/progress/api',
  },
  {
    // The two former pages became one list with a type filter; keep their
    // paths working so old links land on the equivalent filter. The redirect
    // only rewrites the URL, so it grants access by itself and the target
    // page keeps enforcing its own permission.
    auth: 'required',
    authz: 'skip',
    componentLoader: () =>
      import('./pages/test-progress/problems/missing-items-redirect.js'),
    name: 'testProgressMissingItemsRedirect',
    path: '/progress/missing-items',
  },
  {
    auth: 'required',
    authz: 'skip',
    componentLoader: () =>
      import('./pages/test-progress/problems/issues-redirect.js'),
    name: 'testProgressIssuesRedirect',
    path: '/progress/issues',
  },
]);

const settingsRoutes: AppClientRouteContribution = defineSettingsRoutes([]);

// Development-only: design comparisons that must not ship. `defineDevRoutes()`
// is a build boundary — the page and its module are absent from production.
const devRoutes: AppClientRouteContribution = defineDevRoutes([
  {
    componentLoader: () => import('./pages/dev/palette-preview.js'),
    name: 'palettePreview',
    navigation: { title: 'dev.palettePreview', icon: Palette },
    path: '/palette-preview',
  },
]);

const routes: readonly AppClientRouteContribution[] = [
  appRoutes,
  settingsRoutes,
  devRoutes,
];

export default routes;
