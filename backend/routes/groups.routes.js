import { Router } from 'express';
import {
  getGroups,
  createGroupController,
  getGroupDetails,
  getExpensesForGroup,
  getMessagesForGroup,
  postMessageToGroup
} from '../controllers/group.controller.js';
import { optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', optionalAuth, getGroups);
router.post('/', optionalAuth, createGroupController);
router.get('/:id', optionalAuth, getGroupDetails);
router.get('/:id/expenses', optionalAuth, getExpensesForGroup);
router.get('/:id/messages', optionalAuth, getMessagesForGroup);
router.post('/:id/messages', optionalAuth, postMessageToGroup);

export default router;
