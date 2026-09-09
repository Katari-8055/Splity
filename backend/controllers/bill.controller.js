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
 * 1. Upload image to Cloudinary
 * 2. Use Gemini Vision to extract text from the Cloudinary URL
 * 3. Parse extracted text into structured data
 * 4. Save bill + items to DB for the user
 */
export async function uploadOCR(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const userId = req.user?.userId || req.headers['x-user-id'] || req.body.userId || 'demo-user-id';

    // Step 1: Run Gemini Vision OCR directly on the uploaded file buffer
    console.log(`[Bills] Running Gemini Vision OCR on ${req.file.originalname} for user ${userId}...`);
    const rawText = await extractReceiptWithGeminiVision(req.file.buffer, req.file.mimetype);
    console.log(`[Bills] OCR complete. Extracted ${rawText?.length || 0} characters.`);

    // Step 2: Parse structured data (merchant, total, items)
    const parsedData = await parseBillText(rawText);
    console.log(`[Bills] Parsed: ${parsedData.merchantName}, $${parsedData.totalAmount}, ${parsedData.items?.length || 0} items`);

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
        console.log(`[Bills] Uploading ${req.file.originalname} to Cloudinary...`);
        const cloudinaryResult = await uploadBillToCloudinary(
          req.file.buffer,
          req.file.originalname
        );
        imageUrl = cloudinaryResult.url;
        publicId = cloudinaryResult.publicId;
        console.log(`[Bills] Cloudinary upload success: ${imageUrl}`);
      } catch (cldErr) {
        console.warn('[Bills] Cloudinary upload warning (falling back to local):', cldErr.message);
      }
    }

    // If Cloudinary wasn't configured or failed, save locally in backend/uploads/bills/
    if (!imageUrl) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const uploadDir = path.resolve(process.cwd(), 'uploads', 'bills');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const ext = path.extname(req.file.originalname) || '.jpg';
        const filename = `bill_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, req.file.buffer);
        imageUrl = `/uploads/bills/${filename}`;
      } catch (localErr) {
        console.warn('[Bills] Local file save warning:', localErr.message);
        // Fallback to data URI so the preview works in frontend
        imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      }
    }

    // Step 4: Save to DB
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
    res.status(500).json({ error: error.message || 'Bill upload and OCR failed' });
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
    const userId = req.params.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }
    const bills = await getUserBills(userId);
    res.json(bills);
  } catch (error) {
    next(error);
  }
}
