# 11. Final Revision Section

## 11.1 Architecture summary (one page)

```
React 19 (Vite :3000, proxy /api -> :5000)
  Chat(SSE) | Bills(OCR) | AI Ops | Expenses | Groups | Friends | Dashboard
        |
FastAPI (app/main.py) -- CORS -- error handlers {"error"} -- routers /api/*
        |
  services/* (splitting, ledger, expenses, groups, friends, users, receipts, analytics, notifications)
        ^                 ^                                   ^
  REST routes      AI agent tools (17)                   MCP server (stdio)
                   LangGraph: llm -> tools -> llm ... (max 6) -> give_up
                   pending actions (TTL 10m, owner, single use, atomic claim)
                   guardrails (wrap, detect, taint, output guard)
                   text-to-SQL (sqlglot + splity_analyst + views + READ ONLY + 3s)
                   hybrid RAG (pgvector HNSW + tsvector GIN + RRF k=60 + LLM rerank)
                   OCR (Gemini Vision JSON + arithmetic check) | voice | categorize
                   LiteLLM (gemini-3.8-flash -> 3.7 -> 3.6; embeddings 768d)
                   tracing (ai_traces spans, p50/p95, cost) + Langfuse OTel
        |
PostgreSQL 16 + pgvector (Docker)   17 tables + 4 analytics views + splity_analyst role
```

## 11.2 Technology comparison tables

| Need | Chosen | Alternatives | One-line reason |
|---|---|---|---|
| API framework | FastAPI | Flask, Django, Express | async + Pydantic + DI |
| DB | Postgres | MySQL, MongoDB | relational money + vector + FTS in one |
| Vector store | pgvector | Pinecone, Qdrant, Chroma | SQL access control, one DB |
| Keyword search | Postgres FTS | Elasticsearch | no extra service |
| LLM gateway | LiteLLM | provider SDK | model-agnostic + fallback + cost |
| Agent framework | LangGraph | hand loop, CrewAI | explicit graph, limits, streaming |
| SQL safety | sqlglot | regex | real AST |
| Observability | own table + Langfuse | only Langfuse/LangSmith | offline + in-app dashboard |
| Streaming | SSE (fetch) | WebSocket, EventSource | one-way, POST + auth header |
| Passwords | bcrypt | SHA-256, Argon2 | slow + salted (Argon2 = future) |
| Tests | pytest + ScriptedLLM + Hypothesis | real LLM tests | deterministic |
| Package mgmt | uv | pip/poetry | fast, lockfile |
| Frontend build | Vite | CRA, webpack | fast dev server |

## 11.3 Important functions cheat sheet

| Function | File | One line |
|---|---|---|
| `create_app` | main.py | builds app, routers, CORS, Langfuse, indexing |
| `get_current_user` | api/deps.py | JWT -> User |
| `hash_password` / `verify_password` | core/security.py | bcrypt; no hash -> False |
| `authenticate` | services/users.py | timing-equalised login |
| `to_cents` / `equal_split` / `percentage_split` / `custom_split` | services/splitting.py | exact paise maths |
| `compute_shares` / `create_expense` | services/expenses.py | split + validate + save + notify + index |
| `balances_for` / `pair_balance` / `settle` | services/ledger.py | single ledger formula, advisory lock |
| `allocate` / `split_receipt` | services/receipts.py | item split maths, receipt -> expense |
| `run_turn` | ai/agent.py | one chat turn, yields events |
| `llm_node` / `tools_node` / `give_up_node` | ai/agent.py | graph nodes |
| `resolve_person` / `resolve_group` | ai/tools.py | names -> users/groups |
| `run_read` / `prepare_write` / `execute_write` | ai/tools.py | tool execution phases |
| `openai_tools` / `_inline` | ai/tools.py | tool schemas for the LLM |
| `create_pending_action` / `_claim` / `confirm_action` | ai/store.py | HITL gate |
| `wrap_tool_result` / `guard_output` / `clean_user_input` | ai/guardrails.py | injection defense |
| `build_system_prompt` | ai/prompts.py | prompt v2 with sanitised names |
| `validate_sql` / `run_readonly` / `answer_question` | ai/sql_agent.py | text-to-SQL |
| `schedule_index` / `search` / `rrf` / `_rerank` | ai/rag.py | hybrid RAG |
| `read_receipt` / `check_arithmetic` / `sniff_image` | ai/ocr.py | OCR |
| `assign_items` | ai/receipt_assign.py | who had what |
| `transcribe` / `sniff_audio` | ai/voice.py | voice |
| `categorize` | ai/categorize.py | category with fallback |
| `record` / `build_spans` / `configure_langfuse` | ai/tracing.py | traces |
| `summary` / `list_traces` | ai/ops.py | AI Ops metrics |
| `build_server` | mcp_server.py | MCP server |
| `score_agent_case` / `rows_equal` | evals/scoring.py | eval scoring |

