import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { aiOpsService } from '../services/api';

const card = 'bg-[#101522] border border-[#1e2638] rounded-xl';
const ms = (v) => `${Math.round(Number(v) || 0).toLocaleString()} ms`;
const usd = (v) => `$${(Number(v) || 0).toFixed(4)}`;
const pct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`;

const STATUS_STYLE = {
  ok: 'text-emerald-300 bg-emerald-500/10',
  executed: 'text-emerald-300 bg-emerald-500/10',
  proposed: 'text-indigo-300 bg-indigo-500/10',
  gave_up: 'text-amber-300 bg-amber-500/10',
  error: 'text-rose-300 bg-rose-500/10',
  failed: 'text-rose-300 bg-rose-500/10',
  cancelled: 'text-slate-300 bg-slate-500/10',
};

function Tile({ label, value, hint }) {
  return (
    <div className={`${card} p-4`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-100 mt-1">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function Status({ value }) {
  return <span className={`px-2 py-0.5 rounded-full text-[11px] ${STATUS_STYLE[value] || 'text-slate-300'}`}>{value}</span>;
}

/** Waterfall of one request: each LLM call and tool call as a bar on a shared time axis. */
function Timeline({ trace }) {
  const total = Math.max(trace.latency_ms, 1);
  return (
    <div className="space-y-1.5">
      {trace.spans.map((s, i) => {
        const duration = s.kind === 'llm' ? s.latency_ms : s.ms;
        const left = Math.min(((s.start_ms || 0) / total) * 100, 99);
        const width = Math.max((duration / total) * 100, 1);
        return (
          <div key={i} className="flex items-center gap-3 text-xs">
            <div className="w-44 shrink-0 truncate text-slate-300">
              {s.kind === 'llm' ? `LLM · ${s.prompt_tokens ?? 0}→${s.completion_tokens ?? 0} tok` : `${s.ok ? '✓' : '✗'} ${s.name}`}
            </div>
            <div className="relative flex-1 h-4 bg-[#0c101a] rounded">
              <div
                className={`absolute h-4 rounded ${s.kind === 'llm' ? 'bg-indigo-500/70' : s.ok ? 'bg-emerald-500/70' : 'bg-rose-500/70'}`}
                style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
              />
            </div>
            <div className="w-16 text-right text-slate-400">{ms(duration)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function AIOpsPage() {
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState({ status: '', order: 'recent' });
  const [traces, setTraces] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    aiOpsService.summary(days).then(setSummary).catch((e) => setError(e.message));
  }, [days]);

  useEffect(() => {
    aiOpsService.traces(filter).then(setTraces).catch((e) => setError(e.message));
  }, [filter]);

  if (error) return <div className={`${card} p-6 text-sm text-rose-300`}>{error}</div>;
  if (!summary) return <div className="text-sm text-slate-400">Loading AI metrics…</div>;

  const t = summary.totals;
  const daily = summary.daily.map((d) => ({ ...d, day: String(d.day).slice(5), p95_ms: Number(d.p95_ms) }));

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-100">AI Ops</h1>
          <p className="text-xs text-slate-400">Every AI request is traced: model, prompt version, tool calls, tokens, cost, latency.</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-[#0c101a] border border-[#222c42] rounded-lg px-3 py-1.5 text-sm text-slate-200"
        >
          {[1, 7, 30, 90].map((d) => (
            <option key={d} value={d}>
              Last {d} day{d > 1 ? 's' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Requests" value={t.requests} hint={`${t.proposals} proposed changes`} />
        <Tile label="Error rate" value={pct(t.error_rate)} hint={`${t.errors} errors · ${t.gave_up} gave up`} />
        <Tile label="p50 latency" value={ms(t.p50_ms)} />
        <Tile label="p95 latency" value={ms(t.p95_ms)} />
        <Tile label="Cost / request" value={usd(t.cost_per_request_usd)} hint={`${usd(t.cost_usd)} total`} />
        <Tile label="Avg LLM calls" value={Number(t.avg_llm_calls).toFixed(2)} hint={`${Number(t.tokens).toLocaleString()} tokens`} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className={`${card} p-4`}>
          <div className="text-sm font-semibold text-slate-200 mb-2">Requests and errors per day</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2638" />
              <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#0c101a', border: '1px solid #222c42' }} />
              <Bar dataKey="requests" fill="#6366f1" />
              <Bar dataKey="errors" fill="#f43f5e" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={`${card} p-4`}>
          <div className="text-sm font-semibold text-slate-200 mb-2">p95 latency per day</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2638" />
              <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip contentStyle={{ background: '#0c101a', border: '1px solid #222c42' }} formatter={(v) => ms(v)} />
              <Line type="monotone" dataKey="p95_ms" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className={`${card} p-4 overflow-x-auto`}>
          <div className="text-sm font-semibold text-slate-200 mb-2">Tool reliability</div>
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left py-1">Tool</th>
                <th className="text-right">Calls</th>
                <th className="text-right">Failures</th>
                <th className="text-right">Avg</th>
                <th className="text-right">p95</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {summary.tools.map((tool) => (
                <tr key={tool.name} className="border-t border-[#1e2638]">
                  <td className="py-1.5">{tool.name}</td>
                  <td className="text-right">{tool.calls}</td>
                  <td className={`text-right ${tool.failures ? 'text-amber-300' : ''}`}>{tool.failures}</td>
                  <td className="text-right">{ms(tool.avg_ms)}</td>
                  <td className="text-right">{ms(tool.p95_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={`${card} p-4 space-y-4 overflow-x-auto`}>
          <div>
            <div className="text-sm font-semibold text-slate-200 mb-2">Models and prompt versions</div>
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left py-1">Model</th>
                  <th className="text-left">Prompt</th>
                  <th className="text-right">Requests</th>
                  <th className="text-right">Errors</th>
                  <th className="text-right">p95</th>
                  <th className="text-right">Avg cost</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {summary.models.map((m) => (
                  <tr key={`${m.model}-${m.prompt_version}`} className="border-t border-[#1e2638]">
                    <td className="py-1.5">{m.model}</td>
                    <td>{m.prompt_version}</td>
                    <td className="text-right">{m.requests}</td>
                    <td className="text-right">{m.errors}</td>
                    <td className="text-right">{ms(m.p95_ms)}</td>
                    <td className="text-right">{usd(m.avg_cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-slate-400">
            Confirmation gate: <span className="text-emerald-300">{summary.actions.confirmed} confirmed</span> ·{' '}
            {summary.actions.cancelled} cancelled · {summary.actions.expired} expired ·{' '}
            <span className="text-rose-300">{summary.actions.failed} failed</span>
          </div>
        </div>
      </div>

      <div className={`${card} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-slate-200">Traces</div>
          <div className="flex gap-1.5 text-xs">
            {[
              ['Recent', { status: '', order: 'recent' }],
              ['Slowest', { status: '', order: 'slowest' }],
              ['Errors', { status: 'errors', order: 'recent' }],
            ].map(([label, f]) => (
              <button
                key={label}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-lg border ${
                  filter.status === f.status && filter.order === f.order
                    ? 'border-indigo-500 text-indigo-200 bg-indigo-500/10'
                    : 'border-[#2a3550] text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-[#1e2638]">
          {traces.map((tr) => (
            <button
              key={tr.id}
              onClick={() => aiOpsService.trace(tr.id).then(setSelected)}
              className="w-full flex items-center gap-3 py-2 text-left text-xs hover:bg-[#151c2c] px-1 rounded"
            >
              <span className="w-32 shrink-0 text-slate-500">{new Date(tr.created_at).toLocaleString()}</span>
              <span className="w-20 shrink-0 text-slate-400">{tr.kind}</span>
              <span className="w-20 shrink-0">
                <Status value={tr.status} />
              </span>
              <span className="flex-1 truncate text-slate-300">{tr.error || tr.input_preview}</span>
              <span className="w-20 text-right text-slate-400">{ms(tr.latency_ms)}</span>
            </button>
          ))}
          {traces.length === 0 && <div className="py-6 text-center text-xs text-slate-500">No traces yet.</div>}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className={`${card} w-full max-w-3xl p-5 space-y-4 max-h-[85vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-100">
                Trace <span className="font-mono text-slate-500">{selected.id.slice(0, 8)}</span> <Status value={selected.status} />
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 text-sm">
                Close
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-400">
              <div>Model: <span className="text-slate-200">{selected.model || 'n/a'}</span></div>
              <div>Prompt: <span className="text-slate-200">{selected.prompt_version || 'n/a'}</span></div>
              <div>Tokens: <span className="text-slate-200">{selected.prompt_tokens} → {selected.completion_tokens}</span></div>
              <div>Cost: <span className="text-slate-200">{usd(selected.cost_usd)}</span></div>
            </div>
            <div className="text-xs">
              <div className="text-slate-500 mb-1">Input</div>
              <div className="text-slate-200 bg-[#0c101a] rounded p-2 whitespace-pre-wrap">{selected.input_preview}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-2">Timeline ({ms(selected.latency_ms)})</div>
              <Timeline trace={selected} />
            </div>
            <div className="text-xs">
              <div className="text-slate-500 mb-1">Output</div>
              <div className="text-slate-200 bg-[#0c101a] rounded p-2 whitespace-pre-wrap">{selected.output_preview}</div>
            </div>
            {selected.error && <div className="text-xs text-rose-300 bg-rose-500/10 rounded p-2">{selected.error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
