import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
} from '@nocobase/app-client/plugins';
import { describe, expect, it } from 'vitest';

import applicationRoutes from '../../client/routes.ts';
import routeComponentOverrides from '../../client/route-overrides.ts';
import sourceExtensions from '../../client/source-extensions.ts';

describe('app client routes', () => {
  it('owns authentication pages instead of overriding plugin routes', () => {
    expect(sourceExtensions).toEqual([]);
    expect(routeComponentOverrides).toEqual([]);
  });

  it('declares application and settings route contributions', async () => {
    expect(applicationRoutes).toHaveLength(3);
    const routes = applicationRoutes[0].routes;
    expect(routes.slice(0, 6)).toMatchObject([
      { auth: 'required', name: 'evaluations', path: '/progress/evaluations' },
      {
        auth: 'required',
        name: 'homeRedirect',
        path: '/',
      },
      { auth: 'guest', name: 'login', path: '/login' },
      { auth: 'guest', name: 'register', path: '/register' },
      {
        auth: 'guest',
        name: 'forgot-password',
        path: '/forgot-password',
      },
      { auth: 'guest', name: 'reset-password', path: '/reset-password' },
    ]);
    // The tracker pages are the top-level navigation; the API reference is
    // route-addressable but deliberately not a menu entry.
    expect(routes.slice(6)).toMatchObject([
      { name: 'testProgressOverview', path: '/progress' },
      { name: 'testProgressFeatures', path: '/progress/features' },
      { name: 'testProgressProblems', path: '/progress/problems' },
      { name: 'testProgressApi', path: '/progress/api' },
      {
        name: 'testProgressMissingItemsRedirect',
        path: '/progress/missing-items',
      },
      { name: 'testProgressIssuesRedirect', path: '/progress/issues' },
    ]);
    expect((routes[9] as { navigation?: unknown }).navigation).toBeUndefined();
    expect(applicationRoutes[1]).toEqual({
      parent: 'settings',
      routes: [],
    });
    // Development-only comparisons: a build boundary, not a permission one.
    expect(applicationRoutes[2]).toMatchObject({
      parent: 'dev',
      routes: [{ name: 'palettePreview', path: '/palette-preview' }],
    });
    expect(Object.isFrozen(applicationRoutes[0])).toBe(true);
    expect(Object.isFrozen(applicationRoutes[1])).toBe(true);
    for (const route of collectDeclaredRoutes(routes)) {
      if (!route.componentLoader) continue;
      await expect(route.componentLoader()).resolves.toMatchObject({
        default: expect.any(Function),
      });
    }
  });

  it('pins the route names page grants are stored against', () => {
    // A route's `name` is the identifier a stored page grant records. Renaming one is a data change that has to
    // migrate the grants that name it, not a refactor — so changing this list deliberately is the point.
    const resolved = resolveAppClientContributions([
      {
        packageName: '@nocobase/app-template-default',
        routes: applicationRoutes,
        source: 'application',
      },
    ]);

    expect(pageAuthorizations(resolved.routes)).toEqual([
      { name: 'evaluations', authorizedAs: 'evaluations' },
      // `/` only forwards to the overview, so it is reachable by every signed-in user.
      { name: 'homeRedirect', authorizedAs: null },
      // The tracker's entry pages are ordinary page resources: a grant names the route.
      { name: 'testProgressOverview', authorizedAs: 'testProgressOverview' },
      { name: 'testProgressFeatures', authorizedAs: 'testProgressFeatures' },
      // Overlays and the covering detail page add no check of their own; the parent guard covers them.
      { name: 'testProgressFeatureNew', authorizedAs: null },
      { name: 'testProgressFeatureDetail', authorizedAs: null },
      { name: 'testProgressFeatureEdit', authorizedAs: null },
      {
        name: 'testProgressProblems',
        authorizedAs: 'testProgressProblems',
      },
      { name: 'testProgressProblemNew', authorizedAs: null },
      { name: 'testProgressProblemDetail', authorizedAs: null },
      { name: 'testProgressProblemEdit', authorizedAs: null },
      // The API reference is an ordinary page resource like the tracker pages.
      { name: 'testProgressApi', authorizedAs: 'testProgressApi' },
      // Old paths stay reachable and are covered by their own page check.
      { name: 'testProgressMissingItemsRedirect', authorizedAs: null },
      { name: 'testProgressIssuesRedirect', authorizedAs: null },
    ]);
  });
});

type DeclaredRoute = (typeof applicationRoutes)[number]['routes'][number];

function collectDeclaredRoutes(
  routes: readonly DeclaredRoute[],
): DeclaredRoute[] {
  return routes.flatMap((route) => [
    route,
    ...collectDeclaredRoutes(route.children ?? []),
  ]);
}

/** Page authorization comes directly from the registered tree. */
function pageAuthorizations(
  routes: readonly AppClientRegisteredRoute[],
): { name: string; authorizedAs: string | null }[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader && route.auth === 'required'
      ? [
          {
            name: route.name,
            authorizedAs:
              route.authz === 'skip'
                ? null
                : route.authz.resource.type === 'page'
                  ? route.authz.resource.id
                  : `${route.authz.resource.type}:${route.authz.resource.id}`,
          },
        ]
      : []),
    ...pageAuthorizations(route.children ?? []),
  ]);
}
