import { connectToPostgres } from './config/db.js';

async function addImageUrlColumn() {
  const db = await connectToPostgres();
  
  console.log('Adding image_url column to bills table...');
  
  try {
    await db.query(`
      ALTER TABLE bills 
      ADD COLUMN IF NOT EXISTS image_url TEXT,
      ADD COLUMN IF NOT EXISTS cloudinary_public_id TEXT;
    `);
    console.log('✅ image_url and cloudinary_public_id columns added to bills table');
  } catch (err) {
    console.error('Error adding columns:', err.message);
  }
  
  process.exit(0);
}

addImageUrlColumn();
