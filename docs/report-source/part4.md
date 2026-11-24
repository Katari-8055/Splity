# 6. Architecture and Design Decisions

## 6.1 Sequence diagram: chat with a write (confirm flow)

```
User        React(ChatPage)     FastAPI /ai/chat     agent(LangGraph)     Gemini(LiteLLM)    Postgres
 |  type msg    |                      |                    |                    |               |
 |------------->| POST (SSE)           |                    |                    |               |
 |              |--------------------->| rate limit, auth   |                    |               |
 |              |                      |--run_turn--------->| load history ------------------------>|
 |              |                      |                    |--stream(tools)---->|               |
 |              |<--token events-------|<--custom events----|<--tool_call--------|               |
 |              |                      |                    | prepare_write (resolve names) ------>|
 |              |                      |                    | create_pending_action -------------->|
 |              |<--confirmation-------|<-------------------|--stream(no tools)->|               |
 |              |<--done (traceId)-----|  guard_output, trace record ------------------------------>|
 | click Confirm|                      |                    |                    |               |
 |------------->| POST /ai/actions/{id}/confirm             |                    |               |
 |              |--------------------->| _claim (atomic UPDATE ... RETURNING) ----------------------->|
 |              |                      | execute_write -> services.create_expense ------------------>|
 |              |<--{status: executed}-| trace (kind=action) ---------------------------------------->|
```

## 6.2 Data-flow: text-to-SQL

```
question --> similar_examples (embed -> sql_examples cosine) --> prompt (schema doc + rules + shots)
        --> Gemini JSON {sql} --> validate_sql (sqlglot AST checks, force LIMIT)
        --> run_readonly [READ ONLY tx | ROLE splity_analyst | app.user_id | timeout 3s]
        --> analytics.* views (filtered by app.user_id) --> rows --> agent --> answer
        (on error: error text back to model, 1 retry)
```

## 6.3 Data-flow: hybrid RAG

```
write (expense / message / receipt) --commit--> schedule_index (background task, own session)
   --> build chunk text --> embed (Gemini, 768d, normalised) --> documents (embedding + generated tsv)

query --> [full-text: websearch_to_tsquery + ts_rank_cd]  \
      --> [vector: embed query, <=> cosine via HNSW]       } both with visibility WHERE
      --> RRF (k=60) --> top 2k --> LLM rerank --> dedupe by source --> top 6 with citations
```

## 6.4 ER diagram (main tables)

```
users (id PK, name, email UQ, phone, password_hash, role[user|parent], created_at)
  |1---*  friendships (user_id PK/FK, friend_id PK/FK)        -- stored both directions
  |1---*  group_members (group_id PK/FK, user_id PK/FK) *---1 groups (id, name, created_by FK)
  |                                                              |1---* group_messages (id, group_id, user_id, message)
  |1---*  expenses (id, paid_by FK, group_id FK null, amount>0, category, subcategory,
  |                 description, split_type[equal|percentage|custom|personal], created_at)
  |              |1---* expense_splits (expense_id PK/FK CASCADE, user_id PK/FK, amount>=0)
  |1---*  settlements (id, payer_id FK, payee_id FK, amount>0, group_id, note, recorded_by)
  |1---*  notifications (id, user_id, type, message, data JSONB, is_read)
  |1---*  ai_conversations (id, user_id, title) 1---* ai_messages (id, conversation_id, seq,
  |                 role[user|assistant|tool], content, tool_calls JSONB, tool_call_id TEXT)
  |1---*  ai_pending_actions (id, user_id, conversation_id, tool, args JSONB, summary,
  |                 status[pending|executing|executed|cancelled|failed], result, error, expires_at)
  |1---*  ai_traces (id, user_id SET NULL, kind, status, model, prompt_version, tokens, cost_usd,
  |                 latency_ms, spans JSONB, error)
  |1---*  receipts (id, user_id, storage_path, mime_type, status[parsed|needs_review|failed],
  |                 merchant, totals..., issues JSONB, raw_text, expense_id FK SET NULL)
  |              |1---* receipt_items (id, receipt_id CASCADE, position, name, quantity, amount)
  |0..1--* documents (id, user_id null, group_id null, source_type, source_id, content, meta JSONB,
  |                 embedding vector(768), tsv tsvector GENERATED)  CHECK user_id OR group_id
sql_examples (id, question UQ, sql, embedding vector(768))
analytics schema: my_expenses, my_expense_people, my_settlements, my_receipt_items (views)
```

