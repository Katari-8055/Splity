import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

let pool = null;

export async function connectToPostgres() {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL || process.env.NEON_DATABASE_URL;
    if (!databaseUrl) {
      console.warn('Warning: DATABASE_URL environment variable is missing');
    }

    const isCloudDb = databaseUrl && (
      databaseUrl.includes('supabase.com') || 
      databaseUrl.includes('supabase.co') || 
      databaseUrl.includes('neon.tech') ||
      databaseUrl.includes('sslmode=require')
    );

    pool = new Pool({
      connectionString: databaseUrl || 'postgresql://postgres:postgres@localhost:5432/expense_splitter',
      ssl: isCloudDb ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]:', err.message);
    });
  }
  return pool;
}

export default pool;
