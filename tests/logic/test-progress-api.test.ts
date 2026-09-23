import { describe, expect, it } from 'vitest';

import { describeApiError } from '../../client/pages/test-progress/api.js';

describe('describeApiError', () => {
  it('prefers the server message over the transport error', () => {
    expect(
      describeApiError({
        payload: { code: 'CONFLICT', message: 'has children' },
      }),
    ).toBe('has children');
  });

  it('falls back to the error message and then to the value itself', () => {
    expect(describeApiError(new Error('network down'))).toBe('network down');
    expect(describeApiError('plain failure')).toBe('plain failure');
  });
});
