# 0. Is report ko kaise padhein

Yeh report sirf tumhare actual repository (`Splity/api` aur `Splity/frontend`) ko padh ke likhi gayi hai. Har section mein file paths aur function names diye hain taaki tum code khol ke verify kar sako.

- **Implemented** = code mein hai aur chal raha hai.
- **Not implemented / Suggested** = improvement idea hai, code mein nahi hai. Interview mein inhe "future work" bolna, "maine banaya" nahi.
- **Not verified** = repository se confirm nahi ho saka.
- Yellow boxes = interview tips.
- Paise ke liye "Rs" likha hai (PDF font mein rupee symbol nahi hai). Code mein `currency_symbol = "₹"` hai.

> Padhne ka order: pehle Section 1 aur 2 (big picture), phir Section 4 (features), phir Section 3 (technologies). Interview se ek din pehle Section 11 (revision) padho.

**Repository ka scope (important honesty point):**

| Folder | Kya hai | Status |
|---|---|---|
| `api/` | Naya Python backend (FastAPI) + AI layer + evals + tests | Active, main project |
| `frontend/` | React (Vite) UI | Active |
| `backend/` | Purana Node.js/Express backend | Sirf reference ke liye rakha, ab use nahi hota |
| `mcp/` | Purana Node MCP server | Reference only; naya MCP server `api/app/mcp_server.py` mein hai |
| `docker-compose.yml` | Postgres 16 + pgvector container | Active |

# 1. Project Overview

## 1.1 Project introduction

**Splity** ek expense-sharing application hai (jaise dosto ke saath trip, flatmates ka rent, restaurant bill). App track karta hai ki kisne kitna pay kiya, kiska kitna share hai, aur kisko kisko kitna lena/dena hai.

Iska special part hai **AI assistant**. User chat mein English, Hindi ya Hinglish mein likh/bol sakta hai, aur ek **AI agent** (LangGraph + Gemini via LiteLLM) 17 tools ki madad se kaam karta hai: balance batana, expense add karna (user ke confirm ke baad), analytics ke sawal (text-to-SQL), purane receipts/chat search (hybrid RAG), bill photo se items nikalna (OCR), aur voice input.

Project ka focus "AI engineering" hai: AI ko **safe** (human approval, guardrails), **correct** (numbers tools se, paise exact), **measurable** (eval harness) aur **observable** (tracing, latency, cost) banana.

## 1.2 Problem statement

1. Group expenses manually track karna tedious hai, aur rounding galtiyan hoti hain (Rs 100 / 3 = 33.33 + 33.33 + 33.33 = 99.99 - 1 paisa gayab).
2. Normal apps mein har kaam ke liye form bharna padta hai; user apni bhasha mein seedha nahi pooch sakta "is mahine food pe kitna gaya?"
3. Agar AI ko paison wale app mein daalo, toh naye risks aate hain: AI galat number bol de (hallucination), koi chhupi instruction se AI ko bewakoof bana de (prompt injection), AI dusre user ka data dikha de, ya galat SQL chala de.

Splity in teeno problems ko address karta hai.

## 1.3 Real-world use cases

| Situation | Splity kaise help karta hai |
|---|---|
| Goa trip, 5 dost | Group banao, har expense split karo, end mein "who owes whom" |
| Flatmates | Rent/wifi monthly expenses, settle up record |
| Restaurant bill | Photo upload -> items -> "maine paneer liya, Rahul-Priya ne pizza share kiya" -> item-wise split |
| Apna kharcha samajhna | "Weekends vs weekdays kitna kharcha?" -> text-to-SQL |
| Purani baat yaad karna | "Barbeque Nation pe kya order kiya tha?" -> RAG search with citation |
| Haath busy hain | Mic se bolo, transcript check karo, send karo |

## 1.4 Target users

- College students, working professionals, flatmates, travel groups - jo regularly kharcha share karte hain.
- Indian users specifically: Hinglish support, INR default.
- Developers/AI tools users: MCP server se Claude Desktop/Cursor bhi Splity tools use kar sakte hain.
- Admin/developer: AI Ops dashboard (sirf `ADMIN_EMAILS` wale users).

