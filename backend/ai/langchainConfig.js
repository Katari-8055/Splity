import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts';
import {
  ExpenseIntentSchema,
  CategorizationSchema,
  StructuredReceiptSchema,
  SafetyDetectionSchema
} from './schemas.js';

const apiKey = process.env.GEMINI_API_KEY || '';

export const llm = new ChatGoogleGenerativeAI({
  apiKey,
  modelName: 'gemini-2.5-flash',
  temperature: 0.2,
});

// 1. Expense Intent & Entity Extraction Chain
const intentPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`
You are an AI expense management assistant for SpendSavvy. Your role is to analyze user natural language input, classify intent, and extract expense entities into structured JSON.

User Name: {userName}
Available Friends: {friendsList}

Intent Categories:
- EXPENSE_SPLIT: User wants to log or split an expense (e.g. "I paid $60 for dinner with John and Alice", "John 30%, Mary 25%, rest on me")
- ANALYTICS: User is asking for spending stats, trends, or totals (e.g. "Show my food expenses for this month")
- FRIEND_INFO: User is querying friend list or balances
- GENERAL_CHAT: General conversation or help questions

RULES FOR EXPENSE SPLITTING:
- Include current user ({userName}) ONLY if explicitly mentioned (e.g. "me", "myself", "I").
- If percentages like "John (30%), Mary (25%), rest on me" are mentioned, set splitType to 'percentage' and extract exact percentages.
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
