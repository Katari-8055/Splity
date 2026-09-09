import {
  getSpendByCategory,
  getMonthlySummary,
  getWeeklySummary,
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

    // Execute all 4 queries in parallel for 4x faster analytics loading
    const [categorySpend, monthlySummary, weeklySummary, topCategories] = await Promise.all([
      getSpendByCategory(userId, month, year),
      getMonthlySummary(userId),
      getWeeklySummary(userId),
      getTopSpendingCategories(userId, 'this_month', 5)
    ]);

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
