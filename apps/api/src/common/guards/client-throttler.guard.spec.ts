import { ClientThrottlerGuard } from './client-throttler.guard';

// getTracker is protected; reach it through a thin subclass rather than
// standing up the whole throttler module, since keying is all that's under test.
class Probe extends ClientThrottlerGuard {
  key(req: Record<string, unknown>) {
    return this.getTracker(req);
  }
}

const guard = Object.create(Probe.prototype) as Probe;

describe('ClientThrottlerGuard keying', () => {
  it('keys a signed-in request by user, so a shared campus address is not shared quota', async () => {
    const a = await guard.key({ ip: '203.0.113.7', path: '/api/v1/students', user: { id: 'u1' } });
    const b = await guard.key({ ip: '203.0.113.7', path: '/api/v1/students', user: { id: 'u2' } });
    expect(a).toBe('user:u1');
    expect(b).toBe('user:u2');
  });

  it('keys login by address + email, normalised, so classmates on one network sign in independently', async () => {
    const a = await guard.key({ ip: '203.0.113.7', path: '/api/v1/auth/login', body: { email: ' Nurse.A@AU.edu ' } });
    const b = await guard.key({ ip: '203.0.113.7', path: '/api/v1/auth/login', body: { email: 'nurse.b@au.edu' } });
    expect(a).toBe('login:203.0.113.7:nurse.a@au.edu');
    expect(b).not.toBe(a);
  });

  it('keeps repeated guesses at one account in one bucket', async () => {
    const first = await guard.key({ ip: '198.51.100.2', path: '/api/v1/auth/login', body: { email: 'lecturer@au.edu' } });
    const again = await guard.key({ ip: '198.51.100.2', path: '/api/v1/auth/login', body: { email: 'LECTURER@au.edu' } });
    expect(again).toBe(first);
  });

  it('falls back to the client address for other anonymous requests', async () => {
    expect(await guard.key({ ip: '198.51.100.2', path: '/api/v1/auth/refresh', body: { email: 'x@y.z' } })).toBe('ip:198.51.100.2');
    expect(await guard.key({ ip: '198.51.100.2', path: '/api/v1/health' })).toBe('ip:198.51.100.2');
  });
});
