import React, { useEffect, useState } from 'react';
import { receiptService } from '../services/api';

const card = 'bg-[#101522] border border-[#1e2638] rounded-xl';
const inr = (v) => (v === null || v === undefined ? '—' : `₹${Number(v).toFixed(2)}`);

const STATUS = {
  parsed: { label: 'Totals check out', style: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  needs_review: { label: 'Needs review', style: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  failed: { label: 'Could not read', style: 'text-rose-300 bg-rose-500/10 border-rose-500/30' },
};

function ReceiptImage({ receipt }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let revoke;
    receiptService
      .imageUrl(receipt)
      .then((u) => {
        revoke = u;
        setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => revoke && URL.revokeObjectURL(revoke);
  }, [receipt.id]);
  if (!url) return <div className="h-64 flex items-center justify-center text-xs text-slate-500">Loading image…</div>;
  return <img src={url} alt="Receipt" className="max-h-[28rem] w-full object-contain rounded-lg bg-black/20" />;
}

function ReceiptDetail({ receiptId, onSplit }) {
  const [receipt, setReceipt] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    setPlan(null);
    setDone('');
    setError('');
    receiptService.get(receiptId).then(setReceipt).catch((e) => setError(e.message));
  }, [receiptId]);

  if (!receipt) return <div className="text-sm text-slate-400">{error || 'Loading…'}</div>;
  const status = STATUS[receipt.status] || STATUS.failed;

  async function preview() {
    setBusy(true);
    setError('');
    try {
      setPlan(await receiptService.assign(receipt.id, instruction));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createExpense() {
    setBusy(true);
    setError('');
    try {
      await receiptService.split(receipt.id, plan.assignments);
      setDone('Expense created and friends notified.');
      onSplit();
      setReceipt(await receiptService.get(receipt.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className={`${card} p-3`}>
        <ReceiptImage receipt={receipt} />
      </div>
      <div className="space-y-4">
        <div className={`${card} p-4`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-base font-bold text-slate-100">{receipt.merchant || 'Unknown merchant'}</div>
              <div className="text-xs text-slate-400">{receipt.billDate || 'No date found'}</div>
            </div>
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${status.style}`}>{status.label}</span>
          </div>
          {receipt.issues?.length > 0 && (
            <ul className="mt-2 text-xs text-amber-300 list-disc pl-4">
              {receipt.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          <table className="mt-3 w-full text-xs text-slate-300">
            <tbody>
              {receipt.items.map((item) => (
                <tr key={item.id} className="border-t border-[#1e2638]">
                  <td className="py-1.5">{item.name}</td>
                  <td className="text-right text-slate-500">×{Number(item.quantity)}</td>
                  <td className="text-right font-mono">{inr(item.amount)}</td>
                </tr>
              ))}
              {[
                ['Tax', receipt.tax],
                ['Tip / service', receipt.tip],
                ['Discount', receipt.discount],
              ]
                .filter(([, v]) => v)
                .map(([label, v]) => (
                  <tr key={label} className="border-t border-[#1e2638] text-slate-400">
                    <td className="py-1.5" colSpan={2}>
                      {label}
                    </td>
                    <td className="text-right font-mono">{inr(v)}</td>
                  </tr>
                ))}
              <tr className="border-t border-[#2a3550] font-semibold text-slate-100">
                <td className="py-1.5" colSpan={2}>
                  Total
                </td>
                <td className="text-right font-mono">{inr(receipt.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {receipt.expenseId ? (
          <div className={`${card} p-4 text-sm text-emerald-300`}>{done || 'This receipt has already been split.'}</div>
        ) : (
          receipt.items.length > 0 && (
            <div className={`${card} p-4 space-y-3`}>
              <div className="text-sm font-semibold text-slate-200">Who had what?</div>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="e.g. I had the paneer and 2 beers, Rahul and Priya shared the pizza, everything else is shared by all of us"
                className="w-full bg-[#0c101a] border border-[#222c42] rounded-lg p-2.5 text-sm text-slate-100 placeholder-slate-500"
              />
              <button
                onClick={preview}
                disabled={busy || instruction.trim().length < 3}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm"
              >
                {busy && !plan ? 'Working…' : 'Preview split'}
              </button>

              {plan && (
                <div className="space-y-3">
                  {plan.unclear && <div className="text-xs text-amber-300">Note: {plan.unclear}</div>}
                  <table className="w-full text-xs text-slate-300">
                    <tbody>
                      {plan.items.map((i) => (
                        <tr key={i.id} className="border-t border-[#1e2638]">
                          <td className="py-1.5">{i.name}</td>
                          <td className="text-right text-slate-400">{i.people.join(', ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="rounded-lg bg-[#0c101a] p-3 text-sm">
                    <div className="text-xs text-slate-500 mb-1">Each person pays (tax and tip shared proportionally)</div>
                    {plan.shares.map((s) => (
                      <div key={s.userId} className="flex justify-between text-slate-200">
                        <span>{s.name}</span>
                        <span className="font-mono">{inr(s.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={createExpense}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold"
                  >
                    Confirm and create expense
                  </button>
                </div>
              )}
            </div>
          )
        )}
        {error && <div className="text-xs text-rose-300">{error}</div>}
      </div>
    </div>
  );
}

export default function BillsPage() {
  const [receipts, setReceipts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const load = () => receiptService.list().then(setReceipts).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const res = await receiptService.upload(file);
      await load();
      setSelected(res.receipt.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Receipts</h1>
          <p className="text-xs text-slate-400">
            Gemini Vision reads the receipt, totals are checked automatically, and you split it item by item.
          </p>
        </div>
        <label className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm cursor-pointer">
          {uploading ? 'Reading receipt…' : 'Upload receipt'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={upload} disabled={uploading} />
        </label>
      </div>
      {error && <div className="text-sm text-rose-300">{error}</div>}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {receipts.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className={`shrink-0 text-left px-3 py-2 rounded-lg border text-xs ${
              selected === r.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-[#1e2638] bg-[#101522]'
            }`}
          >
            <div className="text-slate-200 font-medium">{r.merchant || 'Receipt'}</div>
            <div className="text-slate-500">
              {inr(r.total)} · {(STATUS[r.status] || STATUS.failed).label}
            </div>
          </button>
        ))}
        {receipts.length === 0 && <div className="text-xs text-slate-500">No receipts yet. Upload a photo to start.</div>}
      </div>

      {selected && <ReceiptDetail receiptId={selected} onSplit={load} />}
    </div>
  );
}
