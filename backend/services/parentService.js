import { connectToPostgres } from '../config/db.js';
import { logNotification, checkNotificationSent, sendEmailNotification } from './notificationService.js';

export async function addParentChildRelationship(parentId, childId, thresholdAmount = 0) {
  const db = await connectToPostgres();
  try {
    await db.query('BEGIN');
    const parent = await db.query(`SELECT * FROM users WHERE id = $1 AND role = 'parent'`, [parentId]);
    if (parent.rows.length === 0) {
      throw new Error('Parent user not found or user is not a parent');
    }
    const child = await db.query(`SELECT * FROM users WHERE id = $1`, [childId]);
    if (child.rows.length === 0) {
      throw new Error('Child user not found');
    }
    const existing = await db.query(`SELECT * FROM parent_child_relationships WHERE parent_id = $1 AND child_id = $2`, [parentId, childId]);
    if (existing.rows.length > 0) {
      throw new Error('Parent-child relationship already exists');
    }
    const query = `INSERT INTO parent_child_relationships (parent_id, child_id, threshold_amount) VALUES ($1, $2, $3) RETURNING *`;
    const result = await db.query(query, [parentId, childId, thresholdAmount]);
    await db.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export async function getChildrenForParent(parentId) {
  const db = await connectToPostgres();
  const query = `
    SELECT 
      pcr.id as relationship_id,
      pcr.threshold_amount,
      pcr.created_at as relationship_created,
      u.id as child_id,
      u.name as child_name,
      u.email as child_email,
      u.phone as child_phone
    FROM parent_child_relationships pcr
    JOIN users u ON pcr.child_id = u.id
    WHERE pcr.parent_id = $1
    ORDER BY pcr.created_at DESC
  `;
  const result = await db.query(query, [parentId]);
  return result.rows;
}

export async function verifyParentChild(parentId, childId) {
  if (!parentId || !childId) return false;
  const db = await connectToPostgres();
  const res = await db.query(
    `SELECT 1 FROM parent_child_relationships WHERE parent_id = $1 AND child_id = $2`,
    [parentId, childId]
  );
  return res.rows.length > 0;
}

export async function updateChildThreshold(relationshipId, thresholdAmount, parentId = null) {
  const db = await connectToPostgres();
  if (parentId) {
    const query = `UPDATE parent_child_relationships SET threshold_amount = $1 WHERE id = $2 AND parent_id = $3 RETURNING *`;
    const result = await db.query(query, [thresholdAmount, relationshipId, parentId]);
    return result.rows[0] || null;
  }
  const query = `UPDATE parent_child_relationships SET threshold_amount = $1 WHERE id = $2 RETURNING *`;
  const result = await db.query(query, [thresholdAmount, relationshipId]);
  return result.rows[0];
}

export async function getChildTotalSpending(childId, startDate, endDate) {
  const db = await connectToPostgres();
  let query = `
    SELECT COALESCE(SUM(es.amount), 0) as total_spending
    FROM expense_splits es
    JOIN expenses e ON es.expense_id = e.id
    WHERE es.user_id = $1
  `;
  const values = [childId];
  if (startDate && endDate) {
    query += ` AND e.created_at BETWEEN $2 AND $3`;
    values.push(startDate, endDate);
  }
  const result = await db.query(query, values);
  return parseFloat(result.rows[0].total_spending) || 0;
}

export async function addChildByEmailAndPhone(parentId, childEmail, childPhone, thresholdAmount = 0) {
  const db = await connectToPostgres();
  try {
    await db.query('BEGIN');
    const child = await db.query(`SELECT * FROM users WHERE email = $1 AND phone = $2`, [childEmail, childPhone]);
    if (child.rows.length === 0) {
      throw new Error('Child not found with the provided email and phone number');
    }
    const childId = child.rows[0].id;
    const relationship = await addParentChildRelationship(parentId, childId, thresholdAmount);
    await db.query('COMMIT');
    return { relationship, child: child.rows[0] };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export async function getChildSpendingAnalytics(childId, startDate, endDate) {
  const db = await connectToPostgres();
  let query = `
    SELECT 
      e.category,
      e.subcategory,
      e.description,
      es.amount,
      e.created_at,
      u.name as payer_name
    FROM expense_splits es
    JOIN expenses e ON es.expense_id = e.id
    JOIN users u ON e.user_id = u.id
    WHERE es.user_id = $1
  `;
  const values = [childId];
  if (startDate && endDate) {
    query += ` AND e.created_at BETWEEN $2 AND $3`;
    values.push(startDate, endDate);
  }
  query += ` ORDER BY e.created_at DESC`;
  const result = await db.query(query, values);
  return result.rows;
}

export async function getChildSpendingByCategory(childId, startDate, endDate) {
  const db = await connectToPostgres();
  let query = `
    SELECT 
      e.category,
      SUM(es.amount) as total_amount,
      COUNT(*) as transaction_count
    FROM expense_splits es
    JOIN expenses e ON es.expense_id = e.id
    WHERE es.user_id = $1
  `;
  const values = [childId];
  if (startDate && endDate) {
    query += ` AND e.created_at BETWEEN $2 AND $3`;
    values.push(startDate, endDate);
  }
  query += ` GROUP BY e.category ORDER BY total_amount DESC`;
  const result = await db.query(query, values);
  return result.rows;
}
