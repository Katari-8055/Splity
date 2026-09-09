import { connectToPostgres } from '../config/db.js';
import { uploadToCloudinary } from '../config/cloudinary.js';
import { v4 as uuidv4 } from 'uuid';
import { receiptExtractionChain } from '../ai/langchainConfig.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Upload image buffer to Cloudinary and return the URL + public_id
 */
export async function uploadBillToCloudinary(fileBuffer, originalname) {
  return uploadToCloudinary(fileBuffer, originalname);
}

/**
 * Use Gemini Vision to extract receipt text from a Cloudinary image URL
 * This is far more accurate than Tesseract for real receipts
 */
export async function extractReceiptWithGeminiVision(imageBufferOrUrl, mimeType = 'image/jpeg') {
  try {
    let base64 = '';
    let finalMime = mimeType;

    if (Buffer.isBuffer(imageBufferOrUrl)) {
      base64 = imageBufferOrUrl.toString('base64');
    } else if (typeof imageBufferOrUrl === 'string' && imageBufferOrUrl.startsWith('data:')) {
      const parts = imageBufferOrUrl.split(',');
      base64 = parts[1];
      const mimeMatch = parts[0].match(/:(.*?);/);
      if (mimeMatch) finalMime = mimeMatch[1];
    } else if (typeof imageBufferOrUrl === 'string' && imageBufferOrUrl.startsWith('http')) {
      const response = await fetch(imageBufferOrUrl);
      const arrayBuffer = await response.arrayBuffer();
      base64 = Buffer.from(arrayBuffer).toString('base64');
      finalMime = response.headers.get('content-type') || mimeType;
    }

    if (!base64) {
      console.warn('[Gemini Vision OCR] No valid image base64 data to process');
      return '';
    }

    const prompt = `You are a receipt/bill OCR expert. Analyze this receipt image carefully and extract ALL text exactly as it appears.
Return the raw extracted text, preserving line breaks and spacing as much as possible.
Include: merchant name, date, all line items with their prices, subtotal, tax, and total.
Do not interpret or modify - just extract the raw text.`;

    const candidateModels = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'];

    for (const modelName of candidateModels) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const generatePromise = model.generateContent([
          { inlineData: { data: base64, mimeType: finalMime } },
          prompt
        ]);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Model timeout')), 5000));
        const result = await Promise.race([generatePromise, timeoutPromise]);
        const text = result?.response?.text();
        if (text) {
          console.log(`[Gemini Vision OCR] Successfully extracted with ${modelName}`);
          return text;
        }
      } catch (err) {
        console.warn(`[Gemini Vision OCR] Model ${modelName} failed (${err.message}), trying next...`);
      }
    }

    return '';
  } catch (error) {
    console.error('[Gemini Vision OCR] Error:', error.message);
    return '';
  }
}

export async function parseBillText(rawText) {
  if (!rawText || !rawText.trim()) {
    return { merchantName: 'Unknown Merchant', totalAmount: 0, items: [] };
  }

  // Fallback regex parser function
  const runRegexParser = (text) => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];
    let totalAmount = 0;
    let merchantName = lines[0] || 'Unknown Merchant';
    
    // Check first 3 lines for merchant name (skip dates/numbers)
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      if (lines[i].length > 2 && !/^\d+/.test(lines[i]) && !/tax|invoice|receipt/i.test(lines[i])) {
        merchantName = lines[i];
        break;
      }
    }

    const priceRegex = /[$£€]?\s*(\d+[.,]\d{2})/i;
    const totalKeywords = /total|amount due|subtotal|balance|grand total/i;

    for (const line of lines) {
      if (totalKeywords.test(line)) {
        const match = line.match(priceRegex);
        if (match) {
          const parsed = parseFloat(match[1].replace(',', '.'));
          if (parsed > totalAmount) totalAmount = parsed;
        }
      } else {
        const match = line.match(/(.+?)\s+[$£€]?\s*(\d+[.,]\d{2})/);
        if (match && !/tax|gst|rounding|cash|change|paid|invoice|date/i.test(match[1])) {
          items.push({
            item_name: match[1].replace(/[*#]/g, '').trim(),
            price: parseFloat(match[2].replace(',', '.')),
            quantity: 1,
            category: 'General'
          });
        }
      }
    }

    // If totalAmount is 0 but we found items, sum them up
    if (totalAmount === 0 && items.length > 0) {
      totalAmount = items.reduce((acc, it) => acc + (it.price || 0), 0);
    }

    return { merchantName, totalAmount, items };
  };

  try {
    // Primary: LangChain Gemini Structured Extraction with 4-second timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('LangChain parser timed out')), 4000)
    );
    const structuredResult = await Promise.race([
      receiptExtractionChain.invoke({ rawText }),
      timeoutPromise
    ]);
    return structuredResult;
  } catch (error) {
    console.warn('[LangChain OCR Parsing Fallback] Using regex parser:', error.message);
    return runRegexParser(rawText);
  }
}

