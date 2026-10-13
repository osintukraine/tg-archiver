import { describe, it, expect } from 'vitest';
import { isRouteExempt } from '../content-warning-config';

describe('content warning exempt routes', () => {
  it.each(['/admin', '/admin/channels', '/admin/messages/42'])(
    'exempts the admin area (%s): admins are authenticated operators',
    (path) => {
      expect(isRouteExempt(path)).toBe(true);
    },
  );

  it.each(['/auth/login', '/about', '/suggest-channel'])('keeps existing exemptions (%s)', (path) => {
    expect(isRouteExempt(path)).toBe(true);
  });

  it.each(['/', '/messages/1', '/channels/foo', '/search'])('still gates public archive pages (%s)', (path) => {
    expect(isRouteExempt(path)).toBe(false);
  });
});
