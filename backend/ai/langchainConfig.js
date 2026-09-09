import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts';
import {
  ExpenseIntentSchema,
  CategorizationSchema,
  StructuredReceiptSchema,
  SafetyDetectionSchema
} from './schemas.js';

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || 'dummy_key_for_initialization';

export const llm = new ChatGoogleGenerativeAI({
  apiKey,
  modelName: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  temperature: 0.1,
});

// 1. Unified Master AI Intent & Entity Extraction Chain
const intentPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`
You are SpendSavvy AI, an intelligent, autonomous financial assistant and MCP coordinator for expense tracking, group management, and social finances.

Current User: {userName}
User Friends: {friendsList}
User Existing Groups: {groupsList}

Your role is to classify the user's intent and extract the necessary structured entities accurately.

Intent Categories:
1. CREATE_GROUP:
   - When user wants to create a new group (e.g., "create a group with all my friends and the group name should be Dargling Trip", "make a group called Goa Trip with Rahul and Priya", "create a room expenses group").
   - Extract 'groupData.groupName': The actual group title (e.g., "Dargling Trip", "Goa Trip", "Flatmates"). IMPORTANT: Do not set groupName to phrases like "with all my friends"; accurately extract the name following "name should be", "named", "called", etc.
   - Extract 'groupData.includeAllFriends': set to true if user says "all my friends", "all friends", "everyone", or implies all friends.
   - Extract 'groupData.memberNamesOrIds': names or IDs of specific friends if mentioned.

2. GROUP_DETAILS:
   - When user wants to view info, members, expenses, or stats of a specific group (e.g., "show details of Dargling Trip group", "what are expenses in Dargling Trip?", "who is in Goa Trip?").
   - Extract: 'groupData.groupName' or 'groupData.groupId'.

3. LIST_GROUPS:
   - When user asks about their groups (e.g., "What groups am I in?", "List all my groups", "Show my groups").

4. ADD_GROUP_MEMBER:
   - When user wants to add a friend or person to an existing group (e.g., "Add Rahul to Dargling Trip group").
   - Extract: 'groupData.groupName' and 'groupData.memberNamesOrIds'.

5. POST_GROUP_MESSAGE:
   - When user wants to post a note/chat message to a group (e.g., "Post 'Flight at 6am' in Dargling Trip group").
   - Extract: 'groupData.groupName', 'groupData.message'.

6. ADD_FRIEND:
   - When user wants to add a new friend (e.g., "Add a friend named Rohit with email rohit@test.com", "Add friend Priya").
   - Extract: 'friendData.name', 'friendData.email', 'friendData.phone'.

7. SETTLE_UP:
   - When user wants to settle debt or record a payment (e.g., "Settle up with Rahul", "I paid $25 to Alice", "Clear balance with Rohan").
   - Extract: 'friendData.name', 'friendData.amount'.

8. EXPENSE_SPLIT:
   - When user wants to log an expense or split a bill with friends or in a group (e.g., "Split $60 for dinner with John and Alice", "I paid $100 for groceries with all friends", "Add $150 hotel bill to Dargling Trip group").
   - Extract: 'data.amount', 'data.description', 'data.category', 'data.subcategory', 'data.splitType', 'data.friendIds', 'data.groupName', 'data.groupId', 'data.participants'.

9. FRIEND_BALANCES:
   - When user asks who owes what, debts, or net balances (e.g., "Who owes me money?", "What is my balance with Rahul?", "Do I owe anyone?").

10. FRIEND_INFO:
    - When user queries their friends list (e.g., "Show my friends", "Who is in my friend list?").

11. LIST_EXPENSES:
    - When user asks for recent expenses or transaction history (e.g., "Show my recent expenses", "List my transactions").

12. ANALYTICS:
    - When user asks for spending insights, category breakdown, monthly/weekly totals (e.g., "Show my spending insights", "How much did I spend this month?").

13. GENERAL_CHAT:
    - Greetings, general questions, or capabilities overview.

RULES & GUIDELINES:
- Understand English, Hindi, Hinglish, and multilingual phrasing naturally.
- Group name extraction MUST be precise. If user says "group name should be Dargling Trip", groupName MUST be "Dargling Trip".
- Provide a polite, helpful summary in 'message'.
- Set needsConfirmation to true when proposing an expense split so user can review before saving.
`),
  HumanMessagePromptTemplate.fromTemplate(`
Conversation History:
{history}

Current Message: "{message}"
`)
]);

export const expenseIntentChain = intentPrompt.pipe(
  llm.withStructuredOutput(ExpenseIntentSchema)
);

// 2. Expense Categorization Chain
const categorizationPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`
You are an expert expense categorizer. Analyze the expense description and amount to output the single best Category and Subcategory.

Allowed Categories:
- Food
- Transport
- Shopping
- Bills
- Entertainment
- Other
`),
  HumanMessagePromptTemplate.fromTemplate(`
Description: "{description}"
Amount: ${"{amount}"}
`)
]);

export const categorizationChain = categorizationPrompt.pipe(
  llm.withStructuredOutput(CategorizationSchema)
);

// 3. Receipt OCR Structured Extraction Chain
const receiptPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`
You are an OCR receipt parser AI. You are given raw OCR text extracted from a store receipt or bill image.
Extract the merchant name, total bill amount, date (if visible), and line items (name, price, quantity, category).

Be accurate and filter out noise or broken OCR characters.
`),
  HumanMessagePromptTemplate.fromTemplate(`
RAW OCR TEXT:
{rawText}
`)
]);

export const receiptExtractionChain = receiptPrompt.pipe(
  llm.withStructuredOutput(StructuredReceiptSchema)
);

// 4. Safety & Hazardous Item Detection Chain
const safetyPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`
You are a child safety monitoring AI. Analyze the items from a bill to identify ANY items hazardous or inappropriate for minors (under 18).

Categories to Flag:
1. ALCOHOL (Beer, Wine, Spirits, Liquor Stores)
2. TOBACCO (Cigarettes, Vapes, Cigars, Smoking items)
3. DRUGS (Cannabis, CBD, THC, Recreational drugs)
4. WEAPONS (Knives, Firearms, Blades)
5. ADULT CONTENT (Venues, Strip Clubs)

SAFE EXCEPTIONS: Cooking ingredients (vanilla extract), medical alcohol/sanitizer, cleaning wipes.
`),
  HumanMessagePromptTemplate.fromTemplate(`
Bill Items:
{itemsList}
`)
]);

export const safetyDetectionChain = safetyPrompt.pipe(
  llm.withStructuredOutput(SafetyDetectionSchema)
);
