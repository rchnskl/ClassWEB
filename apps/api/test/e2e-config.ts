// Deterministic, fixed test configuration shared by global-setup (parent process)
// and setup-env (worker process). A fixed port + fixed secrets avoids having to pass
// runtime values across Jest's process boundary.
export const E2E_PG_PORT = 55461;
export const E2E_DATABASE_URL = `postgresql://classweb:classweb@localhost:${E2E_PG_PORT}/classweb?schema=public`;
export const E2E_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  NODE_ENV: 'test',
  PORT: '3999',
  JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-0123456789abcdef',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  CORS_ORIGINS: 'http://localhost:3000',
  THROTTLE_TTL: '60',
  THROTTLE_LIMIT: '1000',
};
