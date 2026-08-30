import { Router } from 'express';
import { uploadOCR, getBill, getBillsByUser, serveImage } from '../controllers/bill.controller.js';
import { upload } from '../middlewares/upload.middleware.js';
import { optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/ocr/upload', upload.single('receipt'), optionalAuth, uploadOCR);
router.get('/bills/:billId', optionalAuth, getBill);
router.get('/bills/user/:userId', optionalAuth, getBillsByUser);
router.get('/images/:filename', serveImage);

export default router;
