import { Router } from 'express';
import {
  getFriendsList,
  addFriendController,
  searchFriendsController,
  sendReminderController
} from '../controllers/friend.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', authenticateToken, getFriendsList);
router.post('/add', authenticateToken, addFriendController);
router.get('/search', authenticateToken, searchFriendsController);
router.post('/send-reminder', authenticateToken, sendReminderController);

export default router;
