import { settleDebt, settleExpenseById, getFriendBalanceWithClient } from '../services/settlementService.js';
import { createExpenseWithSplit, getFriendBalance, getUserBalances } from '../services/expenseService.js';
import { connectToPostgres } from '../config/db.js';
import { mcpClient } from '../mcp/mcpClient.js';
import { v4 as uuidv4 } from 'uuid';

async function runSettlementTestSuite() {
  console.log('====================================================');
  console.log('🧪 RUNNING CANONICAL SETTLEMENT SERVICE TEST SUITE');
  console.log('====================================================\n');

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

  // Setup unique test users
  const testUserA = `test-user-a-${Date.now()}`;
  const testUserB = `test-user-b-${Date.now()}`;

  // Helper to ensure test users exist in DB
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO users (id, name, email, role)
      VALUES 
        ($1, 'Alice Test', '${testUserA}@test.com', 'user'),
        ($2, 'Bob Test', '${testUserB}@test.com', 'user')
      ON CONFLICT (id) DO NOTHING
    `, [testUserA, testUserB]);
  } finally {
    client.release();
  }

  // TEST 1: Successful Settlement of Debt
  await assertTest('Successful Settlement of Outstanding Debt', async () => {
    // User A pays $100 dinner for User B -> B owes A $50
    await createExpenseWithSplit(testUserA, 100, 'Food', 'Dinner', 'Test Dinner', [testUserB], 'equal');

    const balBefore = await getFriendBalance(testUserA, testUserB);
    if (balBefore !== 50) {
      throw new Error(`Expected balance to be 50, got ${balBefore}`);
    }

    // User B settles the $50 debt with User A
    const settlement = await settleDebt(testUserB, testUserA);
    if (!settlement.success || settlement.settledAmount !== 50) {
      throw new Error(`Expected settlement of $50, got ${JSON.stringify(settlement)}`);
    }

    const balAfter = await getFriendBalance(testUserA, testUserB);
    if (balAfter !== 0) {
      throw new Error(`Expected balance to be 0 after settlement, got ${balAfter}`);
    }
  });

  // TEST 2: Rejection of Invalid / Non-positive Settlement Amount
  await assertTest('Reject Zero or Negative Settlement Amount', async () => {
    let rejectedNegative = false;
    let rejectedZero = false;

    try {
      await settleDebt(testUserA, testUserB, -25);
    } catch (err) {
      rejectedNegative = true;
    }

    try {
      await settleDebt(testUserA, testUserB, 0);
    } catch (err) {
      rejectedZero = true;
    }

    if (!rejectedNegative || !rejectedZero) {
      throw new Error('Expected settlement service to reject zero/negative amount');
    }
  });

  // TEST 3: Rejection of Over-Settlement (Settling More Than Debt)
  await assertTest('Reject Over-Settlement (amount > outstanding debt)', async () => {
    // User A pays $60 cab -> User B owes User A $30
    await createExpenseWithSplit(testUserA, 60, 'Transport', 'Taxi', 'Test Cab', [testUserB], 'equal');

    const bal = await getFriendBalance(testUserA, testUserB);
    if (bal !== 30) {
      throw new Error(`Expected balance to be 30, got ${bal}`);
    }

    // User B tries to settle $50 (which exceeds $30 debt)
    let rejectedOverSettlement = false;
    try {
      await settleDebt(testUserB, testUserA, 50);
    } catch (err) {
      if (err.message.includes('cannot exceed outstanding balance')) {
        rejectedOverSettlement = true;
      } else {
        throw err;
      }
    }

    if (!rejectedOverSettlement) {
      throw new Error('Expected over-settlement to be rejected');
    }

    // Clean up: settle the actual $30 debt
    await settleDebt(testUserB, testUserA, 30);
    const finalBal = await getFriendBalance(testUserA, testUserB);
    if (finalBal !== 0) {
      throw new Error(`Expected balance 0 after cleanup, got ${finalBal}`);
    }
  });

  // TEST 4: Handling Already-Settled Debt ($0 balance)
  await assertTest('Handling Already Settled Debt (Balance = $0)', async () => {
    const bal = await getFriendBalance(testUserA, testUserB);
    if (bal !== 0) {
      throw new Error(`Expected balance to be 0, got ${bal}`);
    }

    const res = await settleDebt(testUserA, testUserB);
    if (!res.success || res.settledAmount !== 0 || res.newBalance !== 0) {
      throw new Error(`Expected $0 settled for already settled debt, got ${JSON.stringify(res)}`);
    }
  });

  // TEST 5: Rejection of Self-Settlement
  await assertTest('Reject Self-Settlement (userId === friendId)', async () => {
    let rejectedSelf = false;
    try {
      await settleDebt(testUserA, testUserA);
    } catch (err) {
      if (err.message.includes('Cannot settle balance with yourself')) {
        rejectedSelf = true;
      }
    }

    if (!rejectedSelf) {
      throw new Error('Expected self-settlement to be rejected');
    }
  });

  // TEST 6: REST and MCP Consistency Check
  await assertTest('REST and MCP Consistency (Single Source of Truth)', async () => {
    const userC = `test-user-c-${Date.now()}`;
    const userD = `test-user-d-${Date.now()}`;

    // Create debt: User C pays $80 for User D -> User D owes User C $40
    await createExpenseWithSplit(userC, 80, 'Food', 'Lunch', 'Test Lunch', [userD], 'equal');

    // Settle via MCP Client tool call
    const mcpRes = await mcpClient.callTool('settle_up', {
      userId: userD,
      friendId: userC,
      amount: 40
    }, userD);

    if (!mcpRes.success || !mcpRes.data) {
      throw new Error(`MCP settle_up failed: ${mcpRes.error}`);
    }

    const balAfterMcp = await getFriendBalance(userC, userD);
    if (balAfterMcp !== 0) {
      throw new Error(`Expected balance 0 after MCP settle_up, got ${balAfterMcp}`);
    }

    // Now create debt in reverse: User D pays $60 for User C -> User C owes User D $30
    const exp = await createExpenseWithSplit(userD, 60, 'Food', 'Snacks', 'Test Snacks', [userC], 'equal');

    // Settle via REST helper (settleExpenseById)
    const restRes = await settleExpenseById(exp.expense.id, userC, 30);
    if (!restRes.success || restRes.settledAmount !== 30) {
      throw new Error(`REST settlement failed: ${JSON.stringify(restRes)}`);
    }

    const balAfterRest = await getFriendBalance(userC, userD);
    if (balAfterRest !== 0) {
      throw new Error(`Expected balance 0 after REST settleExpenseById, got ${balAfterRest}`);
    }
  });

  // TEST 7: Transaction Rollback on Database Failure
  await assertTest('Transaction Safety & Rollback on Error', async () => {
    const userE = `test-user-e-${Date.now()}`;
    const userF = `test-user-f-${Date.now()}`;

    // User E pays $50 -> User F owes $25
    await createExpenseWithSplit(userE, 50, 'Food', 'Breakfast', 'Test Breakfast', [userF], 'equal');

    // Intentionally pass an invalid amount causing a rejection inside settleDebt
    try {
      await settleDebt(userF, userE, 99999); // Exceeds balance
    } catch (err) {
      // Expected rollback
    }

    // Verify balance is unchanged and no partial records were committed
    const bal = await getFriendBalance(userE, userF);
    if (bal !== 25) {
      throw new Error(`Expected balance to remain 25 after rollback, got ${bal}`);
    }
  });

  console.log('====================================================');
  console.log(`🏁 SETTLEMENT SUITE: ${passedCount} / ${testCount} PASSED`);
  console.log('====================================================\n');

  await mcpClient.close();
  process.exit(0);
}

runSettlementTestSuite().catch(async (err) => {
  console.error('Fatal test error:', err);
  await mcpClient.close();
  process.exit(1);
});
