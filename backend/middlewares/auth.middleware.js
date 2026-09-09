import { verifyToken } from '../services/authService.js';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const userIdHeader = req.headers['x-user-id'];

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
  }

  // Fallback to x-user-id header
  if (userIdHeader) {
    req.user = { userId: userIdHeader };
    return next();
  }

  return res.status(401).json({ error: 'Access token or user ID required' });
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const userIdHeader = req.headers['x-user-id'];

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }

  // Always fallback to x-user-id if req.user not set by token
  if (!req.user && userIdHeader) {
    req.user = { userId: userIdHeader };
  }

  next();
}