## 11.4 API cheat sheet (most asked)

- `POST /api/ai/chat` - SSE events: conversation, token, tool_start, tool_end, guardrail, confirmation, done, error.
- `POST /api/ai/actions/{id}/confirm` / `cancel`, `GET /api/ai/actions`.
- `POST /api/receipts` -> `POST /api/receipts/{id}/assign` -> `POST /api/receipts/{id}/split`.
- `POST /api/ai/transcribe`, `POST /api/ai/categorize`.
- `GET /api/ai/ops/summary|traces|traces/{id}`, `POST /api/ai/ops/reindex` (admin).
- `POST /api/expenses/create`, `GET /api/expenses/balances`, `POST /api/expenses/settle`.

## 11.5 Database revision notes

- Money `NUMERIC(12,2)`, computed in paise. CHECK constraints everywhere money exists.
- Payer included in `expense_splits` -> my spending = SUM(my splits).
- Settlements separate. Friendships both directions.
- `ai_messages` OpenAI format (tool_calls JSONB, tool_call_id TEXT).
- `ai_pending_actions` status machine. `ai_traces` spans JSONB.
- `documents`: vector(768) HNSW cosine + generated tsvector GIN; owner CHECK.
- `analytics` schema views filtered by `current_setting('app.user_id', true)`; role `splity_analyst`.
- Migrations 0001-0005; 0004 = tool_call_id TEXT fix.

## 11.6 Important technical concepts (glossary)

| Term | Meaning |
|---|---|
| Agent | LLM + tools + loop |
| Tool calling | model outputs structured function call |
| HITL | human approves actions |
| Pending action | stored proposal awaiting confirm |
| TOCTOU | data changes between check and use (settle re-check) |
| Prompt injection (direct/indirect) | malicious instructions from user / from data |
| Taint | marking context as influenced by untrusted data |
| Exfiltration | leaking data out (e.g. via image URL) |
| Text-to-SQL | NL -> SQL |
| AST | parsed tree of code/SQL |
| Defense in depth | multiple independent safety layers |
| Embedding | text -> vector |
| Cosine similarity | angle-based similarity |
| HNSW | graph-based approximate nearest neighbour index |
| Full-text search | token-based keyword search (tsvector/tsquery) |
| RRF | sum of 1/(k + rank) fusion |
| Rerank | reorder candidates by relevance with a stronger model |
| hit@k / MRR | retrieval metrics: found in top k / 1 over first correct rank |
| Faithfulness | answer supported by context |
| Execution accuracy | generated SQL result == gold result |
| Attack success rate | share of red-team attacks that worked |
| p50 / p95 | median / 95th percentile latency |
| Span / trace | one step / whole request timeline |
| SSE | server -> client event stream over HTTP |
| Advisory lock | app-defined Postgres lock |
| Largest remainder | rounding that keeps totals exact |
| Property-based test | random inputs, invariant checks |
| Few-shot | examples in prompt |
| Fallback model | backup model on failure |
| MCP | standard protocol for AI tools |

## 11.7 Top 100 interview questions (short answers)

