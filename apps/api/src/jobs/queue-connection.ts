import type { ConnectionOptions } from 'bullmq';

/**
 * BullMQ connection settings from REDIS_URL ("redis://[user:pass@]host:port[/db]").
 * BullMQ needs `maxRetriesPerRequest: null` so blocking worker commands are never cut off.
 */
export function queueConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
