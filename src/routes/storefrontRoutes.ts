import { Router } from 'express';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import { validate } from '../middleware/validate';
import { getStorefrontSettings } from '../controllers/storefrontController';
import { recordVisit } from '../controllers/storeVisitController';
import { recordStoreVisitSchema } from '../validation/storeVisitSchemas';

const router = Router();

const visitLimiter = createAdaptiveLimiter({
  windowMs: 60 * 1000,
  max: 30,
  prefix: 'rl:storefront:visit:',
  message: 'Too many requests. Please slow down.',
});

router.get('/settings', getStorefrontSettings);
router.post('/visit', visitLimiter, validate(recordStoreVisitSchema), recordVisit);

export default router;
