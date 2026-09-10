import { Router } from 'express';
import { getProfile, searchUsers, initializeUser } from '../controllers/user.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/profile', authenticateToken, getProfile);
router.get('/search', authenticateToken, searchUsers);
router.post('/init', initializeUser);

export default router;
