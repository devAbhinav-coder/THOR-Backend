import { Router } from 'express';
import {
  createSaleCampaign,
  getAllSaleCampaigns,
  getSaleCampaign,
  updateSaleCampaign,
  deleteSaleCampaign,
  archiveSaleCampaign,
  previewSaleCampaign,
  getPublicSaleCampaigns,
} from '../controllers/saleCampaignController';
import { protect, restrictTo } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { paginationGuard } from '../middleware/paginationGuard';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';
import { uploadSaleBanner, processSaleBanner } from '../middleware/upload';
import {
  createSaleCampaignSchema,
  updateSaleCampaignSchema,
  saleCampaignIdParamsSchema,
  previewSaleCampaignSchema,
} from '../validation/saleSchemas';

const router = Router();

const salePublicLimiter = createAdaptiveLimiter({
  windowMs: 60_000,
  max: 60,
  prefix: 'rl:sale:public:',
  message: 'Too many requests. Please wait a moment.',
});

router.get('/public', salePublicLimiter, getPublicSaleCampaigns);

router.use(protect, restrictTo('admin'));

router.post('/preview', validate(previewSaleCampaignSchema), previewSaleCampaign);
router.post(
  '/',
  uploadSaleBanner,
  processSaleBanner,
  validate(createSaleCampaignSchema),
  createSaleCampaign
);
router.get('/', paginationGuard, getAllSaleCampaigns);
router.get('/:id', validate(saleCampaignIdParamsSchema), getSaleCampaign);
router.patch('/:id/archive', validate(saleCampaignIdParamsSchema), archiveSaleCampaign);
router.patch(
  '/:id',
  uploadSaleBanner,
  processSaleBanner,
  validate(updateSaleCampaignSchema),
  updateSaleCampaign
);
router.delete('/:id', validate(saleCampaignIdParamsSchema), deleteSaleCampaign);

export default router;
