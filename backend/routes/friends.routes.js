import { Router } from 'express';
import { getFriendsList, addFriendController, searchFriendsController, sendReminderController } from '../controllers/friend.controller.js';
import { optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', optionalAuth, getFriendsList);
router.post('/add', optionalAuth, addFriendController);
router.get('/search', optionalAuth, searchFriendsController);
router.post('/send-reminder', optionalAuth, sendReminderController);

export default router;
