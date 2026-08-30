import { Router } from 'express';
import { getProfile, searchUsers, initializeUser } from '../controllers/user.controller.js';
import { optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/profile', optionalAuth, getProfile);
router.get('/search', optionalAuth, searchUsers);
router.post('/init', initializeUser);

export default router;
