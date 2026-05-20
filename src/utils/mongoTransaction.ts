import mongoose, { ClientSession } from 'mongoose';
import AppError from './AppError';
import logger from './logger';
import { getRequestContext } from './requestContext';

export function isTransactionUnsupportedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : '';
  return (
    msg.includes('Transaction numbers are only allowed') ||
    msg.includes('not a repl set') ||
    msg.includes('replica set')
  );
}

/** Apply a Mongo session to a query when present (standalone dev runs without sessions). */
export function withQuerySession<T extends { session(s: ClientSession): T }>(
  query: T,
  session: ClientSession | null,
): T {
  return session ? query.session(session) : query;
}

export function sessionOpts(session: ClientSession | null): { session?: ClientSession } {
  return session ? { session } : {};
}

/**
 * Run `fn` inside a Mongo transaction when a replica set is available.
 * On standalone mongod (common in local dev), runs `fn(null)` without a transaction.
 */
export async function withOptionalTransaction<T>(
  fn: (session: ClientSession | null) => Promise<T>,
  label = 'withOptionalTransaction',
): Promise<T> {
  let session: ClientSession | null = null;
  try {
    session = await mongoose.startSession();
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err: unknown) {
    if (isTransactionUnsupportedError(err)) {
      logger.warn({
        msg: 'mongo_transaction_unsupported',
        label,
        requestId: getRequestContext()?.requestId,
      });
      return fn(null);
    }
    const message = err instanceof Error ? err.message : 'transaction failed';
    const ctx = getRequestContext();
    logger.error({
      msg: 'mongo_transaction_failed',
      label,
      requestId: ctx?.requestId,
      error: message,
    });
    if (err instanceof AppError) throw err;
    throw err;
  } finally {
    if (session) await session.endSession();
  }
}

export async function runInTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
  label: string,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'transaction failed';
    const ctx = getRequestContext();
    logger.error({
      msg: 'mongo_transaction_failed',
      label,
      requestId: ctx?.requestId,
      error: message,
    });
    if (err instanceof AppError) throw err;
    throw err;
  } finally {
    await session.endSession();
  }
}
