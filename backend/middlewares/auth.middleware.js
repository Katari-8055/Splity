import { verifyToken } from '../services/authService.js';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    // If no token provided, fallback or check x-user-id header for development/demo ease
    const userIdHeader = req.headers['x-user-id'];
    if (userIdHeader) {
      req.user = { userId: userIdHeader };
      return next();
    }
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const userIdHeader = req.headers['x-user-id'];

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) req.user = decoded;
  } else if (userIdHeader) {
    req.user = { userId: userIdHeader };
  }

  next();
}
