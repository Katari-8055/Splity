import { processOCR, parseBillText, createBillRecord, getBillById, getUserBills, saveReceipt, getReceiptsByExpense } from '../services/billService.js';
import path from 'path';

export async function uploadOCR(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const userId = req.user?.userId || req.body.userId;
    const filePath = req.file.path;
    const filename = req.file.filename;

    const rawText = await processOCR(filePath);
    const parsedData = await parseBillText(rawText);

    let bill = null;
    if (userId) {
      bill = await createBillRecord(userId, filename, rawText, parsedData);
    }

    res.json({
      success: true,
      rawText,
      parsedData,
      bill,
      imageUrl: `/uploads/${filename}`
    });
  } catch (error) {
    next(error);
  }
}

export async function getBill(req, res, next) {
  try {
    const { billId } = req.params;
    const bill = await getBillById(billId);
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    res.json(bill);
  } catch (error) {
    next(error);
  }
}

export async function getBillsByUser(req, res, next) {
  try {
    const { userId } = req.params;
    const bills = await getUserBills(userId);
    res.json(bills);
  } catch (error) {
    next(error);
  }
}

export async function serveImage(req, res, next) {
  try {
    const { filename } = req.params;
    const filePath = path.resolve('uploads', filename);
    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
}
