import { Router } from 'express';
import { getAnalyticsData, getDashboardData } from '../controllers/analytics.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/analytics', authenticateToken, getAnalyticsData);
router.get('/dashboard', authenticateToken, getDashboardData);

export default router;
