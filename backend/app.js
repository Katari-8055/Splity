import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import friendsRoutes from './routes/friends.routes.js';
import groupsRoutes from './routes/groups.routes.js';
import expensesRoutes from './routes/expenses.routes.js';
import billsRoutes from './routes/bills.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import parentRoutes from './routes/parent.routes.js';
import aiRoutes from './routes/ai.routes.js';

import { errorHandler } from './middlewares/error.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ─── Security Headers ────────────────────────────────────────────────────────
app.use(helmet({
  // Allow inline CSS for development (frontend served by Vite separately)
  contentSecurityPolicy: false
}));

// ─── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = (() => {
  const origins = [];
  if (process.env.FRONTEND_URL) origins.push(process.env.FRONTEND_URL);
  if (process.env.APP_DOMAIN) origins.push(process.env.APP_DOMAIN);
  // Always allow localhost for development
  origins.push('http://localhost:5173');
  origins.push('http://localhost:3000');
  origins.push('http://localhost:5000');
  origins.push('http://127.0.0.1:5173');
  return [...new Set(origins)];
})();

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, mobile apps, same-origin)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: Origin '${origin}' is not permitted.`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ─── Request Body Limits ─────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Rate Limiters ────────────────────────────────────────────────────────────
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // max 10 login attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  skipSuccessfulRequests: false
});

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30,             // max 30 AI requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests. Please slow down and try again shortly.' }
});

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.resolve(__dirname, 'uploads')));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth/signin', loginRateLimiter);   // Apply login rate limit before auth router
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/bills', billsRoutes);
app.use('/api', billsRoutes);
app.use('/api', analyticsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/ai', aiRateLimiter, aiRoutes);
app.use('/api/chat', aiRateLimiter, aiRoutes);

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
