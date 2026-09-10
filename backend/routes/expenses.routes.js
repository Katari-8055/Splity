import { Router } from 'express';
import {
  createExpense,
  getExpenseHistory,
  aiSplitExpense,
  payExpenseController,
  settleDebtController,
  getBalancesController
} from '../controllers/expense.controller.js';
import { optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/create', optionalAuth, createExpense);
router.post('/save', optionalAuth, createExpense);
router.get('/history', optionalAuth, getExpenseHistory);
router.get('/balances', optionalAuth, getBalancesController);
router.post('/ai-split', optionalAuth, aiSplitExpense);
router.post('/settle', optionalAuth, settleDebtController);
router.post('/:id/pay', optionalAuth, payExpenseController);

export default router;

