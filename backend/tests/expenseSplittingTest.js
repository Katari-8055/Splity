import {
  calculateEqualSplits,
  validateAndNormalizeCustomSplits,
  createExpenseWithSplit,
  getUserBalances,
  getFriendBalance
} from '../services/expenseService.js';
import { connectToPostgres } from '../config/db.js';
import { initializeDatabase } from '../database/init.js';

async function runExpenseSplittingTestSuite() {
  console.log('====================================================');
  console.log('🧪 RUNNING EXPENSE SPLITTING & PERFORMANCE TEST SUITE');
  console.log('====================================================\n');

  // Initialize DB and ensure indexes are created
  await initializeDatabase();
  const pool = await connectToPostgres();

  let testCount = 0;
  let passedCount = 0;

  async function assertTest(testName, testFn) {
    testCount++;
    console.log(`--- Test ${testCount}: ${testName} ---`);
    try {
      await testFn();
      passedCount++;
      console.log(`✅ PASSED\n`);
    } catch (err) {
      console.error(`❌ FAILED: ${err.message}\n`);
      throw err;
    }
  }

  // TEST 1: Two-Person Equal Split (₹100 for 2 people)
  await assertTest('Two-Person Equal Split ($100 for 2)', async () => {
    const splits = calculateEqualSplits(100, ['userA', 'userB']);
    if (splits.length !== 2) throw new Error(`Expected 2 splits, got ${splits.length}`);
    if (splits[0].amount !== 50 || splits[1].amount !== 50) {
      throw new Error(`Expected 50 and 50, got ${JSON.stringify(splits)}`);
    }
    const sum = splits.reduce((acc, s) => acc + s.amount, 0);
    if (Math.abs(sum - 100) > 0.001) throw new Error(`Sum is ${sum}, expected 100`);
  });

  // TEST 2: Three-Person Equal Split ($100 for 3 people - Cent precision remainder)
  await assertTest('Three-Person Equal Split ($100 for 3 -> 33.34 + 33.33 + 33.33 = $100.00)', async () => {
    const splits = calculateEqualSplits(100, ['userA', 'userB', 'userC']);
    if (splits.length !== 3) throw new Error(`Expected 3 splits, got ${splits.length}`);
    
    // Remainder cent must be given to participant 0
    if (splits[0].amount !== 33.34 || splits[1].amount !== 33.33 || splits[2].amount !== 33.33) {
      throw new Error(`Incorrect division: ${JSON.stringify(splits)}`);
    }

    const sum = splits.reduce((acc, s) => acc + Math.round(s.amount * 100), 0) / 100;
    if (sum !== 100.00) {
      throw new Error(`Sum of shares (${sum}) does not equal total 100.00 exactly`);
    }
  });

  // TEST 3: $10 Split among 3 people
  await assertTest('$10 Split among 3 people ($3.34 + $3.33 + $3.33 = $10.00)', async () => {
    const splits = calculateEqualSplits(10, ['userA', 'userB', 'userC']);
    if (splits[0].amount !== 3.34 || splits[1].amount !== 3.33 || splits[2].amount !== 3.33) {
      throw new Error(`Incorrect $10 division: ${JSON.stringify(splits)}`);
    }
    const sum = splits.reduce((acc, s) => acc + Math.round(s.amount * 100), 0) / 100;
    if (sum !== 10.00) {
      throw new Error(`Sum (${sum}) does not equal 10.00`);
    }
  });

  // TEST 4: Valid Custom Split ($100 -> A: $60, B: $40)
  await assertTest('Valid Custom Split ($60 + $40 = $100)', async () => {
    const custom = [
      { userId: 'userA', amount: 60 },
      { userId: 'userB', amount: 40 }
    ];
    const normalized = validateAndNormalizeCustomSplits(100, custom);
    if (normalized[0].amount !== 60 || normalized[1].amount !== 40) {
      throw new Error(`Unexpected normalization: ${JSON.stringify(normalized)}`);
    }
  });

  // TEST 5: Invalid Custom Split ($60 + $50 = $110 !== $100 -> Rejected)
  await assertTest('Invalid Custom Split Sum Rejection ($60 + $50 != $100)', async () => {
    let rejected = false;
    try {
      validateAndNormalizeCustomSplits(100, [
        { userId: 'userA', amount: 60 },
        { userId: 'userB', amount: 50 }
      ]);
    } catch (err) {
      if (err.message.includes('must equal the total expense amount')) {
        rejected = true;
      }
    }
    if (!rejected) throw new Error('Expected custom split sum mismatch to be rejected');
  });

  // TEST 6: Negative Custom Split Rejection
  await assertTest('Negative Custom Split Amount Rejection', async () => {
    let rejected = false;
    try {
      validateAndNormalizeCustomSplits(100, [
        { userId: 'userA', amount: 120 },
        { userId: 'userB', amount: -20 }
      ]);
    } catch (err) {
      if (err.message.includes('must be a positive number greater than 0')) {
        rejected = true;
      }
    }
    if (!rejected) throw new Error('Expected negative amount to be rejected');
  });

  // TEST 7: Duplicate Participant Rejection
  await assertTest('Duplicate Participant Rejection in Custom Split', async () => {
    let rejected = false;
    try {
      validateAndNormalizeCustomSplits(100, [
        { userId: 'userA', amount: 50 },
        { userId: 'userA', amount: 50 }
      ]);
    } catch (err) {
      if (err.message.includes('Duplicate participant')) {
        rejected = true;
      }
    }
    if (!rejected) throw new Error('Expected duplicate participant to be rejected');
  });

  // TEST 8: Full End-to-End DB Expense Creation & Optimized Aggregated Balance Check
  await assertTest('DB Insertion & Single-Query Aggregated Balance Correctness', async () => {
    const userX = `test-user-x-${Date.now()}`;
    const userY = `test-user-y-${Date.now()}`;
    const userZ = `test-user-z-${Date.now()}`;

    // User X pays $90 for User Y and User Z (3 people -> $30 each)
    const result = await createExpenseWithSplit(userX, 90, 'Food', 'Dinner', 'Big Dinner', [userY, userZ], 'equal');

    if (result.splits.length !== 3) {
      throw new Error(`Expected 3 split rows, got ${result.splits.length}`);
    }

    // Verify User X balances
    const userXBalances = await getUserBalances(userX);
    if (userXBalances.totalYouAreOwed !== 60) {
      throw new Error(`Expected User X totalYouAreOwed to be 60, got ${userXBalances.totalYouAreOwed}`);
    }
    if (userXBalances.totalYouOwe !== 0) {
      throw new Error(`Expected User X totalYouOwe to be 0, got ${userXBalances.totalYouOwe}`);
    }
    if (userXBalances.netBalance !== 60) {
      throw new Error(`Expected User X netBalance to be 60, got ${userXBalances.netBalance}`);
    }

    // Verify User Y balance with User X
    const balY = await getFriendBalance(userY, userX);
    if (balY !== -30) {
      throw new Error(`Expected User Y balance with X to be -30 (owes 30), got ${balY}`);
    }
  });

  // TEST 9: Database Indexes Existence Check
  await assertTest('Verify PostgreSQL Performance Indexes Exist', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT indexname FROM pg_indexes 
        WHERE tablename IN ('expenses', 'expense_splits', 'friends', 'group_members')
      `);
      const indexNames = res.rows.map(r => r.indexname);
      
      const requiredIndexes = [
        'idx_expenses_user_id',
        'idx_expenses_group_id',
        'idx_expenses_created_at',
        'idx_expense_splits_user_id',
        'idx_friends_friend_id',
        'idx_group_members_user_id'
      ];

      for (const idx of requiredIndexes) {
        if (!indexNames.includes(idx)) {
          throw new Error(`Missing expected database index: ${idx}`);
        }
      }
    } finally {
      client.release();
    }
  });

  console.log('====================================================');
  console.log(`🏁 ALL TESTS PASSED: ${passedCount} / ${testCount}`);
  console.log('====================================================\n');

  process.exit(0);
}

runExpenseSplittingTestSuite().catch((err) => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
