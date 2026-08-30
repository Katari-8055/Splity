import {
  getSpendByCategory,
  getMonthlySummary,
  getWeeklySummary,
  getCategorySpending,
  getTopSpendingCategories,
  getDashboardOverview
} from '../services/analyticsService.js';

export async function getAnalyticsData(req, res, next) {
  try {
    const userId = req.user?.userId || req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const categorySpend = await getSpendByCategory(userId, month, year);
    const monthlySummary = await getMonthlySummary(userId);
    const weeklySummary = await getWeeklySummary(userId);
    const topCategories = await getTopSpendingCategories(userId, 'this_month', 5);

    res.json({
      categorySpend,
      monthlySummary,
      weeklySummary,
      topCategories
    });
  } catch (error) {
    next(error);
  }
}

export async function getDashboardData(req, res, next) {
  try {
    const userId = req.user?.userId || req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const data = await getDashboardOverview(userId);
    res.json(data);
  } catch (error) {
    next(error);
  }
}