1. **What is Splity?** - Expense-sharing app with an AI agent as main interface.
2. **Main stack?** - React, FastAPI, Postgres+pgvector, LangGraph, LiteLLM/Gemini, MCP, Langfuse, sqlglot.
3. **Why rewrite backend in Python?** - AI ecosystem + fix legacy security/correctness issues.
4. **How many tools?** - 17 (11 read, 6 write).
5. **Read vs write tools difference?** - Reads run immediately; writes create pending actions.
6. **How is identity passed to tools?** - `ToolContext.user` from JWT, never an argument.
7. **Why names instead of IDs?** - Prevent hallucinated IDs and IDOR.
8. **Ambiguous name handling?** - ToolError asks model to ask the user.
9. **What is a pending action?** - Server-stored proposal: owner, args, summary, status, expiry.
10. **TTL?** - 10 minutes (`pending_action_ttl_minutes`).
11. **How is double confirm prevented?** - Conditional UPDATE ... RETURNING claim.
12. **Can the model confirm?** - No confirm tool; only UI endpoint.
13. **What happens after a proposal in the same turn?** - Model gets no tools.
14. **Max agent steps?** - 6, then give_up node.
15. **Agent framework?** - LangGraph StateGraph.
16. **State fields?** - messages, steps, pending, tool_log, usage, tainted.
17. **How are events streamed?** - LangGraph stream writer -> SSE.
18. **Why SSE?** - Simple one-way streaming over HTTP.
19. **Why not EventSource?** - Needs POST and Authorization header.
20. **What is in the done event?** - message, conversationId, traceId, tools, usage, promptVersion.
21. **System prompt version?** - agent-v2, stored in traces.
22. **How are user-written names safe in prompt?** - `_clean` strips newline/<>/backticks + data rule.
23. **LLM provider?** - Gemini via LiteLLM.
24. **Fallback models?** - gemini-3.7-flash, gemini-3.6-flash.
25. **When is fallback not used?** - After output started streaming, or when a model was explicitly chosen.
26. **drop_params?** - Removes unsupported params per model.
27. **Retries/timeouts?** - 1 retry, 30 s.
28. **Cost tracking?** - `litellm.completion_cost` per call, summed in traces.
29. **Test double?** - ScriptedLLM.
30. **Why Protocol for LLMClient?** - Swap real/fake without inheritance.
31. **What is text-to-SQL used for?** - Open numeric/trend questions.
32. **SQL safety layers?** - sqlglot, views, read-only role, read-only tx + timeout + LIMIT.
33. **Allowed tables?** - 4 analytics views.
34. **How do views know the user?** - `app.user_id` set per transaction.
35. **Why a separate connection in run_readonly?** - Role/settings never leak to other queries.
36. **Row limit?** - 200 (tool returns 50).
37. **Few-shot source?** - `sql_examples` by embedding similarity, fallback 12 static.
38. **Retry logic?** - Error text fed back, max 2 attempts.
39. **cannot_answer?** - Model flags unanswerable question.
40. **Bug found in validator?** - AND/NOT/LIKE treated as functions.
41. **What is RAG?** - Retrieve relevant data, then generate grounded answer.
42. **What is hybrid RAG here?** - pgvector + Postgres FTS fused by RRF, then LLM rerank.
43. **Embedding model/dim?** - gemini-embedding-001, 768.
44. **Vector index?** - HNSW cosine.
45. **FTS config?** - `simple`, `websearch_to_tsquery`, `ts_rank_cd`.
46. **RRF k?** - 60.
47. **Top k?** - 6 (pool max(24, 20)).
48. **Access control?** - SQL WHERE on user_id or member group_id.
49. **What gets indexed?** - Expenses (per participant), group messages, receipts.
50. **When indexing happens?** - Background task after commit.
51. **Embedding failure?** - Text-only doc; vector search skipped.
52. **Citations?** - `[type:id8]`.
53. **Why not RAG for totals?** - Retrieval can't sum rows; use SQL.
54. **OCR model?** - Gemini Vision via JSON schema.
55. **OCR validation?** - Pydantic + arithmetic check (Rs 1 tolerance).
56. **Receipt statuses?** - parsed, needs_review, failed.
57. **Upload checks?** - Magic bytes, 8 MB, random filename.
58. **Item split maths?** - Equal per item + proportional tax/tip + largest remainder.
59. **Why math.floor?** - Correct floor for negative adjustments.
60. **Voice flow?** - MediaRecorder -> /ai/transcribe -> input box.
61. **Why not auto-send voice?** - User verifies transcript.
62. **Read aloud?** - Browser speechSynthesis.
63. **Categorisation fallback?** - Other/General, confidence 0.
64. **Untrusted tools?** - search_documents, get_group, list_expenses, list_receipts, ask_analytics (+ get_receipt name).
65. **Injection detection?** - NFKC + regex (English + Hinglish).
66. **Taint effect?** - Confirmation card warning.
67. **Output guard?** - Removes images, redacts unknown emails.
68. **Frontend defense?** - No images/links rendered in markdown.
69. **Why HITL is the real boundary?** - Detection can fail; humans approve writes.
70. **What is traced?** - Model, prompt version, spans, tokens, cost, latency, status, error.
71. **Trace kinds?** - chat, categorize, action.
72. **Trace statuses?** - ok, proposed, gave_up, error, executed, failed.
73. **p50/p95 how?** - `percentile_cont` in SQL.
74. **Who sees AI Ops?** - `ADMIN_EMAILS` users.
75. **Langfuse integration?** - LiteLLM `langfuse_otel` callback.
76. **Why record never raises?** - Observability must not break requests.
77. **MCP auth?** - SPLITY_ACCESS_TOKEN JWT.
78. **MCP writes?** - Pending actions approved in app.
79. **Eval suites?** - agent, sql, rag, redteam.
80. **Eval case counts?** - 44, 14+6, 10, 19 (93 total).
81. **Agent eval checks?** - tool selection, args, clarification, no_write, content, no_leak.
82. **SQL metric?** - Execution accuracy by result-set comparison.
83. **RAG metrics?** - hit@5, MRR, keywords, faithfulness, isolation.
84. **Red-team metric?** - Attack success rate.
85. **Provider errors in evals?** - Excluded and counted separately.
86. **Final eval numbers?** - Not available yet (quota) - say honestly.
87. **Tests count?** - 93 passing.
88. **Property test?** - Splits always sum to total (Hypothesis).
89. **Money representation?** - Decimal / integer paise.
90. **Equal split remainder?** - Extra paise to first participants (payer first).
91. **Percentage split?** - Must sum 100; largest remainder.
92. **Ledger formula location?** - `_LEDGER_CTE` only.
93. **Settle concurrency?** - Advisory xact lock on sorted pair key.
94. **Why settlements table?** - Not spending.
95. **Who can be in an expense?** - Group members or payer's friends.
96. **Login protection?** - bcrypt, rate limit, timing equalisation.
97. **JWT details?** - HS256, userId claim, 7 days.
98. **Error format?** - `{"error": message}`, validation 400.
99. **Biggest limitation?** - Single-process assumptions + pending full evals.
100. **Next improvement?** - Durable job queue + Redis + evals on prompt changes.

