import {
  uploadBillToCloudinary,
  extractReceiptWithGeminiVision,
  parseBillText,
  createBillRecord,
  getBillById,
  getUserBills
} from '../services/billService.js';

/**
 * POST /api/bills/ocr/upload
 * 1. Upload image to Cloudinary (or local fallback)
 * 2. Use Gemini Vision to extract text
 * 3. Parse structured data (merchant, total, items)
 * 4. Save bill + items to DB for the authenticated user
 */
export async function uploadOCR(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    // Step 1: Run Gemini Vision OCR directly on the uploaded file buffer
    console.log(`[Bills] Running Gemini Vision OCR on ${req.file.originalname} for user ${userId}...`);
    const rawText = await extractReceiptWithGeminiVision(req.file.buffer, req.file.mimetype);
    console.log(`[Bills] OCR complete. Extracted ${rawText?.length || 0} characters.`);

    // Step 2: Parse structured data (merchant, total, items)
    const parsedData = await parseBillText(rawText);

    // Step 3: Handle Cloudinary storage (with graceful local fallback)
    let imageUrl = null;
    let publicId = null;

    const isCloudinaryConfigured = 
      process.env.CLOUDINARY_CLOUD_NAME && 
      process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloud_name_here' &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_KEY !== 'your_api_key_here';

    if (isCloudinaryConfigured) {
      try {
        const cloudinaryResult = await uploadBillToCloudinary(
          req.file.buffer,
          req.file.originalname
        );
        imageUrl = cloudinaryResult.url;
        publicId = cloudinaryResult.publicId;
      } catch (cldErr) {
        console.warn('[Bills] Cloudinary upload warning (falling back to local):', cldErr.message);
      }
    }

    if (!imageUrl) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const uploadDir = path.resolve(currentDir, '..', 'uploads', 'bills');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const ext = path.extname(req.file.originalname) || '.jpg';
        const filename = `bill_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, req.file.buffer);
        imageUrl = `/uploads/bills/${filename}`;
      } catch (localErr) {
        imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      }
    }

    // Step 4: Save to DB for authenticated user
    const bill = await createBillRecord(
      userId,
      req.file.originalname,
      rawText,
      parsedData,
      imageUrl,
      publicId
    );

    res.json({
      success: true,
      rawText,
      parsedData,
      bill,
      imageUrl
    });
  } catch (error) {
    console.error('[Bills] Upload OCR error:', error);
    res.status(500).json({ error: 'Bill upload and OCR failed' });
  }
}

export async function getBill(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { billId } = req.params;
    const bill = await getBillById(billId);
    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    // IDOR protection: Verify ownership
    if (bill.user_id && bill.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden. You do not have permission to view this receipt.' });
    }

    res.json(bill);
  } catch (error) {
    next(error);
  }
}

export async function getBillsByUser(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Always fetch bills for the authenticated user only
    const bills = await getUserBills(userId);
    res.json(bills);
  } catch (error) {
    next(error);
  }
}
