import pkg from 'pg';
const { Pool } = pkg;
import { neonConfig } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config();

// Disable WebSocket for HTTP Neon compatibility
neonConfig.webSocketConstructor = undefined;

const databaseUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

let pool = null;

export async function connectToPostgres() {
  if (!pool) {
    if (!databaseUrl) {
      console.warn('Warning: DATABASE_URL or NEON_DATABASE_URL environment variable is missing');
    }
    pool = new Pool({
      connectionString: databaseUrl || 'postgresql://postgres:postgres@localhost:5432/expense_splitter',
      ssl: databaseUrl && databaseUrl.includes('neon.tech') ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

export default pool;
