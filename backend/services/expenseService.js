import { connectToPostgres } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { pushNotification } from './notificationService.js';

export async function addExpense(expense) {
  const db = await connectToPostgres();
  const id = expense.id || uuidv4();
  const query = `
    INSERT INTO expenses (id, user_id, group_id, category, subcategory, amount, description, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`;
  const values = [
    id,
    expense.userId,
    expense.groupId || null,
    expense.category,
    expense.subcategory || null,
    expense.amount,
    expense.description || null,
  ];
  const result = await db.query(query, values);
  return result.rows[0];
}

export async function splitExpense(expenseId, splits) {
  const db = await connectToPostgres();
  const insertPromises = splits.map((s) =>
    db.query(
      `INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)
       ON CONFLICT (expense_id, user_id) DO UPDATE SET amount = EXCLUDED.amount RETURNING *`,
      [expenseId, s.userId, s.amount]
    )
  );
  return Promise.all(insertPromises);
}

export async function listExpenses(userId, filters = {}) {
  const db = await connectToPostgres();
  let query = `
    SELECT e.*, u.name as paid_by_name,
      (SELECT json_agg(json_build_object('userId', es.user_id, 'amount', es.amount, 'userName', u2.name))
       FROM expense_splits es
       JOIN users u2 ON es.user_id = u2.id
       WHERE es.expense_id = e.id) as splits
    FROM expenses e
    JOIN users u ON e.user_id = u.id
    WHERE e.user_id = $1 OR e.id IN (SELECT expense_id FROM expense_splits WHERE user_id = $1)
  `;
  const values = [userId];

  if (filters.category) {
    query += ` AND e.category = $${values.length + 1}`;
    values.push(filters.category);
  }
  if (filters.startDate && filters.endDate) {
    query += ` AND e.created_at BETWEEN $${values.length + 1} AND $${values.length + 2}`;
    values.push(filters.startDate, filters.endDate);
  }
  query += ` ORDER BY e.created_at DESC`;
  const result = await db.query(query, values);
  return result.rows;
}

export async function getGroupExpenses(groupId) {
  const db = await connectToPostgres();
  const query = `
    SELECT e.*, u.name as paid_by_name,
      (SELECT json_agg(json_build_object('userId', es.user_id, 'amount', es.amount, 'userName', u2.name))
       FROM expense_splits es
       JOIN users u2 ON es.user_id = u2.id
       WHERE es.expense_id = e.id) as splits
    FROM expenses e
    JOIN users u ON e.user_id = u.id
    WHERE e.group_id = $1
    ORDER BY e.created_at DESC
  `;
  const result = await db.query(query, [groupId]);
  return result.rows;
}

export async function createExpenseWithSplit(
  userId,
  amount,
  category,
  subcategory,
  description,
  friendIds,
  splitType = 'equal',
  customSplits,
  groupId
) {
  const db = await connectToPostgres();
  const expenseId = uuidv4();
  
  try {
    await db.query('BEGIN');
    
    const expense = await addExpense({
      id: expenseId,
      userId,
      groupId: groupId || null,
      category,
      subcategory,
      amount,
      description,
    });
    
    let splits;
    if (splitType === 'equal') {
      const totalPeople = friendIds.length + 1;
      const splitAmount = amount / totalPeople;
      splits = [
        { userId, amount: splitAmount },
        ...friendIds.map(fId => ({ userId: fId, amount: splitAmount }))
      ];
    } else {
      splits = customSplits || [];
    }
    
    await splitExpense(expenseId, splits);
    
    for (const friendId of friendIds) {
      await pushNotification(
        friendId,
        `You have been added to a ${category} expense of $${amount} by ${userId}`
      );
    }
    
    await db.query('COMMIT');
    return { expense, splits };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export async function getFriendBalance(userId, friendId) {
  const db = await connectToPostgres();
  const owedToUserResult = await db.query(`
    SELECT COALESCE(SUM(es.amount), 0) as total
    FROM expenses e
    JOIN expense_splits es ON e.id = es.expense_id
    WHERE e.user_id = $1 AND es.user_id = $2
  `, [userId, friendId]);
  
  const userOwesResult = await db.query(`
    SELECT COALESCE(SUM(es.amount), 0) as total
    FROM expenses e
    JOIN expense_splits es ON e.id = es.expense_id
    WHERE e.user_id = $2 AND es.user_id = $1
  `, [userId, friendId]);
  
  const owedToUser = parseFloat(owedToUserResult.rows[0].total);
  const userOwes = parseFloat(userOwesResult.rows[0].total);
  return owedToUser - userOwes;
}

export async function getUserBalances(userId) {
  const db = await connectToPostgres();
  // Get all friends and calculate balance for each
  const friendsResult = await db.query(
    `SELECT DISTINCT f.friend_id as id, u.name, u.email
     FROM friends f
     JOIN users u ON f.friend_id = u.id
     WHERE f.user_id = $1`,
    [userId]
  );
  
  const balances = await Promise.all(
    friendsResult.rows.map(async (friend) => {
      const balance = await getFriendBalance(userId, friend.id);
      return {
        friendId: friend.id,
        friendName: friend.name,
        friendEmail: friend.email,
        balance
      };
    })
  );
  
  const totalYouOwe = balances.filter(b => b.balance < 0).reduce((acc, b) => acc + Math.abs(b.balance), 0);
  const totalYouAreOwed = balances.filter(b => b.balance > 0).reduce((acc, b) => acc + b.balance, 0);
  
  return {
    balances,
    totalYouOwe,
    totalYouAreOwed,
    netBalance: totalYouAreOwed - totalYouOwe
  };
}

export async function payExpense(expenseId, userId, amountPaid) {
  const db = await connectToPostgres();
  // Update or record payment in expense_splits or adjust balance
  const result = await db.query(
    `UPDATE expense_splits SET amount = GREATEST(0, amount - $1)
     WHERE expense_id = $2 AND user_id = $3 RETURNING *`,
    [amountPaid, expenseId, userId]
  );
  return result.rows[0];
}
