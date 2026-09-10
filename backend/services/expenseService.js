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
    SELECT e.*, COALESCE(u.name, 'User') as paid_by_name,
      (SELECT json_agg(json_build_object('userId', es.user_id, 'amount', es.amount, 'userName', COALESCE(u2.name, 'Member')))
       FROM expense_splits es
       LEFT JOIN users u2 ON es.user_id = u2.id
       WHERE es.expense_id = e.id) as splits
    FROM expenses e
    LEFT JOIN users u ON e.user_id = u.id
    WHERE (e.user_id = $1 
       OR e.id IN (SELECT expense_id FROM expense_splits WHERE user_id = $1)
       OR e.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
       OR e.group_id IN (SELECT id FROM groups WHERE created_by = $1))
  `;
  const values = [userId];

  if (filters.category && filters.category.trim() !== '') {
    query += ` AND e.category ILIKE $${values.length + 1}`;
    values.push(filters.category.trim());
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
    SELECT e.*, COALESCE(u.name, 'Member') as paid_by_name,
      (SELECT json_agg(json_build_object('userId', es.user_id, 'amount', es.amount, 'userName', COALESCE(u2.name, 'Member')))
       FROM expense_splits es
       LEFT JOIN users u2 ON es.user_id = u2.id
       WHERE es.expense_id = e.id) as splits
    FROM expenses e
    LEFT JOIN users u ON e.user_id = u.id
    WHERE e.group_id = $1
    ORDER BY e.created_at DESC
  `;
  const result = await db.query(query, [groupId]);
  return result.rows;
}

/**
 * Calculate deterministic equal splits down to integer cents.
 * Distributes remainder cents one by one to ensure SUM(splits) === totalAmount exactly.
 */
export function calculateEqualSplits(totalAmount, participantIds) {
  if (!participantIds || participantIds.length === 0) {
    throw new Error('At least one participant is required for splitting');
  }

  const totalCents = Math.round(parseFloat(totalAmount) * 100);
  const count = participantIds.length;
  const baseCents = Math.floor(totalCents / count);
  const remainderCents = totalCents % count;

  return participantIds.map((userId, index) => {
    const shareCents = baseCents + (index < remainderCents ? 1 : 0);
    return {
      userId,
      amount: parseFloat((shareCents / 100).toFixed(2))
    };
  });
}

/**
 * Validate and normalize custom splits.
 * Enforces positive amounts, no duplicate participants, and SUM(shares) === totalAmount exactly.
 */
export function validateAndNormalizeCustomSplits(totalAmount, customSplits) {
  if (!Array.isArray(customSplits) || customSplits.length === 0) {
    throw new Error('Custom splits must be a non-empty array of participants and amounts');
  }

  const totalCents = Math.round(parseFloat(totalAmount) * 100);
  const seenUserIds = new Set();
  let sumCents = 0;

  const normalized = customSplits.map((s) => {
    if (!s.userId || typeof s.userId !== 'string' || !s.userId.trim()) {
      throw new Error('Each custom split participant must have a valid userId');
    }

    const cleanUserId = s.userId.trim();
    if (seenUserIds.has(cleanUserId)) {
      throw new Error(`Duplicate participant '${cleanUserId}' in custom split`);
    }
    seenUserIds.add(cleanUserId);

    const shareAmount = parseFloat(s.amount);
    if (isNaN(shareAmount) || shareAmount <= 0) {
      throw new Error(`Custom split amount for '${cleanUserId}' must be a positive number greater than 0`);
    }

    const shareCents = Math.round(shareAmount * 100);
    sumCents += shareCents;

    return {
      userId: cleanUserId,
      amount: parseFloat((shareCents / 100).toFixed(2)),
      userName: s.userName
    };
  });

  if (sumCents !== totalCents) {
    const sumFormatted = (sumCents / 100).toFixed(2);
    const totalFormatted = (totalCents / 100).toFixed(2);
    throw new Error(`Sum of custom split shares ($${sumFormatted}) must equal the total expense amount ($${totalFormatted})`);
  }

  return normalized;
}

