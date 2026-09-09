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
      setBills(data || []);
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
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Receipts & OCR Extraction</h1>
        <p className="text-xs text-slate-400 mt-0.5">Upload receipt images for instant itemization and auto-parsing</p>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-center space-x-2">
          <svg className="w-4 h-4 text-rose-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Upload Box */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-6 shadow-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Upload Receipt Image</h2>
        <form onSubmit={handleUpload} className="space-y-4">
          <div className="border border-dashed border-[#2a364f] hover:border-indigo-500/50 rounded-xl p-6 text-center bg-[#0e131d]/60 transition-colors">
            <input
              type="file"
              id="file-upload"
              accept="image/*"
              onChange={(e) => setFile(e.target.files[0])}
              className="hidden"
            />
            <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-xs font-medium text-slate-300">
                {file ? file.name : 'Click to select a receipt image (JPG, PNG)'}
              </span>
              <span className="text-[10px] text-slate-500">Supports standard invoices and thermal receipts</span>
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={uploading || !file}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              <span>{uploading ? 'Extracting Text & Items...' : 'Upload & Extract Items'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* OCR Result details */}
      {ocrResult && (
        <div className="bg-[#121722] border border-indigo-500/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-indigo-400">Extracted Breakdown</h3>
            <span className="text-[10px] uppercase font-bold tracking-wider bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded">
              OCR Complete
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="p-3 bg-[#0e131d] rounded-lg border border-[#1e2638]">
              <span className="text-slate-500 block text-[11px]">Merchant</span>
              <span className="text-slate-200 font-semibold">{ocrResult.parsedData?.merchantName || 'Unknown Merchant'}</span>
            </div>
            <div className="p-3 bg-[#0e131d] rounded-lg border border-[#1e2638]">
              <span className="text-slate-500 block text-[11px]">Total Extracted</span>
              <span className="text-emerald-400 font-bold text-sm">${parseFloat(ocrResult.parsedData?.totalAmount || 0).toFixed(2)}</span>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Line Items</h4>
            <div className="space-y-1.5">
              {(ocrResult.parsedData?.items || []).map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-xs bg-[#0e131d] px-3.5 py-2.5 rounded-lg border border-[#1e2638]">
                  <span className="text-slate-300">{item.item_name}</span>
                  <span className="font-semibold text-slate-100">${parseFloat(item.price || 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Previously Uploaded Bills */}
      <div className="bg-[#121722] border border-[#1e2638] rounded-xl p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">Receipt History</h2>
        {loading ? (
          <div className="py-8 text-center text-xs text-slate-500">Loading receipt history...</div>
        ) : bills.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">No receipts uploaded yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {bills.map((b) => (
              <div key={b.id} className="p-3.5 bg-[#0e131d] rounded-lg border border-[#1e2638] flex justify-between items-center hover:border-[#2a364f] transition-colors">
                <div>
                  <h3 className="text-xs font-semibold text-slate-200">{b.merchant_name || b.filename}</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">{new Date(b.created_at || Date.now()).toLocaleDateString()}</p>
                </div>
                <p className="text-xs font-bold text-emerald-400 font-mono">${parseFloat(b.total_amount || 0).toFixed(2)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
