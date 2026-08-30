import {
  addExpense,
  createExpenseWithSplit,
  listExpenses,
  getUserBalances,
  payExpense
} from '../services/expenseService.js';
import { GeminiExpenseAssistant } from '../services/aiService.js';

const aiAssistant = new GeminiExpenseAssistant();

export async function createExpense(req, res, next) {
  try {
    const userId = req.user?.userId || req.body.userId;
    const { amount, category, subcategory, description, friendIds, splitType, customSplits, groupId } = req.body;

    if (!userId || !amount || !category) {
      return res.status(400).json({ error: 'UserId, amount, and category are required' });
    }

    if (friendIds && friendIds.length > 0) {
      const result = await createExpenseWithSplit(
        userId,
        parseFloat(amount),
        category,
        subcategory || '',
        description || '',
        friendIds,
        splitType || 'equal',
        customSplits,
        groupId
      );
      return res.status(201).json(result);
    } else {
      const expense = await addExpense({
        userId,
        groupId: groupId || null,
        category,
        subcategory,
        amount: parseFloat(amount),
        description
      });
      return res.status(201).json({ expense, splits: [] });
    }
  } catch (error) {
    next(error);
  }
}

export async function getExpenseHistory(req, res, next) {
  try {
    const userId = req.user?.userId || req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const filters = {
      category: req.query.category,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    const expenses = await listExpenses(userId, filters);
    res.json(expenses);
  } catch (error) {
    next(error);
  }
}

export async function aiSplitExpense(req, res, next) {
  try {
    const { description, amount } = req.body;
    if (!description || !amount) {
      return res.status(400).json({ error: 'Description and amount are required' });
    }

    const catResult = await aiAssistant.categorizeExpense(description, parseFloat(amount));
    res.json({
      category: catResult.category,
      subcategory: catResult.subcategory,
      suggestedSplit: 'equal'
    });
  } catch (error) {
    next(error);
  }
}

export async function payExpenseController(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.body.userId;
    const { amount } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ error: 'User ID and amount are required' });
    }

    const payment = await payExpense(id, userId, parseFloat(amount));
    res.json({ success: true, payment });
  } catch (error) {
    next(error);
  }
}

export async function getBalancesController(req, res, next) {
  try {
    const userId = req.user?.userId || req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    const balances = await getUserBalances(userId);
    res.json(balances);
  } catch (error) {
    next(error);
  }
}
