/** Typed application configuration derived from validated environment. */
export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  // How many reverse proxies sit in front of the API. Behind Render this must be
  // set (render.yaml does), or every client shows up as Render's own address.
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim()),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET as string,
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },
  throttle: {
    ttlSeconds: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '300', 10),
  },
});
