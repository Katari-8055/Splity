import { connectToPostgres } from '../config/db.js';

export async function initializeDatabase() {
  const db = await connectToPostgres();
  
  try {
    // Users table
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20),
        password VARCHAR(255),
        balance DECIMAL(10,2) DEFAULT 0,
        role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'parent')),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Friends table
    await db.query(`
      CREATE TABLE IF NOT EXISTS friends (
        user_id VARCHAR(255) REFERENCES users(id),
        friend_id VARCHAR(255) REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, friend_id)
      )
    `);

    // Groups table
    await db.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_by VARCHAR(255) REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Group members table
    await db.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id VARCHAR(255) REFERENCES groups(id) ON DELETE CASCADE,
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (group_id, user_id)
      )
    `);

    // Group messages table
    await db.query(`
      CREATE TABLE IF NOT EXISTS group_messages (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id VARCHAR(255) REFERENCES groups(id) ON DELETE CASCADE,
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Expenses table
    await db.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(id),
        group_id VARCHAR(255) REFERENCES groups(id),
        category VARCHAR(100) NOT NULL,
        subcategory VARCHAR(100),
        amount DECIMAL(10,2) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Expense splits table
    await db.query(`
      CREATE TABLE IF NOT EXISTS expense_splits (
        expense_id VARCHAR(255) REFERENCES expenses(id) ON DELETE CASCADE,
        user_id VARCHAR(255) REFERENCES users(id),
        amount DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (expense_id, user_id)
      )
    `);

    // Receipts table
    await db.query(`
      CREATE TABLE IF NOT EXISTS receipts (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        expense_id VARCHAR(255) REFERENCES expenses(id) ON DELETE CASCADE,
        file_url TEXT NOT NULL,
        uploaded_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Notifications table
    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) REFERENCES users(id),
        type VARCHAR(50) DEFAULT 'general',
        message TEXT,
        data JSONB,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Bills table
    await db.query(`
      CREATE TABLE IF NOT EXISTS bills (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) REFERENCES users(id),
        filename VARCHAR(255) NOT NULL,
        merchant_name VARCHAR(255),
        total_amount DECIMAL(10,2),
        bill_date DATE,
        raw_ocr_text TEXT,
        parsed_data JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Bill items table
    await db.query(`
      CREATE TABLE IF NOT EXISTS bill_items (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        bill_id VARCHAR(255) REFERENCES bills(id) ON DELETE CASCADE,
        item_name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        quantity INTEGER DEFAULT 1,
        category VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Parent-child relationships table
    await db.query(`
      CREATE TABLE IF NOT EXISTS parent_child_relationships (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        child_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        threshold_amount DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(parent_id, child_id)
      )
    `);

    // Notification logs table
    await db.query(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        relationship_id VARCHAR(255) REFERENCES parent_child_relationships(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL CHECK (type IN ('spending_threshold', 'safety_alert')),
        alert_type VARCHAR(50),
        message TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Seed demo user and default friends for quick start & social finances
    await db.query(`
      INSERT INTO users (id, name, email, role)
      VALUES 
        ('demo-user-id', 'Demo User', 'demo@example.com', 'user'),
        ('friend-rahul', 'Rahul Sharma', 'rahul@example.com', 'user'),
        ('friend-priya', 'Priya Patel', 'priya@example.com', 'user'),
        ('friend-amit', 'Amit Verma', 'amit@example.com', 'user'),
        ('friend-alice', 'Alice Smith', 'alice@example.com', 'user')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email;
    `);

    await db.query(`
      INSERT INTO friends (user_id, friend_id)
      VALUES 
        ('demo-user-id', 'friend-rahul'),
        ('demo-user-id', 'friend-priya'),
        ('demo-user-id', 'friend-amit'),
        ('demo-user-id', 'friend-alice'),
        ('friend-rahul', 'demo-user-id'),
        ('friend-priya', 'demo-user-id'),
        ('friend-amit', 'demo-user-id'),
        ('friend-alice', 'demo-user-id')
      ON CONFLICT DO NOTHING;
    `);

    console.log('Database schema & default users initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}
