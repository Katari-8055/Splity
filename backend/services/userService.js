import { connectToPostgres } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

export async function addUser(user) {
  const db = await connectToPostgres();
  const id = user.id || uuidv4();
  const query = `INSERT INTO users (id, name, email, phone, password, balance, role) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`;
  const values = [id, user.name, user.email, user.phone || null, user.password || null, user.balance || 0, user.role || 'user'];
  const result = await db.query(query, values);
  return result.rows[0];
}

export async function getUser(userId) {
  const db = await connectToPostgres();
  const result = await db.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  return result.rows[0] || null;
}

export async function getUserByEmail(email) {
  const db = await connectToPostgres();
  const result = await db.query(`SELECT * FROM users WHERE email = $1`, [email]);
  return result.rows[0] || null;
}

export async function getUserByPhone(phone) {
  const db = await connectToPostgres();
  const result = await db.query(`SELECT * FROM users WHERE phone = $1`, [phone]);
  return result.rows[0] || null;
}

export async function searchAllUsers(searchTerm) {
  const db = await connectToPostgres();
  const result = await db.query(
    `SELECT id, name, email, phone 
     FROM users 
     WHERE name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1`,
    [`%${searchTerm}%`]
  );
  return result.rows;
}

export async function initUser({ name, email, phone, password, role }) {
  let user = await getUserByEmail(email);
  if (!user) {
    user = await addUser({
      name,
      email,
      phone,
      password,
      role: role || 'user'
    });
  }
  return user;
}