## 1.5 Complete feature list (implemented)

**Core expense features**
- Signup / signin (JWT, bcrypt, login rate limit).
- Friends: add by email/phone search, list, prefix search, reminder bhejna.
- Groups: create, members, group messages (chat), group expenses, group totals.
- Expenses: equal / percentage / custom / personal split, history with date/category filters.
- Balances (who owes whom) - ek hi ledger formula se.
- Settle up (advisory lock ke saath), "pay this expense".
- Notifications (expense added, settlement) + acknowledge.
- Analytics & dashboard (user ke apne share pe based).

**AI features**
- AI chat agent (LangGraph), streaming over SSE, 17 tools.
- Human-in-the-loop: write actions pending action ke roop mein, confirm/cancel.
- Text-to-SQL analytics (`ask_analytics`).
- Hybrid RAG search (`search_documents`) with citations.
- Receipt OCR (Gemini Vision) + arithmetic check + item-level split.
- Voice transcription (Gemini audio) + read-aloud (browser).
- Expense auto-categorisation (`/ai/categorize`, `/expenses/ai-split`).
- Prompt-injection guardrails + taint warning.
- Observability: `ai_traces`, AI Ops dashboard, Langfuse export.
- MCP server (same tools).
- Eval harness: agent, SQL, RAG, red-team suites.

**Frontend pages present but backend not ported (honest point):** `ChildMonitoringPage`, `ChildAnalyticsPage`, `ParentNotificationsPage` call `/api/parent/*`, aur `authService.initUser` `/api/users/init` call karta hai - yeh endpoints Python API mein **nahi** hain. Yeh purane Node backend ka feature tha. `users.role` column mein 'parent' value allowed hai, par logic port nahi hua.

## 1.6 Project objectives

1. Purane Node backend ki security/correctness problems fix karna (models.py docstring aur tests mein "legacy weakness" ke naam se documented).
2. React frontend ko as-is rakhte hue Python/FastAPI backend banana (API response shapes compatible rakhe - jaise `{"error": msg}` aur legacy keys `user_id`, `merchant_name`).
3. AI features aise banana jo production-grade lagen: safety, evals, observability.
4. Resume ke liye AI engineering depth dikhana.

## 1.7 Overall workflow (user journey)

```
Signup/Signin -> JWT token localStorage mein
   |
   +-> Dashboard (balances, recent activity, quick stats)
   +-> Friends add karo -> Groups banao
   +-> Expense add (form) ya Chat mein "add 600 for dinner with Rahul"
   |       Chat: agent -> create_expense PROPOSAL -> Confirm card -> user Confirm -> saved
   +-> Bills page: receipt upload -> OCR -> "who had what" -> split -> expense
   +-> Chat: "kitna kharcha hua?" (SQL) / "kya order kiya?" (RAG) / "kaun paise deta hai?" (balances)
   +-> Settle up
   +-> Admin: AI Ops dashboard (latency, cost, traces)
```

## 1.8 High-level architecture

```
 Browser (React 19 + Vite, port 3000)
   |  fetch /api/*  (Vite dev proxy -> 127.0.0.1:5000)
   v
 FastAPI app  (app/main.py: create_app)
   - CORS middleware, error handlers ({"error": msg})
   - Routers: auth, users, friends, groups, expenses, notifications, analytics, ai, receipts
   |
   +--> Services layer (app/services/*)  -- business rules, single source of truth
   |        splitting, ledger, expenses, groups, friends, users, receipts, analytics, notifications
   |
   +--> AI layer (app/ai/*)
   |        agent.py (LangGraph) -> tools.py + tools_ai.py (17 tools) -> services
   |        store.py (conversations, pending actions)   guardrails.py   prompts.py
   |        sql_agent.py (text-to-SQL)  rag.py (hybrid RAG)  ocr.py  voice.py
   |        llm.py (LiteLLM client + fallbacks, ScriptedLLM for tests)
   |        tracing.py + ops.py (observability)
   |
   +--> PostgreSQL 16 + pgvector (Docker)
            public tables + documents(vector, tsvector) + analytics.* views + splity_analyst role
   |
   +--> External: Google Gemini (chat, vision, audio, embeddings) via LiteLLM; Langfuse (optional)

 Separate process: app/mcp_server.py (stdio) -> same TOOLS registry -> same DB
```

