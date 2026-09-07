import { z } from 'zod';

export const ParticipantSchema = z.object({
  name: z.string().describe('Name of the participant or friend'),
  email: z.string().optional().describe('Email of participant if available'),
  percentage: z.number().optional().describe('Percentage of split if custom/percentage split'),
  amount: z.number().optional().describe('Share amount owed or paid by participant'),
});

export const ExpenseDataSchema = z.object({
  description: z.string().default('Shared Expense').describe('Short description of expense'),
  amount: z.number().default(0).describe('Total dollar amount of expense'),
  category: z.string().default('Food').describe('Expense category like Food, Transport, Shopping, Bills, Entertainment, Other'),
  subcategory: z.string().optional().default('General').describe('Expense subcategory like Coffee, Groceries, Cab, Rent'),
  splitType: z.enum(['equal', 'percentage', 'custom']).default('equal').describe('Splitting method'),
  participants: z.array(ParticipantSchema).default([]).describe('List of participants involved in split'),
  friendIds: z.array(z.string()).default([]).describe('IDs or names of friends involved'),
  groupId: z.string().optional().describe('ID of group if expense is assigned to a group'),
});

export const ExpenseIntentSchema = z.object({
  type: z.enum([
    'expense_split',
    'analytics',
    'friend_balances',
    'friend_info',
    'list_expenses',
    'list_groups',
    'general_chat'
  ]).describe('Intent classification of the user message'),
  intent: z.string().describe('Short summary of what the user wants to do'),
  data: ExpenseDataSchema.optional().describe('Extracted expense details if type is expense_split'),
  needsConfirmation: z.boolean().default(false).describe('True if details need user confirmation before saving'),
  message: z.string().optional().describe('Natural language response or clarification question for the user'),
});

export const CategorizationSchema = z.object({
  category: z.enum(['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Other'])
    .describe('Primary category of expense'),
  subcategory: z.string().describe('Specific subcategory like Coffee, Taxi, Groceries, Utilities'),
  confidence: z.number().min(0).max(1).describe('Confidence score between 0 and 1'),
});

export const ReceiptItemSchema = z.object({
  item_name: z.string().describe('Name of item on receipt'),
  price: z.number().describe('Price of single unit or item total'),
  quantity: z.number().default(1).describe('Quantity purchased'),
  category: z.string().optional().default('General').describe('Inferred item category'),
});

export const StructuredReceiptSchema = z.object({
  merchantName: z.string().default('Unknown Merchant').describe('Merchant/store name on receipt'),
  totalAmount: z.number().default(0).describe('Total bill amount'),
  billDate: z.string().optional().describe('Date printed on bill (YYYY-MM-DD)'),
  items: z.array(ReceiptItemSchema).default([]).describe('List of line items on receipt'),
});

export const SafetyDetectionSchema = z.object({
  isUnsafe: z.boolean().describe('True if any item is hazardous or inappropriate for minors'),
  unsafeItems: z.array(z.string()).default([]).describe('List of flagged unsafe item names with price'),
  hazardCategory: z.string().optional().describe('Category of hazard like Alcohol, Tobacco, Drugs, Weapons, Adult'),
  reasoning: z.string().optional().describe('Brief explanation for the safety audit decision'),
});
