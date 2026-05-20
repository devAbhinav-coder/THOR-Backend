import type { PushJobData } from '../../queues/pushQueue';

export function buildPushDedupeKey(data: PushJobData): string {
  if (data.notificationId) {
    return `push:${data.userId}:${data.notificationId}`;
  }
  const hash = Buffer.from(`${data.title}:${data.body}:${data.link ?? ''}`).toString('base64url').slice(0, 24);
  return `push:${data.userId}:${hash}`;
}