> Interview line: "The REST API, the in-app agent and the MCP server all call the same service layer, so there is one source of truth for business rules and authorization."

# 2. Complete Codebase Analysis

## 2.1 Folder structure (api)

```
api/
  app/
    main.py                 # FastAPI app factory, routers, CORS, Langfuse, background indexing
    mcp_server.py           # MCP server over stdio (same tools)
    core/
      config.py             # Settings (pydantic-settings, .env)
      security.py           # bcrypt hash/verify, JWT create/decode
      rate_limit.py         # in-process sliding-window limiter, login limiter
      errors.py             # DomainError classes + exception handlers
    db/
      models.py             # SQLAlchemy ORM models (17 tables)
      session.py            # async engine, sessionmaker, URL normalisation
    api/
      deps.py               # get_current_user (JWT -> User), SessionDep, CurrentUser
      schemas.py            # Pydantic request models (CamelModel)
      routes/               # auth, users, friends, groups, expenses, notifications,
                            # analytics, ai, receipts
    services/               # business logic (no HTTP here)
      splitting.py ledger.py expenses.py groups.py friends.py users.py
      notifications.py analytics.py receipts.py
    ai/
      llm.py agent.py tools.py tools_ai.py store.py prompts.py guardrails.py
      sql_agent.py rag.py ocr.py receipt_assign.py voice.py categorize.py
      tracing.py ops.py
  alembic/versions/         # 0001..0005 migrations
  evals/                    # world.py, datasets/*.yaml, scoring.py, run.py
  scripts/seed_demo.py      # demo user + data
  tests/                    # unit + integration (pytest)
  pyproject.toml            # dependencies (uv)
```

## 2.2 Folder structure (frontend)

```
frontend/
  vite.config.js            # port 3000, proxy /api -> 127.0.0.1:5000, alias @ -> src
  src/
    main.jsx, App.jsx       # router (react-router-dom 7)
    context/AuthContext.jsx # login state, token in localStorage
    layouts/MainLayout.jsx  # sidebar/nav, AI Ops link only for admins
    services/api.js         # all API calls, SSE parser, uploads, blob image URLs
    pages/                  # Dashboard, Friends, Groups, GroupDetail, Expenses, AddExpense,
                            # Bills, Insights, Chat, AIOps, Notifications, SignIn, SignUp,
                            # ChildMonitoring, ChildAnalytics, ParentNotifications (backend missing)
    components/ui/          # Radix + Tailwind components (button, card, dialog, select ...)
    components/dashboard/   # QuickStats, RecentActivity
```

## 2.3 Responsibility of every important file

