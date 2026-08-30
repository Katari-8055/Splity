import { connectToPostgres } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

export async function createGroup(group) {
  const db = await connectToPostgres();
  const id = group.id || uuidv4();
  const query = `INSERT INTO groups (id, name, created_by) VALUES ($1, $2, $3) RETURNING *`;
  const result = await db.query(query, [id, group.name, group.createdBy]);
  return result.rows[0];
}

export async function getGroup(groupId) {
  const db = await connectToPostgres();
  const result = await db.query(`SELECT * FROM groups WHERE id = $1`, [groupId]);
  return result.rows[0];
}

export async function listGroups(userId) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT g.* FROM groups g 
     JOIN group_members gm ON gm.group_id = g.id 
     WHERE gm.user_id = $1`,
    [userId]
  );
  return result.rows;
}

export async function updateGroupMembers(groupId, members) {
  const db = await connectToPostgres();
  await db.query(`DELETE FROM group_members WHERE group_id = $1`, [groupId]);
  const insertPromises = members.map((m) =>
    db.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
      groupId,
      m,
    ])
  );
  await Promise.all(insertPromises);
  return { groupId, members };
}

export async function getGroupMembers(groupId) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT u.id, u.name, u.email, u.phone
     FROM group_members gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1`,
    [groupId]
  );
  return result.rows;
}

export async function getGroupMessages(groupId) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT gm.*, u.name as user_name
     FROM group_messages gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1
     ORDER BY gm.created_at ASC`,
    [groupId]
  );
  return result.rows;
}

export async function addGroupMessage(groupId, userId, message) {
  const db = await connectToPostgres();
  const query = `
    INSERT INTO group_messages (group_id, user_id, message)
    VALUES ($1, $2, $3) RETURNING *`;
  const result = await db.query(query, [groupId, userId, message]);
  return result.rows[0];
}
