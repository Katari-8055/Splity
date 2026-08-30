import { Router } from 'express';
import {
  getChildren,
  addChild,
  updateThreshold,
  getParentNotifications,
  getChildAnalytics
} from '../controllers/parent.controller.js';
import { optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/children', optionalAuth, getChildren);
router.post('/children', optionalAuth, addChild);
router.put('/children/:relationshipId', optionalAuth, updateThreshold);
router.get('/notifications', optionalAuth, getParentNotifications);
router.get('/analytics/:childId', optionalAuth, getChildAnalytics);

export default router;
