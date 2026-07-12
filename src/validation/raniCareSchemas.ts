import { z } from "zod";

export const raniCareChatSchema = z.object({
  body: z.object({
    message: z.string().trim().min(1).max(800),
    isAuthenticated: z.boolean().optional(),
    localIntent: z.string().trim().max(40).optional(),
    recentMessages: z
      .array(
        z.object({
          role: z.enum(["user", "bot"]),
          text: z.string().trim().min(1).max(500),
        }),
      )
      .max(6)
      .optional(),
  }),
});