| File | Responsibility |
|---|---|
| `app/main.py` | `create_app()` - logging, LiteLLM quiet, `configure_langfuse()`, `enable_background_indexing()`, CORS, error handlers, `/api/health`, routers with `/api` prefix |
| `app/core/config.py` | `Settings` class: DB URL, JWT secret (min 32 chars), CORS, rate limits, LLM model + fallbacks, timeouts, agent max steps (6), pending TTL (10 min), AI rate limit (30/min), upload limits, embedding model, RAG top-k (6), SQL limits (200 rows, 3000 ms), admin emails, Langfuse keys |
| `app/core/security.py` | `hash_password` (bcrypt 12 rounds), `verify_password` (no hash -> false), `create_access_token` (claim `userId`), `decode_access_token` |
| `app/core/rate_limit.py` | `SlidingWindowLimiter`, `login_limiter`, `limit_login` dependency |
| `app/core/errors.py` | `DomainError` -> BadRequest/Unauthorized/Forbidden/NotFound/Conflict/TooManyRequests; handlers return `{"error": ...}` |
| `app/api/deps.py` | `get_current_user`: Bearer token -> decode -> load User; identity kabhi client body se nahi |
| `app/db/session.py` | `normalize_database_url` (libpq URL -> asyncpg, sslmode handling), cached engine/sessionmaker |
| `app/db/models.py` | Saare tables (Section 7) |
| `app/services/splitting.py` | Pure maths: `to_cents`, `equal_split`, `percentage_split` (largest remainder), `custom_split` |
| `app/services/ledger.py` | `_LEDGER_CTE` - balance formula; `balances_for`, `pair_balance`, `settle` (advisory lock) |
| `app/services/expenses.py` | `ExpenseInput`, `compute_shares`, `create_expense` (participant check, notifications, RAG index), `list_expenses`, `pay_expense` |
| `app/services/groups.py` | membership checks, list/create groups, messages (post -> RAG index) |
| `app/services/friends.py` | bidirectional friendships, search, reminder |
| `app/services/users.py` | create user, `authenticate` (timing-equalised), safe user search |
| `app/services/receipts.py` | upload validation + storage, OCR call, `allocate` (item split maths), `split_receipt` |
| `app/services/analytics.py` | category spend, period summary, top categories, dashboard |
| `app/ai/llm.py` | `LLMClient` protocol, `LiteLLMClient` (stream, complete_json, embed, fallbacks), `ScriptedLLM` test double, `get_llm` |
| `app/ai/agent.py` | LangGraph graph, `llm_node`, `tools_node`, `give_up_node`, `run_turn` (one chat turn) |
| `app/ai/tools.py` | Tool registry, name resolution, 13 base tools, `run_read`/`prepare_write`/`execute_write`, JSON schema flattening |
| `app/ai/tools_ai.py` | 4 AI tools: `ask_analytics`, `search_documents`, `list_receipts`, `split_receipt` |
| `app/ai/store.py` | Conversations/messages, pending actions, atomic `_claim`, `confirm_action`, `cancel_action` |
| `app/ai/prompts.py` | `PROMPT_VERSION = "agent-v2"`, `build_system_prompt` |
| `app/ai/guardrails.py` | `UNTRUSTED_TOOLS`, injection regex, `wrap_tool_result`, `clean_user_input`, `guard_output` |
| `app/ai/sql_agent.py` | Text-to-SQL: `validate_sql`, `run_readonly`, `similar_examples`, `answer_question`, `seed_examples` |
| `app/ai/rag.py` | Indexing (expense/message/receipt), background scheduling, `search` (vector + text + RRF + rerank) |
| `app/ai/ocr.py` | Receipt JSON schema, `read_receipt`, `check_arithmetic`, `sniff_image` |
| `app/ai/receipt_assign.py` | Natural-language "who had what" -> item assignments |
| `app/ai/voice.py` | `sniff_audio`, `transcribe` |
| `app/ai/categorize.py` | Category + subcategory + confidence, fallback "Other" |
| `app/ai/tracing.py` | `TraceData`, `build_spans`, `record` (never raises), `configure_langfuse` |
| `app/ai/ops.py` | SQL aggregations for AI Ops (p50/p95 via `percentile_cont`) |
| `app/mcp_server.py` | MCP server: each tool -> handler; writes -> pending action |
| `evals/run.py` | Eval runner: builds world, runs suites, scores, writes EVALS.md + JSON |
| `evals/world.py` | Deterministic test world (people, groups, receipts, injections, stranger) |
| `evals/scoring.py` | Pure scoring: `args_match`, `score_agent_case`, `rows_equal`, `percentile` |
| `scripts/seed_demo.py` | Demo user `demo@splity.app` + friends + Goa Trip + expenses |

## 2.4 Backend architecture (layers)

```
HTTP layer      routes/*.py       request parse (Pydantic), auth (CurrentUser), response shape
      |
Service layer   services/*.py     business rules, authorization checks, DB queries
      |
Data layer      db/models.py      SQLAlchemy ORM + raw SQL (text()) for complex queries
      |
PostgreSQL
```

AI layer services ko call karta hai, routes ko nahi. Isliye AI ko wahi authorization milta hai jo REST API ko.

**Layered architecture kyun?** Agar business rule (jaise "sirf friends ke saath split") route mein hota, toh AI tool aur MCP server ko alag se likhna padta - bugs ka chance. Service layer = ek jagah rule.

## 2.5 Frontend architecture

