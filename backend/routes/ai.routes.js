import { Router } from 'express';
import { categorize, parseChat } from '../controllers/ai.controller.js';
import { optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/categorize', optionalAuth, categorize);
router.post('/parse', optionalAuth, parseChat);
router.post('/enhanced', optionalAuth, parseChat);

export default router;