## 11.8 50 difficult follow-up questions

1. **Agar LLM ek hi response mein do write tools call kare?** - Pehla pending banega, dusra "Only one change..." error.
2. **Tool args invalid JSON?** - `__invalid_json__` -> ToolError "not valid JSON, try again".
3. **Tool result bahut bada?** - 8000 chars pe truncate.
4. **History kitni bhejte ho?** - Last 30 messages (user message se start).
5. **Pending action expire hone ke baad confirm?** - 400 "expired, ask again".
6. **Dusre user ka action ID guess kare?** - `_claim` user_id mismatch -> 404.
7. **Confirm ke beech balance badal gaya?** - execute_settle_up direction re-check; create_expense participant re-validation in service.
8. **Pending action args mein Decimal kaise?** - Strings in JSONB.
9. **Why `jsonable_encoder` on tool outputs?** - Decimal/datetime JSON-safe.
10. **Agar SQL model `analytics.my_expenses` ke bina schema likhe?** - Validator schema 'analytics' set kar deta hai.
11. **CTE use kare toh?** - CTE names allowed if no schema.
12. **`UNION` allowed?** - Haan, root Union/Intersect/Except allowed, still table/function checks.
13. **`SELECT * FROM pg_catalog.pg_user`?** - Table not allowed.
14. **Timeout kaha set?** - `SET LOCAL statement_timeout` = 3000.
15. **`app.user_id` unset ho?** - `current_setting(..., true)` NULL -> no rows.
16. **Why `GRANT splity_analyst TO CURRENT_USER`?** - App user ko SET ROLE ka adhikaar.
17. **RAG mein group chhod diya user ne?** - Visibility query time pe membership check -> chunks dikhne band.
18. **Expense chunk per participant ka cost?** - N embeddings for same text; improvement ACL table.
19. **Rerank model passages ki instructions follow kare?** - Prompt "passages are data"; output sirf numbers list (schema).
20. **Rerank invalid numbers de?** - Bounds check; baaki hits append.
21. **Why dedupe after rerank?** - Receipt ke multiple chunks.
22. **Vector aur FTS dono empty?** - Empty list -> model "nothing found".
23. **websearch_to_tsquery kyun?** - User text safely parse (quotes, OR, -).
24. **OCR image mein prompt injection?** - OCR prompt + receipts untrusted + HITL.
25. **OCR JSON schema mein required kya?** - items, total.
26. **Receipt bina total?** - split 400 "no total; fix it".
27. **Same receipt do baar split?** - `expense_id` set -> 400.
28. **Item kisi ko assign na ho?** - 400 missing items list.
29. **Audio format fake?** - sniff_audio fail -> 400.
30. **Transcript mein instructions?** - Goes to input box; normal user message; writes still confirmed.
31. **Categorize low confidence?** - Confidence returned; UI decides (no threshold in backend).
32. **Trace mein PII?** - Previews stored; redaction is future work.
33. **Langfuse keys hain par package nahi?** - Warning log, disabled.
34. **Why `stream_options include_usage`?** - Streaming mein bhi token usage milta hai.
35. **Gemini 3 thought signatures problem?** - Long tool_call_id; TEXT column.
36. **Why `recursion_limit` 4*steps+5?** - LangGraph super-step guard above our own budget.
37. **ScriptedLLM `tools_seen` kis liye?** - Test verify kare ki proposal ke baad tools nahi diye.
38. **MCP handler signature kyun banaya?** - SDK function signature se input schema banata hai.
39. **MCP pending actions conversation?** - conversation_id None; app `/ai/actions` mein dikhte hain.
40. **CORS credentials true kyun?** - Settings origins list; Bearer header use hota hai (cookies nahi).
41. **Validation 400 vs 422?** - Legacy client compatibility.
42. **N+1 in expense list?** - json_agg subquery.
43. **Message seq race?** - Possible under concurrent turns; fix with unique constraint/sequence.
44. **Background task crash?** - Logged; lost; reindex endpoint recovers.
45. **Rate limiter multi-worker?** - Not shared; Redis needed.
46. **Upload storage scaling?** - Local disk; S3 + signed URLs future.
47. **Why not stream SQL results?** - Small (LIMIT) results; not needed.
48. **Why temperature 0 for JSON?** - Deterministic structured outputs.
49. **Eval explicit model fallback off kyun?** - Model comparison honest rahe.
50. **Agar interviewer bole "this is just a wrapper"?** - Point to server-side resolution, HITL state machine, SQL sandbox, retrieval ACL, maths invariants, tracing, evals - none come from the LLM.

