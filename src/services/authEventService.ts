import { EventEmitter } from "events";
import logger from "../types/utils/logger";
import { enqueueEmail } from "../queues/emailQueue";
import { writeAdminAudit } from "./adminAuditService";
import { authRequestMeta } from "../auth/authNormalize";
import type { Request } from "express";

export type AuthEventType =
  | "AUTH_SIGNUP_COMPLETED"
  | "AUTH_LOGIN_SUCCESS"
  | "AUTH_LOGIN_FAILED"
  | "PASSWORD_RESET_COMPLETED"
  | "AUTH_REFRESH_REUSE_DETECTED"
  | "AUTH_SESSION_REVOKED";

export type AuthEventPayload = {
  type: AuthEventType;
  userId?: string;
  email?: string;
  meta?: Record<string, unknown>;
  req?: Request;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

function handleAuthEvent(payload: AuthEventPayload): void {
  const { type, userId, email, meta = {}, req } = payload;
  const reqMeta = req ? authRequestMeta(req) : {};

  logger.info({
    type: "auth_event",
    event: type,
    userId,
    email: email ? `${email.slice(0, 3)}***` : undefined,
    ...reqMeta,
    ...meta,
  });

  if (req && userId) {
    void writeAdminAudit(
      req,
      `auth.event.${type.toLowerCase()}`,
      {
        ...meta,
        email,
      },
      userId,
      userId,
    ).catch(() => undefined);
  }

  /* Queue hooks — extend with CRM/analytics workers without blocking HTTP */
  if (type === "AUTH_SIGNUP_COMPLETED" && email) {
    /* Welcome mail is sent inline/queued in signup path; event is for downstream sync */
  }
}

emitter.on("auth", (payload: AuthEventPayload) => {
  try {
    handleAuthEvent(payload);
  } catch (err) {
    logger.error(`auth event handler failed: ${(err as Error).message}`);
  }
});

export function emitAuthEvent(payload: AuthEventPayload): void {
  setImmediate(() => emitter.emit("auth", payload));
}

/** Non-blocking email enqueue with logged fallback */
export async function enqueueAuthEmailSafe(payload: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  try {
    await enqueueEmail(payload);
  } catch (err) {
    logger.error(
      `Auth email queue failed (${payload.to}): ${(err as Error).message}`,
    );
  }
}
