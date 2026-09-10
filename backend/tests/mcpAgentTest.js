import { mcpAgent } from '../ai/mcpAgent.js';
import { mcpClient } from '../mcp/mcpClient.js';
import { listFriends } from '../services/friendService.js';
import { listGroups } from '../services/groupService.js';

async function runTestSuite() {
  console.log('====================================================');
  console.log('🚀 RUNNING SPENDSAVVY MCP AGENT TEST SUITE');
  console.log('====================================================\n');

  const userId = 'demo-user-id';
  const friends = await listFriends(userId);
  const groups = await listGroups(userId);

  const userContext = {
    userId,
    userName: 'Demo User',
    friends: friends || [],
    groups: groups || [],
    conversationHistory: [],
  };

  console.log(`👤 User Context: ${userContext.userName} (${userContext.userId}), Friends: ${userContext.friends.length}, Groups: ${userContext.groups.length}\n`);

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
    }
  }

  // TEST 1: Read-Only Balance Summary
  await assertTest('Read-Only Balances Query', async () => {
    const res = await mcpAgent.processMessage('Who owes me money and what is my net balance?', userContext);
    console.log('Agent Response:', res.message);
    if (!res.message || typeof res.message !== 'string') {
      throw new Error('Expected message in response');
    }
  });

  // TEST 2: Read-Only Groups Query
  await assertTest('Read-Only List Groups Query', async () => {
    const res = await mcpAgent.processMessage('What groups am I in?', userContext);
    console.log('Agent Response:', res.message);
    if (!res.message) {
      throw new Error('Expected message in response');
    }
  });

  // TEST 3: Mutation Interception & Two-Phase Confirmation
  let pendingData = null;
  await assertTest('Two-Phase Confirmation on Expense Split', async () => {
    const res = await mcpAgent.processMessage('Split $90 dinner with Rahul and Priya', userContext);
    console.log('Agent Response:', res.message);
    console.log('Needs Confirmation:', res.needsConfirmation);
    if (!res.needsConfirmation) {
      throw new Error('Expected needsConfirmation to be true for expense creation mutation');
    }
    if (!res.pendingConfirmation) {
      throw new Error('Expected pendingConfirmation payload');
    }
    pendingData = res.pendingConfirmation;
  });

  // TEST 4: Confirmation Execution
  if (pendingData) {
    await assertTest('Execution of Confirmed Action ("Yes")', async () => {
      const confirmContext = {
        ...userContext,
        pendingConfirmation: pendingData,
      };
      const res = await mcpAgent.processMessage('Yes, please create it', confirmContext);
      console.log('Agent Response:', res.message);
      console.log('Saved Status:', res.saved);
      if (!res.saved) {
        throw new Error('Expected saved to be true after confirmation');
      }
    });
  }

  // TEST 5: Settlement Query
  await assertTest('Settlement with Friend', async () => {
    const res = await mcpAgent.processMessage('Settle up with Priya', userContext);
    console.log('Agent Response:', res.message);
    if (!res.message) {
      throw new Error('Expected settlement response');
    }
  });

  console.log('====================================================');
  console.log(`🏁 TEST RESULTS: ${passedCount} / ${testCount} PASSED`);
  console.log('====================================================');

  await mcpClient.close();
  process.exit(passedCount === testCount ? 0 : 1);
}

runTestSuite().catch(async (err) => {
  console.error('Fatal test runner error:', err);
  await mcpClient.close();
  process.exit(1);
});
