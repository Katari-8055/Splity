import { Router } from 'express';
import { getAnalyticsData, getDashboardData } from '../controllers/analytics.controller.js';
import { optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/analytics', optionalAuth, getAnalyticsData);
router.get('/dashboard', optionalAuth, getDashboardData);

export default router;
