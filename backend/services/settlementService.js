import { connectToPostgres } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { pushNotification } from './notificationService.js';

/**
 * Calculate net balance between two users.
 * Positive balance = friend owes user
 * Negative balance = user owes friend
 * Zero = all settled up
 */
export async function getFriendBalanceWithClient(client, userId, friendId) {
  const owedToUserResult = await client.query(`
    SELECT COALESCE(SUM(es.amount), 0) as total
    FROM expenses e
    JOIN expense_splits es ON e.id = es.expense_id
    WHERE e.user_id = $1 AND es.user_id = $2
  `, [userId, friendId]);

  const userOwesResult = await client.query(`
    SELECT COALESCE(SUM(es.amount), 0) as total
    FROM expenses e
    JOIN expense_splits es ON e.id = es.expense_id
    WHERE e.user_id = $2 AND es.user_id = $1
  `, [userId, friendId]);

  const owedToUser = parseFloat(owedToUserResult.rows[0]?.total || 0);
  const userOwes = parseFloat(userOwesResult.rows[0]?.total || 0);
  return owedToUser - userOwes;
}

/**
 * Canonical Settlement Service - Single Source of Truth for settling debts.
 * Used by both REST API controllers and MCP AI Agent tools.
 *
 * @param {string} userId - ID of user initiating or participating in settlement
 * @param {string} friendId - ID of counter-party friend
 * @param {number|null} customAmount - Optional partial settlement amount
 * @param {object} options - Optional metadata (e.g. description, groupId)
 */
export async function settleDebt(userId, friendId, customAmount = null, options = {}) {
  // 1. Input & Identity Validation
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('Valid userId is required for settlement');
  }
  if (!friendId || typeof friendId !== 'string' || !friendId.trim()) {
    throw new Error('Valid friendId is required for settlement');
  }
  if (userId.trim() === friendId.trim()) {
    throw new Error('Cannot settle balance with yourself');
  }

  const cleanUserId = userId.trim();
  const cleanFriendId = friendId.trim();

  // Validate customAmount format if provided
  let requestedAmount = null;
  if (customAmount !== null && customAmount !== undefined && customAmount !== '') {
    requestedAmount = parseFloat(customAmount);
    if (isNaN(requestedAmount) || requestedAmount <= 0) {
      throw new Error('Settlement amount must be a positive number greater than 0');
    }
  }

  const pool = await connectToPostgres();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 2. Query live balance within transaction
    const currentBalance = await getFriendBalanceWithClient(client, cleanUserId, cleanFriendId);
    const outstandingDebt = Math.abs(currentBalance);

    // 3. Check for already settled balance
    if (outstandingDebt <= 0.001) {
      await client.query('COMMIT');
      return {
        success: true,
        settledAmount: 0,
        currentBalance: 0,
        newBalance: 0,
        friendId: cleanFriendId,
        message: 'Already all settled up! No outstanding balance.'
      };
    }

    // 4. Determine final settlement amount & validate over-settlement
    const amountToSettle = requestedAmount !== null ? requestedAmount : outstandingDebt;

    if (amountToSettle > outstandingDebt + 0.001) {
      throw new Error(`Settlement amount ($${amountToSettle.toFixed(2)}) cannot exceed outstanding balance ($${outstandingDebt.toFixed(2)})`);
    }

    // 5. Ensure both user records exist in DB
    await client.query(
      `INSERT INTO users (id, name, email, role)
       VALUES ($1, $2, $3, 'user')
       ON CONFLICT (id) DO NOTHING`,
      [cleanUserId, 'User', `${cleanUserId}@example.com`]
    );

    await client.query(
      `INSERT INTO users (id, name, email, role)
       VALUES ($1, $2, $3, 'user')
       ON CONFLICT (id) DO NOTHING`,
      [cleanFriendId, 'Friend', `${cleanFriendId}@example.com`]
    );

    // 6. Create immutable settlement ledger record
    // If currentBalance < 0: user owes friend -> user pays friend
    // If currentBalance > 0: friend owes user -> friend pays user
    const payerId = currentBalance < 0 ? cleanUserId : cleanFriendId;
    const recipientId = currentBalance < 0 ? cleanFriendId : cleanUserId;

    const expenseId = uuidv4();
    const description = options.description || 'Settlement Payment';
    const category = 'Settlement';
    const subcategory = 'Settlement Payment';

    await client.query(
      `INSERT INTO expenses (id, user_id, group_id, category, subcategory, amount, description, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [expenseId, payerId, options.groupId || null, category, subcategory, amountToSettle, description]
    );

    await client.query(
      `INSERT INTO expense_splits (expense_id, user_id, amount, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (expense_id, user_id) DO UPDATE SET amount = EXCLUDED.amount`,
      [expenseId, recipientId, amountToSettle]
    );

    // 7. Verify new balance within transaction
    const newBalance = await getFriendBalanceWithClient(client, cleanUserId, cleanFriendId);

    await client.query('COMMIT');

    // 8. Trigger notifications (Post-Commit)
    pushNotification(
      cleanFriendId,
      `A settlement payment of $${amountToSettle.toFixed(2)} was recorded with you.`
    ).catch(() => {});

    return {
      success: true,
      settledAmount: amountToSettle,
      newBalance: parseFloat(newBalance.toFixed(2)),
      friendId: cleanFriendId,
      expenseId,
      payerId,
      recipientId,
      message: `Settlement of $${amountToSettle.toFixed(2)} recorded successfully.`
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Bridge helper for legacy /api/expenses/:id/pay endpoint.
 * Maps an individual expense payment to the canonical settleDebt domain logic.
 */
export async function settleExpenseById(expenseId, userId, amount = null) {
  if (!expenseId) {
    throw new Error('Expense ID is required');
  }
  if (!userId) {
    throw new Error('User ID is required');
  }

  const db = await connectToPostgres();
  
  // Find the expense and its creator/payee
  const expenseResult = await db.query(
    `SELECT e.*, es.amount as split_amount
     FROM expenses e
     LEFT JOIN expense_splits es ON e.id = es.expense_id AND es.user_id = $1
     WHERE e.id = $2`,
    [userId, expenseId]
  );

  if (expenseResult.rows.length === 0) {
    throw new Error('Expense not found');
  }

  const expense = expenseResult.rows[0];
  const payeeId = expense.user_id;

  if (payeeId === userId) {
    throw new Error('Cannot settle an expense you paid for yourself');
  }

  // Delegate to canonical settleDebt domain service
  return settleDebt(userId, payeeId, amount, {
    description: `Settlement for: ${expense.description || expense.category}`,
    groupId: expense.group_id
  });
}
