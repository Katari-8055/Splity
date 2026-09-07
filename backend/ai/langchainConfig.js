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
  temperature: 0.2,
});

// 1. Expense Intent & Entity Extraction Chain
const intentPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`
You are an AI expense management assistant for SpendSavvy. Your role is to analyze user natural language input, classify intent, and extract expense entities into structured JSON.

User Name: {userName}
Available Friends: {friendsList}

Intent Categories:
- EXPENSE_SPLIT: User wants to log or split an expense (e.g. "I paid $60 for dinner with John and Alice", "split 50$ with all my friends", "split $100 with Rahul Bind")
- ANALYTICS: User is asking for spending stats, category breakdown, monthly/weekly totals (e.g. "Show my food expenses", "How much did I spend this month?")
- FRIEND_BALANCES: User is asking who owes what, debt summary, or net balance (e.g. "Who owes me money?", "What is my balance with Rahul?", "Do I owe anyone?")
- FRIEND_INFO: User is querying friends list or details (e.g. "Show my friends", "Who is in my friend list?")
- LIST_EXPENSES: User wants to see recent expenses or transaction history (e.g. "Show my recent expenses", "List my expenses")
- LIST_GROUPS: User is asking about their expense groups (e.g. "What groups am I in?", "List my groups")
- GENERAL_CHAT: General greetings, help, or conversation

RULES FOR EXPENSE SPLITTING:
- When user says "all my friends", include all friends from {friendsList} in participants and friendIds.
- Calculate exact split amounts per participant. If split is equal between user and friends, split amount = Total / (number of friends + (if user included ? 1 : 0)).
- Set needsConfirmation to true when proposing an expense split so the user can review and confirm.
- Provide a clear, friendly message in 'message' explaining the split details.
- Infer appropriate Category (Food, Transport, Shopping, Bills, Entertainment, Other) and Subcategory.
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
