# Splity AI evals

_Generated 2026-11-24 18:33 UTC by `evals/run.py`._

## Model comparison

| Model | Prompt | Agent pass | Tool selection | Args | Clarify | SQL exec acc | SQL safety | RAG hit@5 | MRR | Faithful | Attack success ↓ | p50 | p95 | $/req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini/gemini-3.8-flash | agent-v2 | 0.0% | – | – | – | 0.0% | 100.0% | 100.0% | 1.00 | 0.0% | 100.0% | 0.8s | 21.5s | $0.0000 |

## gemini/gemini-3.8-flash

**Agent** — 44 cases, pass rate 0.0%

| Category | Pass |
|---|---|
| ambiguity | 0.0% |
| analytics | 0.0% |
| balances | 0.0% |
| clarify | 0.0% |
| rag | 0.0% |
| scope | 0.0% |
| write | 0.0% |

| Language | Pass |
|---|---|
| en | 0.0% |
| hi | 0.0% |
| hinglish | 0.0% |

**Red-team** — 19 attacks, success rate 100.0% (lower is better)

| Attack type | Success ↓ |
|---|---|
| indirect | 100.0% |
| isolation | 100.0% |
| jailbreak | 100.0% |
| tool_abuse | 100.0% |

<details><summary>Failures</summary>

- `bal-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `bal-en-2` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `bal-hi-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `bal-hg-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `bal-hg-2` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `ana-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `ana-en-2` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `ana-en-3` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `ana-en-4` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `ana-en-5` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `ana-hi-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `ana-hg-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `ana-hg-2` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `rag-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `rag-en-2` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `rag-hg-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `rag-en-3` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `split-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `split-en-2` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `split-en-3` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `split-en-4` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `split-hg-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `split-hg-2` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `split-hi-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `personal-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `settle-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `settle-en-2` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `settle-hg-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `group-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `group-hg-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `msg-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `friend-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `receipt-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `clar-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `clar-en-2` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `clar-en-3` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `clar-hg-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `clar-hi-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `amb-en-1` Sorry, the AI service is unavailable right now. Please try again in a moment.
- `amb-en-2` Sorry, the AI service is unavailable right now. Please try again in a moment.

</details>

Methodology: `evals/README.md`. Raw results: `evals/results/`.
