import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'test') {
      return 'test_jwt_secret_key_1234567890';
    }
    throw new Error('JWT_SECRET environment variable is required and cannot be empty.');
  }
  return secret;
}

export async function hashPassword(password) {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
}

export async function comparePassword(password, hashedPassword) {
  return await bcrypt.compare(password, hashedPassword);
}

export function generateToken(userId, email, options = {}) {
  if (!userId) {
    throw new Error('userId is required to generate a token');
  }
  const secret = getJwtSecret();
  return jwt.sign(
    { userId, email },
    secret,
    { expiresIn: options.expiresIn || '7d' }
  );
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret);
    if (!decoded || typeof decoded !== 'object' || !decoded.userId) {
      return null;
    }
    return decoded;
  } catch (error) {
    return null;
  }
}

export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validatePhone(phone) {
  const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
  return phoneRegex.test(phone);
}

export function validatePassword(password) {
  if (!password || password.length < 8) {
    return { isValid: false, message: 'Password must be at least 8 characters long' };
  }
  if (!/(?=.*[a-z])/.test(password)) {
    return { isValid: false, message: 'Password must contain at least one lowercase letter' };
  }
  if (!/(?=.*[A-Z])/.test(password)) {
    return { isValid: false, message: 'Password must contain at least one uppercase letter' };
  }
  if (!/(?=.*\d)/.test(password)) {
    return { isValid: false, message: 'Password must contain at least one number' };
  }
  return { isValid: true, message: 'Password is valid' };
}
