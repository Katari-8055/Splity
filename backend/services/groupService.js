import { connectToPostgres } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

export async function createGroup(group) {
  const db = await connectToPostgres();
  const id = group.id || uuidv4();
  const query = `INSERT INTO groups (id, name, created_by) VALUES ($1, $2, $3) RETURNING *`;
  const result = await db.query(query, [id, group.name, group.createdBy]);
  
  // Ensure creator is also added to group_members
  if (group.createdBy) {
    await db.query(
      `INSERT INTO users (id, name, email, role) 
       VALUES ($1, $2, $3, 'user') 
       ON CONFLICT (id) DO NOTHING`,
      [group.createdBy, 'Group Creator', `${group.createdBy}@example.com`]
    );
    await db.query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, group.createdBy]
    );
  }
  
  return result.rows[0];
}

export async function getGroup(groupId) {
  const db = await connectToPostgres();
  // Match by ID or by name
  const result = await db.query(
    `SELECT g.*,
       (SELECT COUNT(DISTINCT user_id) FROM group_members WHERE group_id = g.id) as member_count,
       (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE group_id = g.id) as total_spent
     FROM groups g 
     WHERE g.id = $1 OR g.name ILIKE $1
     LIMIT 1`,
    [groupId]
  );
  return result.rows[0] || null;
}

export async function listGroups(userId) {
  const db = await connectToPostgres();
  // Include groups where user is a member, creator, or participant in expenses
  const result = await db.query(
    `SELECT DISTINCT g.*,
       (SELECT COUNT(DISTINCT gm2.user_id) FROM group_members gm2 WHERE gm2.group_id = g.id) as member_count,
       (SELECT COALESCE(SUM(amount), 0) FROM expenses e WHERE e.group_id = g.id) as total_spent
     FROM groups g 
     LEFT JOIN group_members gm ON gm.group_id = g.id 
     LEFT JOIN expenses e ON e.group_id = g.id
     LEFT JOIN expense_splits es ON es.expense_id = e.id
     WHERE gm.user_id = $1 
        OR g.created_by = $1 
        OR e.user_id = $1 
        OR es.user_id = $1
        OR g.id = $1
     ORDER BY g.created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function updateGroupMembers(groupId, members) {
  const db = await connectToPostgres();
  
  // Ensure group exists
  const group = await getGroup(groupId);
  const allMembers = Array.from(new Set([
    ...(group?.created_by ? [group.created_by] : []),
    ...(members || [])
  ])).filter(Boolean);

  // Ensure all member user IDs exist in users table first to satisfy foreign key constraints
  for (const mId of allMembers) {
    await db.query(
      `INSERT INTO users (id, name, email, role) 
       VALUES ($1, $2, $3, 'user') 
       ON CONFLICT (id) DO NOTHING`,
      [mId, mId === group?.created_by ? 'Group Creator' : `Member-${mId.substring(0, 6)}`, `${mId}@example.com`]
    );
  }

  // Update group members
  await db.query(`DELETE FROM group_members WHERE group_id = $1`, [groupId]);
  const insertPromises = allMembers.map((m) =>
    db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
      groupId,
      m,
    ])
  );
  await Promise.all(insertPromises);
  return { groupId, members: allMembers };
}

export async function getGroupMembers(groupId) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT DISTINCT 
       COALESCE(u.id, gm.user_id) as id, 
       COALESCE(u.name, 'Member') as name, 
       COALESCE(u.email, gm.user_id || '@example.com') as email, 
       u.phone
     FROM group_members gm
     LEFT JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1
     
     UNION
     
     SELECT DISTINCT 
       u.id, 
       u.name, 
       u.email, 
       u.phone
     FROM groups g
     JOIN users u ON g.created_by = u.id
     WHERE g.id = $1`,
    [groupId]
  );
  return result.rows;
}

export async function getGroupMessages(groupId) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT gm.*, COALESCE(u.name, 'Member') as user_name
     FROM group_messages gm
     LEFT JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1
     ORDER BY gm.created_at ASC`,
    [groupId]
  );
  return result.rows;
}

export async function addGroupMessage(groupId, userId, message) {
  const db = await connectToPostgres();
  
  // Ensure user exists
  await db.query(
    `INSERT INTO users (id, name, email, role) 
     VALUES ($1, $2, $3, 'user') 
     ON CONFLICT (id) DO NOTHING`,
    [userId, 'User', `${userId}@example.com`]
  );

  const query = `
    INSERT INTO group_messages (group_id, user_id, message)
    VALUES ($1, $2, $3) RETURNING *`;
  const result = await db.query(query, [groupId, userId, message]);
  return result.rows[0];
}