## 6.5 Design decisions (why / alternatives / trade-offs / scale / senior suggestion)

| # | Decision | Why | Alternatives | Trade-off | At scale / senior suggestion |
|---|---|---|---|---|---|
| 1 | FastAPI rewrite of Node backend, keep React | AI ecosystem in Python; fix legacy bugs; keep UI | Patch Node backend | Two codebases during migration; legacy shapes kept (`user_id`, `{"error"}`) | Remove legacy aliases after frontend update; delete `backend/` |
| 2 | Service layer shared by REST, agent, MCP | One source of truth for rules/auth | Logic in routes | Slightly more files | Same; add domain events |
| 3 | Money in integer paise + Decimal | Exact sums | float | Conversion code | Same |
| 4 | Single ledger CTE, computed on read | Always consistent, no sync bugs | Stored running balances | O(expenses) per query | Materialised balances/cache invalidated on write when data grows |
| 5 | Separate `settlements` table | Settlements are not spending | Fake expenses (legacy) | Extra table | Same |
| 6 | Advisory lock for settle | Aggregate has no row to lock | SERIALIZABLE isolation, row locks | Postgres-specific | Same, or serializable + retry |
| 7 | LLM passes names, server resolves | No hallucinated IDs, no IDOR | IDs in tool args | Ambiguity handling needed | Same; fuzzy match with confirmations |
| 8 | Two-phase writes + pending actions | Human-in-the-loop, injection harmless | Autonomous agent; client-side confirm | Extra click | Batch approvals; policy-based auto-approve for low-risk actions |
| 9 | Remove tools after a proposal | Model can't chain writes | Allow multiple | One change per turn | Multi-step plans with one approval |
| 10 | LangGraph state graph | Explicit loop, limits, streaming | Hand loop, agent frameworks | Dependency | Checkpointing/persistence for long tasks |
| 11 | LiteLLM + fallbacks | Model-agnostic, resilience, cost | Direct SDK | Abstraction layer | Model routing by task, circuit breaker |
| 12 | No fallback after streaming started | Avoid mixed answers | Always fallback | User sees error mid-stream | Same |
| 13 | Text-to-SQL over views + read-only role | Prompts aren't security; DB enforces | Fixed reports, ORM-only | Setup complexity | Postgres RLS on base tables; query cost estimation (EXPLAIN) |
| 14 | sqlglot AST validation | Robust vs regex | Regex, no validation | Some false rejects (AND bug) | Fuzz tests for validator |
| 15 | pgvector inside Postgres | One DB, SQL access control | Pinecone/Qdrant | Postgres load | Dedicated vector DB/read replica at large scale |
| 16 | Hybrid search + RRF + LLM rerank | Names/amounts + semantics | Vector only | Extra LLM call latency/cost | Cross-encoder reranker, caching |
| 17 | Access control in retrieval SQL | Never leaks to model | Post-filtering | Query complexity | Same |
| 18 | Chunk per expense participant | Per-user visibility simple | ACL table | Duplicate chunks/embeddings | ACL join table to dedupe embeddings |
| 19 | Background indexing via asyncio tasks | Simple, no infra | Celery/RQ/arq queue | Lost on crash | Durable queue + outbox pattern |
| 20 | OCR via Gemini Vision + arithmetic check | One model, structured output | Tesseract + parsing | Cost per image | Confidence fields, human review queue |
| 21 | Voice transcript to input box | User verifies | Auto-send | Extra step | Same |
| 22 | Regex injection detector + layers | Cheap, explainable | ML classifier | Bypassable | Classifier + red-team regression suite in CI (user chose no CI now) |
| 23 | Own trace table + Langfuse | Offline + industry tool | Only one | Double storage | Sampling, retention policy, PII redaction |
| 24 | ScriptedLLM tests + separate evals | Deterministic tests, real-model metrics | Real LLM in tests | Two systems | Same |
| 25 | SSE via fetch stream | POST + auth header | EventSource, WebSocket | Manual parsing | Same |
| 26 | In-process rate limiter | No Redis needed | Redis limiter | Not shared across workers | Redis/gateway rate limiting |
| 27 | JWT in localStorage | Existing frontend | httpOnly cookie | XSS exposure | Cookie + CSRF protection, refresh tokens |
| 28 | MCP without confirm tool | Clients may auto-approve | Confirm tool | Approval in app only | Same |

