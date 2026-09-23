// @vitest-environment node

import type { Application } from '@nocobase/app-server/application';
import { ServiceContainer } from '@nocobase/service-provider';
import { describe, expect, it } from 'vitest';

import { apiGuideRoutes } from '../../server/routes/api-guide.js';

function createRouter() {
  return apiGuideRoutes.createRouter({
    publicBasePath: '/main',
    container: new ServiceContainer(),
  } as unknown as Application);
}

describe('api guide route', () => {
  it('serves the Markdown guide to an anonymous reader', async () => {
    const router = await createRouter();
    // The mount adapter strips the public base path before the router sees the request.
    const response = await router.request('http://localhost/api-guide.md');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');

    const text = await response.text();
    expect(text).toContain('# Test Manager 测试进展 API');
    // Absolute URLs come from the request host plus the application base path.
    expect(text).toContain('http://localhost/main/api/test-progress/problems');
    expect(text).toContain('http://localhost/main/uploads/problems/');
    // The authentication contract and the write conventions are part of the guide.
    expect(text).toContain('x-api-key');
    expect(text).toContain('cancelled');
    expect(text).toContain('写入前先 GET 当前值');
  });
});
