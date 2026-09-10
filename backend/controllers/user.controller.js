import { getUser, searchAllUsers, initUser } from '../services/userService.js';

export async function getProfile(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = await getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { password, ...safeUser } = user;
    res.json(safeUser);
  } catch (error) {
    next(error);
  }
}

export async function searchUsers(req, res, next) {
  try {
    const query = req.query.q || req.query.query || '';
    if (!query) {
      return res.json([]);
    }
    const users = await searchAllUsers(query);
    const safeUsers = users.map(({ password, ...u }) => u);
    res.json(safeUsers);
  } catch (error) {
    next(error);
  }
}

export async function initializeUser(req, res, next) {
  try {
    const { name, email, phone, password, role } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }
    const user = await initUser({ name, email, phone, password, role });
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (error) {
    next(error);
  }
}
