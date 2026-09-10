import { Router } from 'express';
import {
  createExpense,
  getExpenseHistory,
  aiSplitExpense,
  payExpenseController,
  settleDebtController,
  getBalancesController
} from '../controllers/expense.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/create', authenticateToken, createExpense);
router.post('/save', authenticateToken, createExpense);
router.get('/history', authenticateToken, getExpenseHistory);
router.get('/balances', authenticateToken, getBalancesController);
router.post('/ai-split', authenticateToken, aiSplitExpense);
router.post('/settle', authenticateToken, settleDebtController);
router.post('/:id/pay', authenticateToken, payExpenseController);

export default router;
