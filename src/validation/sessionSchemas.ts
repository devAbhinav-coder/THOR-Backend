import { z } from 'zod';

const mongoObjectId = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid session id');

export const sessionIdParamSchema = z.object({
  params: z.object({
    sessionId: mongoObjectId,
  }),
});