/**
 * Save a bill record + items to database for the user
 * Now includes cloudinary_url and cloudinary_public_id
 */
export async function createBillRecord(userId, filename, rawText, parsedData, cloudinaryUrl = null, cloudinaryPublicId = null) {
  const billId = uuidv4();
  const defaultBill = {
    id: billId,
    user_id: userId,
    filename,
    merchant_name: parsedData?.merchantName || 'Unknown Merchant',
    total_amount: parsedData?.totalAmount || 0,
    raw_ocr_text: rawText || '',
    parsed_data: parsedData || {},
    image_url: cloudinaryUrl,
    created_at: new Date().toISOString()
  };

  try {
    const db = await connectToPostgres();
    const query = `
      INSERT INTO bills (id, user_id, filename, merchant_name, total_amount, raw_ocr_text, parsed_data, image_url, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING *
    `;
    const values = [
      billId,
      userId,
      filename,
      parsedData?.merchantName || 'Unknown Merchant',
      parsedData?.totalAmount || 0,
      rawText || '',
      JSON.stringify(parsedData || {}),
      cloudinaryUrl || null
    ];

    let bill;
    try {
      const result = await db.query(query, values);
      bill = result.rows[0];
    } catch (err) {
      if (err.code === '42703') {
        const fallbackQuery = `
          INSERT INTO bills (id, user_id, filename, merchant_name, total_amount, raw_ocr_text, parsed_data, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING *
        `;
        const result = await db.query(fallbackQuery, [
          billId,
          userId,
          filename,
          parsedData?.merchantName || 'Unknown Merchant',
          parsedData?.totalAmount || 0,
          rawText || '',
          JSON.stringify(parsedData || {})
        ]);
        bill = result.rows[0];
      } else {
        console.warn('[createBillRecord DB query warning]:', err.message);
        return defaultBill;
      }
    }

    // Insert line items
    if (parsedData?.items && parsedData.items.length > 0) {
      for (const item of parsedData.items) {
        await db.query(
          `INSERT INTO bill_items (bill_id, item_name, price, quantity, category)
           VALUES ($1, $2, $3, $4, $5)`,
          [billId, item.item_name, item.price, item.quantity || 1, item.category || 'General']
        ).catch(() => {});
      }
    }

    return { ...(bill || defaultBill), image_url: cloudinaryUrl };
  } catch (err) {
    console.warn('[createBillRecord fallback]:', err.message);
    return defaultBill;
  }
}

export async function getBillById(billId) {
  try {
    const db = await connectToPostgres();
    const billRes = await db.query(`SELECT * FROM bills WHERE id = $1`, [billId]);
    if (!billRes.rows[0]) return null;

    const itemsRes = await db.query(`SELECT * FROM bill_items WHERE bill_id = $1`, [billId])
      .catch(() => ({ rows: [] }));

    return {
      ...billRes.rows[0],
      items: itemsRes.rows
    };
  } catch (err) {
    console.warn('[getBillById warning]:', err.message);
    return null;
  }
}

export async function getUserBills(userId) {
  try {
    const db = await connectToPostgres();
    const result = await db.query(
      `SELECT * FROM bills WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  } catch (err) {
    console.warn('[getUserBills warning]:', err.message);
    return [];
  }
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
