import { connectToPostgres } from '../config/db.js';
import { createWorker } from 'tesseract.js';
import { v4 as uuidv4 } from 'uuid';
import { receiptExtractionChain } from '../ai/langchainConfig.js';

export async function processOCR(filePath) {
  try {
    const worker = await createWorker('eng');
    const ret = await worker.recognize(filePath);
    await worker.terminate();
    return ret.data.text;
  } catch (error) {
    console.error('Tesseract OCR error:', error);
    return '';
  }
}

export async function parseBillText(rawText) {
  if (!rawText || !rawText.trim()) {
    return { merchantName: 'Unknown Merchant', totalAmount: 0, items: [] };
  }

  try {
    // Primary: LangChain Gemini Structured Extraction
    const structuredResult = await receiptExtractionChain.invoke({ rawText });
    return structuredResult;
  } catch (error) {
    console.warn('[LangChain OCR Parsing Fallback] Falling back to regex parser:', error);
    // Fallback: Deterministic Regex Parser
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];
    let totalAmount = 0;
    let merchantName = lines[0] || 'Unknown Merchant';
    const priceRegex = /(\d+[.,]\d{2})/;

    for (const line of lines) {
      if (/total/i.test(line)) {
        const match = line.match(priceRegex);
        if (match) totalAmount = parseFloat(match[1].replace(',', '.'));
      } else {
        const match = line.match(/(.+?)\s+\$?(\d+[.,]\d{2})/);
        if (match) {
          items.push({
            item_name: match[1].trim(),
            price: parseFloat(match[2].replace(',', '.')),
            quantity: 1,
            category: 'General'
          });
        }
      }
    }

    return { merchantName, totalAmount, items };
  }
}

export async function createBillRecord(userId, filename, rawText, parsedData) {
  const db = await connectToPostgres();
  const billId = uuidv4();
  
  const query = `
    INSERT INTO bills (id, user_id, filename, merchant_name, total_amount, raw_ocr_text, parsed_data, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING *
  `;
  const values = [
    billId,
    userId,
    filename,
    parsedData.merchantName || 'Unknown Merchant',
    parsedData.totalAmount || 0,
    rawText,
    JSON.stringify(parsedData)
  ];
  
  const result = await db.query(query, values);
  const bill = result.rows[0];

  if (parsedData.items && parsedData.items.length > 0) {
    for (const item of parsedData.items) {
      await db.query(
        `INSERT INTO bill_items (bill_id, item_name, price, quantity, category)
         VALUES ($1, $2, $3, $4, $5)`,
        [billId, item.item_name, item.price, item.quantity || 1, item.category || 'General']
      );
    }
  }

  return bill;
}

export async function getBillById(billId) {
  const db = await connectToPostgres();
  const billRes = await db.query(`SELECT * FROM bills WHERE id = $1`, [billId]);
  if (!billRes.rows[0]) return null;

  const itemsRes = await db.query(`SELECT * FROM bill_items WHERE bill_id = $1`, [billId]);
  return {
    ...billRes.rows[0],
    items: itemsRes.rows
  };
}

export async function getUserBills(userId) {
  const db = await connectToPostgres();
  const result = await db.query(`SELECT * FROM bills WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
  return result.rows;
}

export async function saveReceipt(expenseId, fileUrl) {
  const db = await connectToPostgres();
  const query = `INSERT INTO receipts (expense_id, file_url, uploaded_at) VALUES ($1, $2, NOW()) RETURNING *`;
  const result = await db.query(query, [expenseId, fileUrl]);
  return result.rows[0];
}

export async function getReceiptsByExpense(expenseId) {
  const db = await connectToPostgres();
  const result = await db.query(`SELECT * FROM receipts WHERE expense_id = $1`, [expenseId]);
  return result.rows;
}