export async function createExpenseWithSplit(
  userId,
  amount,
  category,
  subcategory,
  description,
  friendIds = [],
  splitType = 'equal',
  customSplits,
  groupId
) {
  // Input validation
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('Valid userId is required');
  }
  const cleanUserId = userId.trim();

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Expense amount must be a positive number greater than 0');
  }
  const normalizedTotalAmount = parseFloat((Math.round(parsedAmount * 100) / 100).toFixed(2));

  if (!category || typeof category !== 'string' || !category.trim()) {
    throw new Error('Expense category is required');
  }

  // Deduplicate and filter friend IDs
  const deduplicatedFriendIds = Array.from(
    new Set((friendIds || []).filter((fId) => fId && typeof fId === 'string' && fId.trim() !== cleanUserId).map((fId) => fId.trim()))
  );

  let splits;
  if (splitType === 'custom' && customSplits && customSplits.length > 0) {
    splits = validateAndNormalizeCustomSplits(normalizedTotalAmount, customSplits);
  } else {
    // Equal split: creator + all specified friends
    const allParticipants = [cleanUserId, ...deduplicatedFriendIds];
    splits = calculateEqualSplits(normalizedTotalAmount, allParticipants);
  }

  const pool = await connectToPostgres();
  const client = await pool.connect();
  const expenseId = uuidv4();

  try {
    await client.query('BEGIN');

    // Ensure paying user exists
    await client.query(
      `INSERT INTO users (id, name, email, role) 
       VALUES ($1, $2, $3, 'user') 
       ON CONFLICT (id) DO NOTHING`,
      [cleanUserId, 'User', `${cleanUserId}@example.com`]
    );

    const expenseQuery = `
      INSERT INTO expenses (id, user_id, group_id, category, subcategory, amount, description, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`;
    const expenseValues = [
      expenseId,
      cleanUserId,
      groupId || null,
      category.trim(),
      subcategory ? subcategory.trim() : null,
      normalizedTotalAmount,
      description ? description.trim() : null,
    ];
    const expenseRes = await client.query(expenseQuery, expenseValues);
    const expense = expenseRes.rows[0];

    for (const s of splits) {
      await client.query(
        `INSERT INTO users (id, name, email, role) 
         VALUES ($1, $2, $3, 'user') 
         ON CONFLICT (id) DO NOTHING`,
        [s.userId, s.userName || `User-${s.userId.substring(0, 6)}`, `${s.userId}@example.com`]
      );

      await client.query(
        `INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)
         ON CONFLICT (expense_id, user_id) DO UPDATE SET amount = EXCLUDED.amount`,
        [expenseId, s.userId, s.amount]
      );
    }

    await client.query('COMMIT');

    for (const friendId of deduplicatedFriendIds) {
      pushNotification(
        friendId,
        `You have been added to a ${category} expense of $${normalizedTotalAmount} by ${cleanUserId}`
      ).catch(() => {});
    }

    return { expense, splits };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
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
  return parseFloat((owedToUser - userOwes).toFixed(2));
}

/**
 * Optimized getUserBalances with Single Set-Based Aggregation (Eliminates N+1 Queries)
 */
export async function getUserBalances(userId) {
  const db = await connectToPostgres();

  const aggregatedBalancesQuery = `
    WITH related_users AS (
      SELECT DISTINCT u.id AS friend_id, u.name AS friend_name, u.email AS friend_email
      FROM users u
      WHERE u.id != $1 AND (
        u.id IN (SELECT friend_id FROM friends WHERE user_id = $1) OR
        u.id IN (SELECT user_id FROM friends WHERE friend_id = $1) OR
        u.id IN (
          SELECT gm2.user_id FROM group_members gm1
          JOIN group_members gm2 ON gm1.group_id = gm2.group_id
          WHERE gm1.user_id = $1 AND gm2.user_id != $1
        ) OR
        u.id IN (
          SELECT es.user_id FROM expenses e
          JOIN expense_splits es ON e.id = es.expense_id
          WHERE e.user_id = $1
        ) OR
        u.id IN (
          SELECT e.user_id FROM expenses e
          JOIN expense_splits es ON e.id = es.expense_id
          WHERE es.user_id = $1
        )
      )
    ),
    debts_owed AS (
      -- Friends owe user (User paid, Friend is in split)
      SELECT es.user_id AS friend_id, COALESCE(SUM(es.amount), 0) AS owed_to_user
      FROM expenses e
      JOIN expense_splits es ON e.id = es.expense_id
      WHERE e.user_id = $1
      GROUP BY es.user_id
    ),
    debts_owing AS (
      -- User owes friends (Friend paid, User is in split)
      SELECT e.user_id AS friend_id, COALESCE(SUM(es.amount), 0) AS user_owes
      FROM expenses e
      JOIN expense_splits es ON e.id = es.expense_id
      WHERE es.user_id = $1
      GROUP BY e.user_id
    )
    SELECT 
      ru.friend_id AS "friendId",
      COALESCE(ru.friend_name, 'Friend') AS "friendName",
      ru.friend_email AS "friendEmail",
      COALESCE(d_owed.owed_to_user, 0)::NUMERIC AS "owedToUser",
      COALESCE(d_owing.user_owes, 0)::NUMERIC AS "userOwes",
      (COALESCE(d_owed.owed_to_user, 0) - COALESCE(d_owing.user_owes, 0))::NUMERIC AS balance
    FROM related_users ru
    LEFT JOIN debts_owed d_owed ON ru.friend_id = d_owed.friend_id
    LEFT JOIN debts_owing d_owing ON ru.friend_id = d_owing.friend_id
    ORDER BY ru.friend_name ASC;
  `;

  const result = await db.query(aggregatedBalancesQuery, [userId]);

  const balances = result.rows.map((row) => ({
    friendId: row.friendId,
    friendName: row.friendName,
    friendEmail: row.friendEmail,
    balance: parseFloat(parseFloat(row.balance || 0).toFixed(2))
  }));

  const totalYouOwe = balances
    .filter((b) => b.balance < 0)
    .reduce((acc, b) => acc + Math.abs(b.balance), 0);

  const totalYouAreOwed = balances
    .filter((b) => b.balance > 0)
    .reduce((acc, b) => acc + b.balance, 0);

  return {
    balances,
    totalYouOwe: parseFloat(totalYouOwe.toFixed(2)),
    totalYouAreOwed: parseFloat(totalYouAreOwed.toFixed(2)),
    netBalance: parseFloat((totalYouAreOwed - totalYouOwe).toFixed(2))
  };
}

// Re-export canonical settlement domain functions
export { settleDebt, settleExpenseById } from './settlementService.js';

export async function payExpense(expenseId, userId, amountPaid) {
  const { settleExpenseById } = await import('./settlementService.js');
  return settleExpenseById(expenseId, userId, amountPaid);
}

