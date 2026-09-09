import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Upload a file buffer directly to Cloudinary
 * Returns the secure URL and public_id
 */
export async function uploadToCloudinary(fileBuffer, originalname) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'splity/bills',
        resource_type: 'image',
        transformation: [
          { quality: 'auto', fetch_format: 'auto' }
        ]
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
          format: result.format,
          bytes: result.bytes
        });
      }
    );
    uploadStream.end(fileBuffer);
  });
}

/**
 * Delete an image from Cloudinary by public_id
 */
export async function deleteFromCloudinary(publicId) {
  return cloudinary.uploader.destroy(publicId);
}

export default cloudinary;
