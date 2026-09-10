import { verifyToken } from '../services/authService.js';

/**
 * Strict authentication middleware.
 * Authenticates requests exclusively via cryptographically verified Bearer JWT tokens.
 * Client-controlled headers such as 'x-user-id' are explicitly ignored.
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || typeof authHeader !== 'string') {
    return res.status(401).json({ error: 'Authentication required. Missing Authorization header.' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
    return res.status(401).json({ error: 'Authentication required. Format must be: Bearer <token>' });
  }

  const token = parts[1];
  const decoded = verifyToken(token);

  if (!decoded || !decoded.userId) {
    return res.status(401).json({ error: 'Authentication failed. Invalid or expired token.' });
  }

  req.user = decoded;
  return next();
}

/**
 * Optional authentication middleware.
 * If a valid Bearer token is provided, populates req.user.
 * If no token or invalid token is provided, req.user remains undefined/null without failing.
 * Client-controlled identity headers are ignored.
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
      const decoded = verifyToken(parts[1]);
      if (decoded && decoded.userId) {
        req.user = decoded;
      }
    }
  }
  return next();
}
