import React, { useState, useEffect } from 'react';
import { billService } from '../services/api';

export default function BillsPage() {
  const [bills, setBills] = useState([]);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [ocrResult, setOcrResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const userId = localStorage.getItem('userId') || 'demo-user-id';

  useEffect(() => {
    loadBills();
  }, []);

  async function loadBills() {
    try {
      const data = await billService.getUserBills(userId);
      setBills(data);
    } catch (err) {
      console.error('Error loading bills:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setError('');
    setOcrResult(null);

    try {
      const result = await billService.uploadOCR(file);
      setOcrResult(result);
      setFile(null);
      loadBills();
    } catch (err) {
      setError(err.message || 'OCR Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Receipts & Bill Upload</h1>
        <p className="text-gray-400 text-sm mt-1">Upload bill images for AI-powered OCR itemization</p>
      </div>

      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Upload card */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-white mb-3">Upload Receipt / Bill Image</h2>
        <form onSubmit={handleUpload} className="space-y-4">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files[0])}
            className="block w-full text-xs text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
          />
          <button
            type="submit"
            disabled={uploading || !file}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {uploading ? 'Processing OCR...' : 'Upload & Extract Items'}
          </button>
        </form>
      </div>

      {/* OCR Result details */}
      {ocrResult && (
        <div className="bg-gray-800 border border-blue-500/50 rounded-xl p-6 space-y-3">
          <h3 className="text-md font-semibold text-blue-400">OCR Extraction Result</h3>
          <p className="text-xs text-gray-300"><strong>Merchant:</strong> {ocrResult.parsedData?.merchantName}</p>
          <p className="text-xs text-gray-300"><strong>Total Amount:</strong> ${ocrResult.parsedData?.totalAmount}</p>

          <div className="mt-2">
            <h4 className="text-xs font-semibold text-gray-400 mb-1">Parsed Items:</h4>
            <div className="space-y-1">
              {(ocrResult.parsedData?.items || []).map((item, idx) => (
                <div key={idx} className="flex justify-between text-xs bg-gray-900 p-2 rounded text-gray-300">
                  <span>{item.item_name}</span>
                  <span className="font-bold">${item.price}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Previously Uploaded Bills */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Uploaded Bills History</h2>
        {loading ? (
          <p className="text-gray-400 text-sm">Loading bills...</p>
        ) : bills.length === 0 ? (
          <p className="text-gray-400 text-sm">No uploaded bills found.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bills.map((b) => (
              <div key={b.id} className="p-4 bg-gray-700/40 rounded-lg border border-gray-700 flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-semibold text-white">{b.merchant_name || b.filename}</h3>
                  <p className="text-xs text-gray-400">Date: {new Date(b.created_at || Date.now()).toLocaleDateString()}</p>
                </div>
                <p className="text-sm font-bold text-green-400">${parseFloat(b.total_amount || 0).toFixed(2)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
