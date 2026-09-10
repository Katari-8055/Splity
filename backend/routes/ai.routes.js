import { Router } from 'express';
import { categorize, parseChat } from '../controllers/ai.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/categorize', authenticateToken, categorize);
router.post('/parse', authenticateToken, parseChat);
router.post('/enhanced', authenticateToken, parseChat);

export default router;
