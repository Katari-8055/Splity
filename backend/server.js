import app from './app.js';
import { initializeDatabase } from './database/init.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config();

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    console.log('Initializing Supabase PostgreSQL database schema...');
    await initializeDatabase();
    console.log('Database initialized successfully.');

    app.listen(PORT, () => {
      console.log(`Backend Express server listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start backend server:', error);
    process.exit(1);
  }
}

startServer();
