import { connectToPostgres } from '../config/db.js';

export async function getSpendByCategory(userId, month, year) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT category, SUM(amount) as total, SUM(amount) as total_amount
     FROM expenses
     WHERE (user_id = $1 OR id IN (SELECT expense_id FROM expense_splits WHERE user_id = $1))
       AND EXTRACT(MONTH FROM created_at) = $2 
       AND EXTRACT(YEAR FROM created_at) = $3
     GROUP BY category`,
    [userId, month, year]
  );
  return result.rows;
}

export async function getMonthlySummary(userId) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT DATE_TRUNC('month', created_at) as month, SUM(amount) as total
     FROM expenses
     WHERE user_id = $1
     GROUP BY month
     ORDER BY month DESC`,
    [userId]
  );
  return result.rows;
}

export async function getWeeklySummary(userId) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT DATE_TRUNC('week', created_at) as week, SUM(amount) as total
     FROM expenses
     WHERE user_id = $1
     GROUP BY week
     ORDER BY week DESC`,
    [userId]
  );
  return result.rows;
}

export async function getFriendContributions(groupId) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT u.name, SUM(es.amount) as contribution
     FROM expense_splits es
     JOIN users u ON es.user_id = u.id
     WHERE es.expense_id IN (SELECT id FROM expenses WHERE group_id = $1)
     GROUP BY u.name`,
    [groupId]
  );
  return result.rows;
}

export async function getCategorySpending(userId, category, startDate, endDate) {
  const db = await connectToPostgres();
  let query = `
    SELECT subcategory, SUM(amount) as total, COUNT(*) as count
    FROM expenses
    WHERE user_id = $1 AND category = $2`;
  const values = [userId, category];
  
  if (startDate && endDate) {
    query += ` AND created_at BETWEEN $3 AND $4`;
    values.push(startDate, endDate);
  }
  
  query += ` GROUP BY subcategory ORDER BY total DESC`;
  const result = await db.query(query, values);
  return result.rows;
}

export async function getTopSpendingCategories(userId, timeframe = 'this_month', limit = 5) {
  const db = await connectToPostgres();
  const now = new Date();
  let startDate;
  let endDate = new Date(now);
  
  switch (timeframe) {
    case 'this_month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'last_month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case 'this_year':
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  
  const query = `
    SELECT 
      category,
      COUNT(*) as transaction_count,
      SUM(amount) as total,
      AVG(amount) as average
    FROM expenses 
    WHERE user_id = $1 
      AND created_at >= $2 
      AND created_at <= $3
      AND category IS NOT NULL
      AND category != ''
    GROUP BY category
    ORDER BY total DESC
    LIMIT $4
  `;
  
  const result = await db.query(query, [userId, startDate.toISOString(), endDate.toISOString(), limit]);
  return result.rows.map(row => ({
    category: row.category,
    total: parseFloat(row.total || 0).toFixed(2),
    transactionCount: parseInt(row.transaction_count),
    average: parseFloat(row.average || 0).toFixed(2)
  }));
}

export async function getDashboardOverview(userId) {
  const db = await connectToPostgres();
  
  // Execute all 3 dashboard queries in parallel
  const [totalSpentRes, groupCountRes, recentExpensesRes] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE user_id = $1`,
      [userId]
    ),
    db.query(
      `SELECT COUNT(DISTINCT group_id) as count FROM group_members WHERE user_id = $1`,
      [userId]
    ),
    db.query(
      `SELECT e.*, COALESCE(u.name, 'User') as paid_by_name FROM expenses e
       LEFT JOIN users u ON e.user_id = u.id
       WHERE e.user_id = $1 OR e.id IN (SELECT expense_id FROM expense_splits WHERE user_id = $1)
       ORDER BY e.created_at DESC LIMIT 5`,
      [userId]
    )
  ]);

  const totalSpent = parseFloat(totalSpentRes.rows[0]?.total || 0);
  const groupCount = parseInt(groupCountRes.rows[0]?.count || 0);

  return {
    totalSpent,
    groupCount,
    recentExpenses: recentExpensesRes.rows
  };
}
