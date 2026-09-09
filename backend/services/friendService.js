import { connectToPostgres } from '../config/db.js';

export async function addFriend(userId, friendId) {
  if (!userId || !friendId || userId === friendId) return { user_id: userId, friend_id: friendId };
  
  const db = await connectToPostgres();
  
  // Ensure both users exist in users table
  await db.query(
    `INSERT INTO users (id, name, email, role) 
     VALUES ($1, $2, $3, 'user') 
     ON CONFLICT (id) DO NOTHING`,
    [userId, 'User', `${userId}@example.com`]
  );
  await db.query(
    `INSERT INTO users (id, name, email, role) 
     VALUES ($1, $2, $3, 'user') 
     ON CONFLICT (id) DO NOTHING`,
    [friendId, 'Friend', `${friendId}@example.com`]
  );

  // Reciprocal insert
  await db.query(`INSERT INTO friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, friendId]);
  await db.query(`INSERT INTO friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [friendId, userId]);
  
  return { user_id: userId, friend_id: friendId };
}

export async function deleteFriend(userId, friendId) {
  const db = await connectToPostgres();
  await db.query(`DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`, [userId, friendId]);
  return { user_id: userId, friend_id: friendId };
}

export async function checkFriendshipExists(userId, friendId) {
  const db = await connectToPostgres();
  const query = `SELECT 1 FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1) LIMIT 1`;
  const result = await db.query(query, [userId, friendId]);
  return result.rows.length > 0;
}

export async function listFriends(userId) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.phone 
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
         SELECT g.created_by FROM groups g
         JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_id = $1 AND g.created_by != $1
       )
     )
     ORDER BY u.name ASC`,
    [userId]
  );
  return result.rows;
}

export async function searchFriends(userId, prefix) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.phone 
     FROM users u
     WHERE u.id != $1 
       AND (u.name ILIKE $2 OR u.phone ILIKE $2 OR u.email ILIKE $2)
       AND (
         u.id IN (SELECT friend_id FROM friends WHERE user_id = $1) OR
         u.id IN (SELECT user_id FROM friends WHERE friend_id = $1) OR
         u.id IN (
           SELECT gm2.user_id FROM group_members gm1
           JOIN group_members gm2 ON gm1.group_id = gm2.group_id
           WHERE gm1.user_id = $1 AND gm2.user_id != $1
         )
       )`,
    [userId, `%${prefix}%`]
  );
  return result.rows;
}
