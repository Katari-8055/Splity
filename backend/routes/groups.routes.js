import { Router } from 'express';
import {
  getGroups,
  createGroupController,
  getGroupDetails,
  getExpensesForGroup,
  getMessagesForGroup,
  postMessageToGroup
} from '../controllers/group.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', authenticateToken, getGroups);
router.post('/', authenticateToken, createGroupController);
router.get('/:id', authenticateToken, getGroupDetails);
router.get('/:id/expenses', authenticateToken, getExpensesForGroup);
router.get('/:id/messages', authenticateToken, getMessagesForGroup);
router.post('/:id/messages', authenticateToken, postMessageToGroup);

export default router;
