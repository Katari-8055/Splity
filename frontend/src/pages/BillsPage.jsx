import React, { useState, useEffect, useRef } from 'react';
import { billService } from '../services/api';

export default function BillsPage() {
  const [bills, setBills] = useState([]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [ocrResult, setOcrResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadBills();
  }, []);

  async function loadBills() {
    try {
      const data = await billService.getUserBills();
      setBills(data || []);
    } catch (err) {
      console.error('Error loading bills:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleFileSelect(selectedFile) {
    if (!selectedFile) return;
    setFile(selectedFile);
    setOcrResult(null);
    setError('');
    // Show local preview before upload
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(selectedFile);
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
      // Update preview with Cloudinary URL
      if (result.imageUrl) setPreview(result.imageUrl);
      setFile(null);
      loadBills();
    } catch (err) {
      setError(err.message || 'Upload or OCR extraction failed');
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Receipts & OCR Extraction</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Upload a bill image → AI reads and extracts all items → Saved to your account
        </p>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-center space-x-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Upload + Preview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Upload Drop Zone */}
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Upload Receipt</h2>

          <form onSubmit={handleUpload} className="space-y-4">
            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#2a364f] hover:border-indigo-500/60 rounded-xl p-6 text-center cursor-pointer bg-[#0e131d]/60 transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files[0])}
              />

              {file ? (
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mx-auto">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-slate-200">{file.name}</p>
                  <p className="text-[10px] text-slate-500">{(file.size / 1024).toFixed(0)} KB • Click to change</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="w-10 h-10 rounded-full bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mx-auto">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-slate-300">Drop receipt here or click to browse</p>
                  <p className="text-[10px] text-slate-500">JPG, PNG, WEBP up to 10MB</p>
                </div>
              )}
            </div>

            {/* How it works */}
            <div className="space-y-1.5">
              {[
                { step: '1', text: 'Image uploaded to Cloudinary (secure cloud)' },
                { step: '2', text: 'Gemini AI Vision extracts all text & items' },
                { step: '3', text: 'Structured data saved to your account' }
              ].map(({ step, text }) => (
                <div key={step} className="flex items-center space-x-2.5 text-[10px] text-slate-500">
                  <span className="w-4 h-4 rounded-full bg-indigo-600/20 text-indigo-400 font-bold flex items-center justify-center flex-shrink-0">{step}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>

            <button
              type="submit"
              disabled={uploading || !file}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <span className="flex items-center justify-center space-x-2">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  <span>Uploading & Extracting...</span>
                </span>
              ) : 'Upload & Extract with AI'}
            </button>
          </form>
        </div>

        {/* Image Preview */}
        <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm flex flex-col">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Image Preview</h2>
          {preview ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-2">
              <img
                src={preview}
                alt="Receipt preview"
                className="max-h-64 rounded-lg border border-[#1e2638] object-contain w-full"
              />
              {ocrResult?.imageUrl && (
                <a
                  href={ocrResult.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  View on Cloudinary ↗
                </a>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-[#0e131d] border border-[#1e2638] flex items-center justify-center text-slate-600 mx-auto">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-xs text-slate-600">Select a file to preview</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* OCR Extraction Result */}
      {ocrResult && (
        <div className="bg-[#121722] border border-indigo-500/30 rounded-xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100">Extracted Bill Data</h3>
            <span className="text-[10px] uppercase font-bold tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded">
              AI Extracted ✓
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 bg-[#0e131d] rounded-lg border border-[#1e2638]">
              <span className="text-slate-500 block text-[11px]">Merchant</span>
              <span className="text-slate-100 font-semibold mt-0.5 block">
                {ocrResult.parsedData?.merchantName || 'Unknown'}
              </span>
            </div>
            <div className="p-3 bg-[#0e131d] rounded-lg border border-[#1e2638]">
              <span className="text-slate-500 block text-[11px]">Total Amount</span>
              <span className="text-emerald-400 font-bold text-sm mt-0.5 block font-mono">
                ${parseFloat(ocrResult.parsedData?.totalAmount || 0).toFixed(2)}
              </span>
            </div>
            <div className="p-3 bg-[#0e131d] rounded-lg border border-[#1e2638]">
              <span className="text-slate-500 block text-[11px]">Items Found</span>
              <span className="text-slate-100 font-bold mt-0.5 block">
                {ocrResult.parsedData?.items?.length || 0} items
              </span>
            </div>
          </div>

          {(ocrResult.parsedData?.items || []).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Line Items</h4>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {ocrResult.parsedData.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between items-center text-xs bg-[#0e131d] px-3.5 py-2.5 rounded-lg border border-[#1e2638]"
                  >
                    <span className="text-slate-300 truncate max-w-[200px]">{item.item_name}</span>
                    <span className="font-semibold text-slate-100 font-mono ml-2 flex-shrink-0">
                      ${parseFloat(item.price || 0).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Receipt History */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Receipt History</h2>
          <span className="text-[11px] text-slate-500">{bills.length} saved</span>
        </div>

        {loading ? (
          <div className="py-10 text-center text-xs text-slate-500">Loading receipt history...</div>
        ) : bills.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            No receipts yet. Upload your first bill above.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {bills.map((b) => (
              <div
                key={b.id}
                className="bg-[#0e131d] border border-[#1e2638] rounded-xl overflow-hidden hover:border-[#2a364f] transition-colors"
              >
                {/* Cloudinary image thumbnail */}
                {b.image_url ? (
                  <img
                    src={b.image_url}
                    alt={b.merchant_name}
                    className="w-full h-28 object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-28 bg-[#141c2b] flex items-center justify-center text-slate-600">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                    </svg>
                  </div>
                )}
                <div className="p-3 flex justify-between items-center">
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-slate-200 truncate">
                      {b.merchant_name || b.filename}
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {new Date(b.created_at || Date.now()).toLocaleDateString()}
                    </p>
                  </div>
                  <p className="text-xs font-bold text-emerald-400 font-mono flex-shrink-0 ml-2">
                    ${parseFloat(b.total_amount || 0).toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