> Interview tip: Jab poochein "why X?", hamesha 3 cheezein bolo: problem, chosen approach, trade-off. Example: "Advisory lock - balance ek aggregate hai, lock karne ko row nahi; trade-off Postgres-specific hai."

# 7. Database and API Deep Dive

## 7.1 Tables with key constraints and indexes

| Table | PK | Important constraints | Indexes |
|---|---|---|---|
| users | id (uuid str) | email UNIQUE, role IN (user,parent) | phone |
| friendships | (user_id, friend_id) | user_id <> friend_id, FK CASCADE | friend_id |
| groups | id | created_by FK | - |
| group_members | (group_id, user_id) | FK CASCADE | user_id |
| group_messages | id | FK CASCADE | (group_id, created_at) |
| expenses | id | amount > 0, split_type list, group SET NULL | (paid_by, created_at), group_id |
| expense_splits | (expense_id, user_id) | amount >= 0, expense CASCADE | user_id |
| settlements | id | amount > 0, payer <> payee | payer_id, payee_id |
| notifications | id | - | (user_id, created_at) |
| ai_conversations | id | user CASCADE | user_id |
| ai_messages | id | role IN (user,assistant,tool) | (conversation_id, seq) |
| ai_pending_actions | id | status list | (user_id, status) |
| ai_traces | id | user SET NULL | created_at, (user_id, created_at) |
| receipts | id | status list, expense SET NULL | (user_id, created_at) |
| receipt_items | id | receipt CASCADE | receipt_id |
| documents | id | user_id OR group_id NOT NULL | user_id, group_id, (source_type, source_id), GIN(tsv), HNSW(embedding cosine) |
| sql_examples | id | question UNIQUE | - (no vector index; few rows) |

**Why composite indexes like (paid_by, created_at):** "my expenses newest first" query ek index range scan mein ho jaaye.

**Why `ON DELETE SET NULL` for traces:** user delete ho toh bhi aggregate metrics bache rahein.

## 7.2 Important queries

- **Ledger CTE** (Section 4.5).
- **Expense listing** (`_EXPENSE_SELECT`): correlated subquery with `json_agg(json_build_object(...))` - ek query mein expense + uske splits with names (N+1 problem avoid).
- **Visibility (RAG)**, **vector**, **text** queries (Section 4.12).
- **AI Ops:** `percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)`, `count(*) FILTER (WHERE ...)`, window `created_at >= now() - make_interval(days => :days)`.
- **Atomic claim** (Section 4.9).

