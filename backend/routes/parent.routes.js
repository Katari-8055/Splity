import { Router } from 'express';
import {
  getChildren,
  addChild,
  updateThreshold,
  getParentNotifications,
  getChildAnalytics
} from '../controllers/parent.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/children', authenticateToken, getChildren);
router.post('/children', authenticateToken, addChild);
router.put('/children/:relationshipId', authenticateToken, updateThreshold);
router.get('/notifications', authenticateToken, getParentNotifications);
router.get('/analytics/:childId', authenticateToken, getChildAnalytics);

export default router;
