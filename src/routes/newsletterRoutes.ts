import { Router } from "express";
import { createAdaptiveLimiter } from "../middleware/adaptiveRateLimit";
import { validate } from "../middleware/validate";
import { subscribeNewsletterSchema } from "../validation/newsletterSchemas";
import { subscribeNewsletter } from "../controllers/newsletterController";

const router = Router();

const subscribeLimiter = createAdaptiveLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  prefix: "newsletter:subscribe",
  message: "Too many subscribe attempts. Please try again later.",
});

router.post(
  "/subscribe",
  subscribeLimiter,
  validate(subscribeNewsletterSchema),
  subscribeNewsletter,
);

export default router;
