import { Router } from 'express';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import { validate } from '../middleware/validate';
import { getStorefrontSettings } from '../controllers/storefrontController';
import { recordVisit } from '../controllers/storeVisitController';
import { recordStoreVisitSchema } from '../validation/storeVisitSchemas';
import { recordBrowserMetaEvent } from '../controllers/metaEventController';
import { browserMetaEventSchema } from '../validation/metaEventSchemas';
import { recordOfferEvent } from '../controllers/offerEventController';
import { recordOfferEventSchema } from '../validation/offerEventSchemas';

const router = Router();

const visitLimiter = createAdaptiveLimiter({
  windowMs: 60 * 1000,
  max: 30,
  prefix: 'rl:storefront:visit:',
  message: 'Too many requests. Please slow down.',
});

const metaEventLimiter = createAdaptiveLimiter({
  windowMs: 60 * 1000,
  max: 60,
  prefix: 'rl:storefront:meta-event:',
  message: 'Too many analytics events. Please slow down.',
});

const offerEventLimiter = createAdaptiveLimiter({
  windowMs: 60 * 1000,
  max: 120,
  prefix: 'rl:storefront:offer-event:',
  message: 'Too many offer events. Please slow down.',
});

router.get('/settings', getStorefrontSettings);
router.post('/visit', visitLimiter, validate(recordStoreVisitSchema), recordVisit);
router.post(
  '/offer-event',
  offerEventLimiter,
  validate(recordOfferEventSchema),
  recordOfferEvent,
);
router.post(
  '/meta-event',
  metaEventLimiter,
  validate(browserMetaEventSchema),
  recordBrowserMetaEvent,
);

export default router;
