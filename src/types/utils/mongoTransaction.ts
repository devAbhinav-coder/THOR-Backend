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

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
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
 * Assert replica-set transactions work. Call once after connect in production.
 * Checkout / cancel / payment paths require multi-document atomicity.
 */
export async function assertMongoTransactionsSupported(): Promise<void> {
  if (!isProduction()) return;

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await session.abortTransaction();
  } catch (err: unknown) {
    if (isTransactionUnsupportedError(err)) {
      throw new Error(
        'MongoDB transactions are required in production (replica set / Atlas). ' +
          'Standalone mongod cannot safely commit checkout or payment. ' +
          'Configure a replica set and restart.',
      );
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Run `fn` inside a Mongo transaction when a replica set is available.
 * Dev: on standalone mongod, runs `fn(null)` without a transaction.
 * Production: never degrades — throws if transactions are unsupported.
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
      if (isProduction()) {
        logger.error({
          msg: 'mongo_transaction_unsupported_production',
          label,
          requestId: getRequestContext()?.requestId,
        });
        throw new AppError(
          'Checkout temporarily unavailable (database transaction support required).',
          503,
        );
      }
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
