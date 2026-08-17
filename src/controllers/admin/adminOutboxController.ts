import AppError from "../../types/utils/AppError";
import { Request, Response } from "express";
import catchAsync from "../../types/utils/catchAsync";
import { sendSuccess } from "../../types/utils/response";
import {
  listDeadLetterOutbox,
  replayOutboxEntry,
  OutboxType,
} from "../../services/outboxReplayService";

const VALID_TYPES: OutboxType[] = [
  "order",
  "cart",
  "inventory",
  "coupon",
  "gifting",
  "push",
  "blog_publish",
];

function parseType(raw: string): OutboxType {
  if (VALID_TYPES.includes(raw as OutboxType)) {
    return raw as OutboxType;
  }
  throw new AppError(`Invalid outbox type: ${raw}`, 400);
}

export const listDeadLetterOutboxHandler = catchAsync(
  async (req: Request, res: Response) => {
    const type = parseType(String(req.params.type));
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await listDeadLetterOutbox(type, limit);
    sendSuccess(res, { type, rows, count: rows.length });
  },
);

export const replayDeadLetterOutboxHandler = catchAsync(
  async (req: Request, res: Response) => {
    const type = parseType(String(req.params.type));
    const outboxId = String(req.params.id);
    const ok = await replayOutboxEntry(type, outboxId);
    sendSuccess(res, { type, outboxId, replayed: ok }, "Outbox entry replayed");
  },
);