## 7.3 Complete API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /api/health | No | Health check |
| POST | /api/auth/signup | No | Create account + token |
| POST | /api/auth/signin | No (rate limited) | Login |
| GET | /api/users/profile | Yes | Current user |
| GET | /api/users/search?q= | Yes | Find people (prefix / exact email / phone) |
| GET | /api/friends | Yes | List friends |
| GET | /api/friends/search?prefix= | Yes | Search own friends |
| POST | /api/friends/add | Yes | Add friend |
| POST | /api/friends/send-reminder | Yes | Reminder notification |
| GET | /api/groups | Yes | My groups with totals |
| POST | /api/groups | Yes | Create group |
| GET | /api/groups/{id} | Member | Group detail |
| GET | /api/groups/{id}/expenses | Member | Group expenses |
| GET/POST | /api/groups/{id}/messages | Member | Group chat |
| POST | /api/expenses/create (alias /save) | Yes | Create expense |
| GET | /api/expenses/history | Yes | Filtered history (category, startDate, endDate) |
| POST | /api/expenses/ai-split | Yes (AI limit) | Category suggestion (legacy) |
| GET | /api/expenses/balances | Yes | All balances |
| POST | /api/expenses/settle | Yes | Settle with friend |
| POST | /api/expenses/{id}/pay | Yes | Settle with this expense's payer |
| GET | /api/notifications | Yes | List |
| POST | /api/notifications/ack | Yes | Mark read |
| GET | /api/analytics?month=&year= | Yes | Monthly analytics |
| GET | /api/dashboard | Yes | Dashboard data |
| POST | /api/ai/chat (?stream=false) | Yes (AI limit) | Agent turn (SSE) |
| GET | /api/ai/actions | Yes | Pending actions |
| POST | /api/ai/actions/{id}/confirm | Owner | Execute proposal |
| POST | /api/ai/actions/{id}/cancel | Owner | Cancel proposal |
| GET | /api/ai/conversations/{id}/messages | Owner | Visible transcript |
| POST | /api/ai/categorize | Yes (AI limit) | Category |
| POST | /api/ai/transcribe | Yes (AI limit) | Voice -> text |
| GET | /api/ai/ops/me | Yes | isAdmin flag |
| GET | /api/ai/ops/summary?days= | Admin | Metrics |
| GET | /api/ai/ops/traces | Admin | Trace list |
| GET | /api/ai/ops/traces/{id} | Admin | Trace detail |
| POST | /api/ai/ops/reindex | Admin | Rebuild RAG + seed SQL examples |
| POST | /api/receipts (alias /bills/ocr/upload) | Yes (AI limit) | Upload + OCR |
| GET | /api/receipts (alias /bills/user/me) | Yes | My receipts |
| GET | /api/receipts/{id} (alias /bills/{id}) | Owner | Receipt + items |
| GET | /api/receipts/{id}/image | Owner | Image file |
| POST | /api/receipts/{id}/assign | Owner (AI limit) | Item assignment preview |
| POST | /api/receipts/{id}/split | Owner | Create expense from items |

**Frontend calls with no backend route (not implemented in Python API):** `POST /api/users/init`, `/api/parent/*`.

## 7.4 Middleware, validation, auth, authorization

- **Middleware:** only `CORSMiddleware` (origins from settings, credentials allowed, methods GET/POST/PUT/PATCH/DELETE, headers Authorization + Content-Type).
- **Validation:** Pydantic request models; Query constraints; errors -> 400 `{"error": "field: message"}`.
- **Authentication:** `CurrentUser` dependency (JWT).
- **Authorization patterns:** membership (`require_membership`), ownership (`get_owned`, conversation owner check, `_claim` user_id), participant allow-list (`_allowed_participants`), admin (`require_admin`), DB-level (`splity_analyst`, views).

# 8. Security, Performance and Scalability

## 8.1 Implemented security mechanisms

| Threat | Mechanism | Code |
|---|---|---|
| Password theft | bcrypt 12 rounds | security.py |
| User enumeration | same error + dummy hash timing | users.authenticate |
| Brute force | login limiter 10 / 15 min per IP | rate_limit.py |
| AI abuse / cost | 30 AI requests/min per user | routes/ai.enforce_ai_limit |
| Forged identity | identity only from JWT; DB lookup | deps.get_current_user |
| IDOR | ownership/membership checks; names not IDs | services, tools.resolve_* |
| Expense with strangers | participant allow-list | expenses._allowed_participants |
| Double settle race | advisory lock | ledger.settle |
| Double confirm | atomic conditional UPDATE | store._claim |
| Stale proposal | TTL + balance re-check on execute | store, execute_settle_up |
| Prompt injection | wrap, detect, taint, output guard, HITL | guardrails.py, agent.py |
| System prompt injection via names | `_clean` names + "data" rule | prompts.py |
| SQL from LLM | AST validation, views, read-only role, read-only tx, timeout, LIMIT | sql_agent.py, migration 0005 |
| RAG data leak | visibility in SQL, per-participant chunks | rag.py |
| Exfiltration via images/links | output guard + no image/link rendering | guardrails.py, ChatPage.jsx |
| Malicious upload | magic bytes, size limits, random filename | ocr.sniff_image, voice.sniff_audio, receipts._store |
| Path traversal | serve only inside upload root | routes/receipts.receipt_image |
| SQL injection (app queries) | parameterised `text()` / ORM, LIKE escaping | services |
| Error info leak | generic 500 message, logged server-side | errors.py |
| Weak secret | `jwt_secret` min length 32 | config.py |

