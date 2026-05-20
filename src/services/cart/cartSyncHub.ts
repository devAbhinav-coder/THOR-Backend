import type { Response } from 'express';
import type { CartEventPayload } from './cartEventService';

type SseClient = {
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
};

const clientsByUser = new Map<string, Set<SseClient>>();

function writeSse(res: Response, data: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerCartSseClient(userId: string, res: Response): void {
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* connection closed */
    }
  }, 25_000);

  const client: SseClient = { res, heartbeat };
  let set = clientsByUser.get(userId);
  if (!set) {
    set = new Set();
    clientsByUser.set(userId, set);
  }
  set.add(client);
}

export function unregisterCartSseClient(userId: string, res: Response): void {
  const set = clientsByUser.get(userId);
  if (!set) return;
  for (const client of set) {
    if (client.res === res) {
      clearInterval(client.heartbeat);
      set.delete(client);
    }
  }
  if (set.size === 0) clientsByUser.delete(userId);
}

/** Push cart change to all SSE connections for this user (multi-device mini-cart sync). */
export function broadcastCartChangeToUser(userId: string, event: CartEventPayload): void {
  const set = clientsByUser.get(userId);
  if (!set?.size) return;

  const payload = {
    type: 'cart.changed',
    cartEventType: event.type,
    occurredAt: event.occurredAt,
  };

  for (const client of set) {
    try {
      writeSse(client.res, payload);
    } catch {
      /* ignore broken pipe */
    }
  }
}

export function getCartSseConnectionCount(userId?: string): number {
  if (userId) return clientsByUser.get(userId)?.size ?? 0;
  let n = 0;
  clientsByUser.forEach((set) => {
    n += set.size;
  });
  return n;
}
