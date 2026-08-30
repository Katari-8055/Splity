import { connectToPostgres } from '../config/db.js';

export async function addFriend(userId, friendId) {
  const db = await connectToPostgres();
  const query = `INSERT INTO friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *`;
  const result = await db.query(query, [userId, friendId]);
  return result.rows[0] || { user_id: userId, friend_id: friendId };
}

export async function deleteFriend(userId, friendId) {
  const db = await connectToPostgres();
  const query = `DELETE FROM friends WHERE user_id = $1 AND friend_id = $2 RETURNING *`;
  const result = await db.query(query, [userId, friendId]);
  return result.rows[0];
}

export async function checkFriendshipExists(userId, friendId) {
  const db = await connectToPostgres();
  const query = `SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2 LIMIT 1`;
  const result = await db.query(query, [userId, friendId]);
  return result.rows.length > 0;
}

export async function listFriends(userId) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT f.friend_id as id, u.name, u.email, u.phone 
     FROM friends f 
     JOIN users u ON f.friend_id = u.id 
     WHERE f.user_id = $1`,
    [userId]
  );
  return result.rows;
}

export async function searchFriends(userId, prefix) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT u.id, u.name, u.email, u.phone 
     FROM friends f 
     JOIN users u ON f.friend_id = u.id 
     WHERE f.user_id = $1 AND (u.name ILIKE $2 OR u.phone ILIKE $2 OR u.email ILIKE $2)`,
    [userId, `${prefix}%`]
  );
  return result.rows;
}