## 11.9 Common mistakes to avoid in interviews

- Final eval percentages invent mat karna. "Harness ready, full run quota se pending" bolo.
- "Production users" ya "deployed" claim mat karna - repo mein deployment nahi hai.
- Parent/child monitoring ko naye backend ka feature mat batana.
- "Regex guardrail se injection solve" mat bolna - layered defense + HITL bolo.
- "pgvector exact search" mat bolna - HNSW approximate hai.
- RAG aur text-to-SQL ka role mix mat karna (totals = SQL, lookup = RAG).
- "LLM writes to DB" kabhi mat bolna - model proposes, server executes after confirm.
- Numbers yaad rakho: 17 tools, 6 steps, 10 min TTL, 30 AI req/min, 768 dims, k=60, top 6, 200 rows, 3 s timeout, 93 tests, 93 eval cases, 19 red-team, 4 production issues.

## 11.10 Last-minute revision notes

1. **Pitch:** AI expense assistant; safe, correct, measurable, observable.
2. **Safety core:** names not IDs + pending actions + no confirm tool + server-stored args.
3. **SQL core:** views + role + sqlglot + read-only + timeout.
4. **RAG core:** vector + FTS + RRF + rerank + ACL in SQL + citations.
5. **Money core:** paise, largest remainder, one ledger, advisory lock.
6. **Quality core:** ScriptedLLM tests (93 pass), eval harness (4 suites), traces (p50/p95, cost), Langfuse.
7. **Stories:** tool_call_id TEXT, model retire/temperature, 503 fallback, AND bug via evals, 429 scoring fix.
8. **Honest gaps:** eval numbers pending, AI module tests, single-process infra, localStorage JWT, parent features not ported.
