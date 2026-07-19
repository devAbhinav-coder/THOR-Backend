import { Router } from "express";
import { createAdaptiveLimiter } from "../middleware/adaptiveRateLimit";
import { validate } from "../middleware/validate";
import { optionalProtect } from "../middleware/auth";
import {
  getRaniCareStatus,
  postRaniCareChat,
} from "../controllers/raniCareController";
import { raniCareChatSchema } from "../validation/raniCareSchemas";

const router = Router();

const chatLimiter = createAdaptiveLimiter({
  windowMs: 60 * 1000,
  max: 25,
  prefix: "rl:ranicare:chat:",
  message: "Too many chat messages. Please wait a moment.",
});

router.get("/status", getRaniCareStatus);
router.post(
  "/chat",
  optionalProtect,
  chatLimiter,
  validate(raniCareChatSchema),
  postRaniCareChat,
);

export default router;
