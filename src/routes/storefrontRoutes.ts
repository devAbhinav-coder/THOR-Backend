import { Router } from 'express';
import { getStorefrontSettings } from '../controllers/storefrontController';

const router = Router();

router.get('/settings', getStorefrontSettings);

export default router;