## 8.2 Known vulnerabilities / gaps (honest)

1. **JWT in localStorage** - XSS hone pe token chori; 7-day expiry, no revocation.
2. **In-memory rate limiters** - multiple workers/instances mein shared nahi; restart pe reset; proxy ke peeche client IP header handling not configured.
3. **Regex injection detection** - paraphrase se bypass ho sakta hai (isliye HITL final layer hai).
4. **No CSRF concern currently** (Bearer header), but cookie approach adopt kiya toh CSRF chahiye.
5. **Traces store input/output previews** - PII; retention/redaction policy nahi.
6. **Local disk uploads** - single server; backup/cleanup nahi.
7. **Pending actions cleanup** - expired rows delete karne ka job nahi (status pending rehta hai, par confirm nahi ho sakta).
8. **No dedicated tests** for OCR/SQL/RAG/guardrails/voice modules; evals full run pending (quota).
9. **Missing backend for parent/child pages** and `/users/init`.
10. **HTTPS, secrets manager, deployment hardening** - not in repo.

## 8.3 Performance analysis

| Area | Bottleneck | Current mitigation | Improvement |
|---|---|---|---|
| LLM latency | Gemini 1-30s+; multiple calls per turn (agent + SQL + rerank) | Streaming tokens, flash models, step limit | Model routing, caching, parallel tools, skip rerank for small result sets |
| Ledger | Aggregation over all user expenses each call | Indexes on splits/user, paid_by | Materialised balances |
| Expense list | LIMIT 200, no pagination | json_agg avoids N+1 | Cursor pagination |
| RAG indexing | One embed call per item; reindex sequential | Background | Batch embeddings, queue |
| Vector search | HNSW + WHERE filter recall | Pool = max(4k, 20) | Tune ef_search, partial indexes |
| Text-to-SQL | 2 LLM calls worst case + query | Timeout 3s, LIMIT | Cache by (user, question), precomputed aggregates |
| Traces | Write per request | Never-raise, small rows | Batch/async write, sampling |
| Upload | Base64 image to LLM (8MB -> ~11MB) | Size limit | Resize/compress before sending |

## 8.4 Scalability limitations

- Single API process assumptions: in-memory limiter, asyncio background tasks, local uploads.
- Postgres single node; vector + OLTP same DB.
- Horizontal scaling plan: stateless API replicas behind load balancer; Redis (rate limit, cache); job queue (indexing, OCR); S3 for files; Postgres read replicas + connection pooler (PgBouncer); dedicated vector store if needed.

## 8.5 Concurrency

- Settlements: advisory lock. Confirm: atomic claim. Expense create: single transaction.
- Message `seq` in `append_messages` = max(seq)+1 - **two concurrent turns in the same conversation could race** (no unique constraint on (conversation_id, seq)); UI sends one turn at a time, so low risk. Improvement: unique constraint + retry, or sequence.
- Background indexing uses its own session (no shared session across tasks).

## 8.6 Error handling and fault tolerance

- Domain errors -> clean 4xx; unknown -> 500 logged.
- LLM failure -> fallback models -> friendly "unavailable" + error trace; transcript kept valid.
- Embedding failure -> text-only document; vector search skipped.
- Rerank failure -> original order. Few-shot retrieval failure -> static examples.
- Categorise failure -> "Other" fallback. OCR failure -> status failed (image kept).
- Trace write failure -> logged, request unaffected.
- Pending action execution failure -> status failed + transcript note; unexpected crash re-raised after marking failed.