- **Routing:** `App.jsx` mein `BrowserRouter`; `/signin`, `/signup` public; baaki `MainLayout` ke andar.
- **Auth state:** `AuthContext.jsx` - login pe `token`, `user`, `userId` localStorage mein.
- **API layer:** `services/api.js` - `fetchAPI()` har request mein `Authorization: Bearer <token>` lagata hai; 401 pe localStorage clear karke `/signin` redirect.
- **Chat streaming:** `streamChat()` `fetch` ka `response.body.getReader()` use karke SSE frames (`\n\n` se separate) parse karta hai, har `data:` line JSON hai.
- **Images behind auth:** `authedBlobUrl()` - `<img src>` header nahi bhej sakta, isliye fetch karke blob URL banate hain.
- **UI kit:** Radix UI primitives + Tailwind (shadcn-style) in `components/ui`.
- **Charts:** AI Ops page Recharts use karta hai.

## 2.6 Database structure (summary)

17 ORM tables + 4 analytics views. Detail Section 7 mein.

| Group | Tables |
|---|---|
| Core | users, friendships, groups, group_members, group_messages |
| Money | expenses, expense_splits, settlements |
| Misc | notifications |
| AI chat | ai_conversations, ai_messages, ai_pending_actions, ai_traces |
| OCR | receipts, receipt_items |
| RAG / SQL | documents, sql_examples |
| Views | analytics.my_expenses, my_expense_people, my_settlements, my_receipt_items |

## 2.7 API structure (summary)

Sab routes `/api` prefix ke saath. Full table Section 7.

| Router | Prefix | Main endpoints |
|---|---|---|
| auth | /auth | POST /signup, POST /signin |
| users | /users | GET /profile, GET /search |
| friends | /friends | GET "", GET /search, POST /add, POST /send-reminder |
| groups | /groups | GET "", POST "", GET /{id}, GET /{id}/expenses, GET/POST /{id}/messages |
| expenses | /expenses | POST /create (+ /save alias), GET /history, POST /ai-split, GET /balances, POST /settle, POST /{id}/pay |
| notifications | /notifications | GET "", POST /ack |
| analytics | (none) | GET /analytics, GET /dashboard |
| ai | /ai | POST /chat, GET /actions, POST /actions/{id}/confirm, POST /actions/{id}/cancel, GET /conversations/{id}/messages, POST /categorize, POST /transcribe, GET /ops/*, POST /ops/reindex |
| receipts | (none) | POST /receipts (+ /bills/ocr/upload), GET /receipts, GET /receipts/{id}, GET /receipts/{id}/image, POST /receipts/{id}/assign, POST /receipts/{id}/split |

## 2.8 External integrations

| Integration | Kahan | Kya kaam |
|---|---|---|
| Google Gemini (via LiteLLM) | `app/ai/llm.py` | Chat + tool calling (`gemini-3.8-flash`, fallbacks 3.7/3.6), JSON outputs, vision (OCR), audio (transcribe), embeddings (`gemini-embedding-001`, 768 dims) |
| Langfuse (optional) | `app/ai/tracing.py` | LiteLLM `langfuse_otel` callback se LLM calls export |
| MCP clients | `app/mcp_server.py` | Claude Desktop / Cursor stdio se connect |
| Browser APIs | `ChatPage.jsx` | MediaRecorder (mic), speechSynthesis (read aloud) |

## 2.9 Module relationships

```
routes/ai.py ----> agent.run_turn ----> GRAPH (llm_node, tools_node)
                         |                    |
                         |                    +--> tools.run_read / prepare_write
                         |                    |        +--> services/* (expenses, ledger, groups...)
                         |                    |        +--> tools_ai: sql_agent / rag / receipts
                         |                    +--> store.create_pending_action
                         |                    +--> guardrails.wrap_tool_result
                         +--> guardrails.clean_user_input / guard_output
                         +--> tracing.record
routes/ai.py confirm --> store.confirm_action --> tools.execute_write --> services/*
services/expenses, groups, receipts --> rag.schedule_index (background)
mcp_server --> tools.run_read / prepare_write --> store.create_pending_action
```

Circular import handle: `tools.py` ke end mein `from app.ai import tools_ai` - AI tools registry mein khud register hote hain (tools_ai ko tools ke Args, ToolSpec chahiye).
