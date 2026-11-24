# 3. Complete Technology Deep Dive (Part A: Backend foundation)

Har technology ke liye same structure: kya hai -> kyun bana -> internal working -> concepts -> project mein use -> kyun chuna / alternatives -> pros/cons -> mistakes -> interview Q&A.

Technologies jo repository se discover hui (`api/pyproject.toml`, `frontend/package.json`, `docker-compose.yml`):

| Area | Technologies |
|---|---|
| Language/runtime | Python 3.12, asyncio |
| Web | FastAPI, Starlette, Uvicorn (ASGI), python-multipart |
| Validation/config | Pydantic v2, pydantic-settings, email-validator |
| Database | PostgreSQL 16, SQLAlchemy 2.0 (async), asyncpg, Alembic, pgvector, Postgres full-text search |
| Auth | PyJWT, bcrypt |
| AI | Google Gemini, LiteLLM, LangGraph (langchain-core comes with it), MCP SDK, sqlglot, Langfuse (OpenTelemetry) |
| Tooling | uv, ruff, Docker Compose, PyYAML |
| Testing | pytest, pytest-asyncio, httpx, Hypothesis |
| Frontend | React 19, Vite 6, React Router 7, Tailwind CSS 3, Radix UI, class-variance-authority, clsx, tailwind-merge, react-markdown, Recharts, sonner, lucide-react, heroicons, date-fns |
| Browser APIs | Fetch + ReadableStream (SSE parsing), MediaRecorder, speechSynthesis, localStorage, Blob URLs |
| Installed but not used in `src/` | chart.js, react-chartjs-2, framer-motion, @tanstack/react-table, rehype-raw (cleanup candidate) |

## 3.1 Python 3.12 and asyncio

**Kya hai:** Python general-purpose language hai. `asyncio` uska built-in system hai jisse ek hi thread mein bahut saare I/O kaam (DB query, HTTP call to Gemini) ek saath "wait" kar sakte hain.

**Kyun bana (asyncio):** Web server ka zyada time wait karne mein jaata hai (DB ka jawab, LLM ka jawab). Thread-per-request mehenga hai. Async mein jab ek request wait kar rahi hai, event loop dusri request chala deta hai.

**Internal working (simple):** Event loop ek manager hai jiske paas tasks ki list hai. `await` likhne ka matlab: "main yahan wait karunga, tab tak kisi aur ko chalao". Coroutine = `async def` function. Task = scheduled coroutine.

**Analogy:** Ek waiter 10 tables handle karta hai - order dekar kitchen ke saamne khada nahi rehta, dusri table pe chala jaata hai.

**Project mein use:**
- Poora backend async: `async def` routes, `AsyncSession`, `await litellm.acompletion(...)`.
- `asyncio.to_thread(_store, ...)` in `services/receipts.py` - file write blocking hai, isliye thread mein bheja taaki event loop block na ho. Same image serve karte waqt `receipt_image` route mein.
- `rag.schedule_index()` - `asyncio.get_running_loop().create_task(run())` se background indexing; task ko `_background` set mein rakhte hain (warna garbage collect ho sakta hai) aur `add_done_callback(_background.discard)`.
- Python 3.12 features: `X | Y` type unions, `StrEnum` (`Category` in tools.py), `datetime.UTC`.

**Common mistakes:** async function mein blocking call (time.sleep, file I/O, CPU heavy) - poora server ruk jaata hai. Ruff ka `ASYNC` rule set (pyproject mein enabled) yeh pakadta hai - isi wajah se `asyncio.to_thread` lagaya.

**Limitations:** CPU-heavy kaam ke liye async fayda nahi deta (GIL). Background tasks process restart pe lost ho jaate hain (isliye "job queue" future improvement hai).

**Interview Q&A**
- **Q: Async kyun use kiya?** A: App ka kaam mostly I/O hai - Postgres aur Gemini calls. LLM call 2-30 second le sakti hai; sync server mein worker block ho jaata. Async mein ek process bahut concurrent requests handle karta hai.
- **Q: asyncio.to_thread kab use karte ho?** A: Jab koi blocking library/function call karna ho async code se. Maine receipt file save/read ke liye use kiya.
- **Follow-up: create_task ka reference kyun rakha?** A: Event loop tasks ko weak reference se rakhta hai; agar hum strong reference na rakhein toh task beech mein garbage collect ho sakta hai. Isliye `_background` set.

## 3.2 FastAPI (with Starlette and Uvicorn)

**Kya hai:** Python ka modern web framework APIs banane ke liye. Starlette (ASGI toolkit) ke upar bana hai, aur Pydantic se validation karta hai. Uvicorn ASGI server hai jo app ko chalata hai.

**Kyun bana:** Flask/Django REST mein async support aur automatic validation/docs kamzor the. FastAPI type hints se automatically request validate, docs (OpenAPI/Swagger) generate, aur dependency injection deta hai.

**Internal working:**
1. Uvicorn HTTP request receive karta hai -> ASGI format mein FastAPI ko deta hai.
2. FastAPI route match karta hai, function ke type hints dekh ke body/query/path parse + validate karta hai (Pydantic).
3. `Depends(...)` wali dependencies pehle resolve hoti hain (jaise DB session, current user).
4. Function ka return JSON mein convert hota hai (`jsonable_encoder`).
5. Exception aaye toh registered exception handler response banata hai.

**Core concepts:**
- **Router:** `APIRouter(prefix="/ai")` - related routes ka group.
- **Dependency Injection:** function parameter mein `Depends(get_session)` - FastAPI khud call karke value deta hai. Testing mein override kar sakte ho.
- **`Annotated` aliases:** `SessionDep = Annotated[AsyncSession, Depends(get_session)]`, `CurrentUser = Annotated[User, Depends(get_current_user)]` (`app/api/deps.py`) - har route mein chhota likhna.
- **Middleware:** har request pe chalne wala code - yahan `CORSMiddleware`.
- **StreamingResponse:** response tukdon mein bhejna - chat SSE ke liye.
- **UploadFile / File:** multipart uploads (python-multipart library chahiye).

**Project mein use (code refs):**
- `app/main.py: create_app()` - app factory pattern; routers `/api` prefix ke saath.
- `app/core/errors.py: register_error_handlers` - `DomainError`, validation error (400), HTTP errors, aur unhandled (500 + log) sab `{"error": ...}` shape mein. Validation error 400 return karta hai (FastAPI default 422 hai) - React client compatibility ke liye.
- `app/api/routes/ai.py: chat` - `StreamingResponse(media_type="text/event-stream")` with `Cache-Control: no-cache` aur `X-Accel-Buffering: no` (nginx buffering band).
- `?stream=false` - eval harness ke liye same endpoint JSON return karta hai.
- `require_admin` dependency -> `AdminUser` alias -> ops routes.
- `router.add_api_route("/create", ...)` aur `/save` - legacy alias.
- `Query(default=7, ge=1, le=90)`, `pattern="^(recent|slowest)$"` - query param validation.

**Kyun chuna / alternatives:**

| Option | Kyun nahi |
|---|---|
| Flask | Async aur validation built-in nahi; extra libraries |
| Django + DRF | Bhaari, ORM sync-first, is project ke liye zyada |
| Node/Express (purana) | AI ecosystem (LangGraph, sqlglot, evals) Python mein zyada strong |

**Pros:** fast development, type-safe, auto docs (`/docs`), async, DI testing mein easy (`app.dependency_overrides` in `tests/conftest.py`).
**Cons:** Bahut bade apps mein structure khud banana padta hai; background jobs ke liye built-in robust queue nahi.

**Performance:** Async + uvicorn fast hai; bottleneck yahan LLM latency hai, framework nahi.

**Common mistakes:** Async route mein blocking code; har request pe naya DB engine banana (yahan `lru_cache` se ek engine); streaming response mein request-scoped session use karna (yahan `get_session_factory` - stream apna session kholta hai, kyunki request khatam hone ke baad bhi stream chalti hai).

**Interview Q&A**
- **Q: Streaming chat mein DB session kaise manage kiya?** A: Normal `SessionDep` request ke saath close ho jaata hai, par SSE stream lambi chalti hai. Isliye `FactoryDep` (sessionmaker) inject kiya aur `_events()` generator ke andar `async with factory() as session` khola - session stream jitna zinda rehta hai.
- **Q: Errors ka format consistent kaise?** A: `DomainError` subclasses (status code ke saath) + `register_error_handlers` - sab `{"error": message}`. Unhandled exception log hota hai aur client ko sirf "Internal server error" (internal details leak nahi).
- **Q: Dependency injection ka fayda?** A: Auth logic ek jagah (`get_current_user`), aur tests mein `get_session` override karke test DB use karte hain.
- **Follow-up: 422 ki jagah 400 kyun?** A: React client pehle se `{"error"}` aur 400 expect karta tha (legacy Node). Compatibility ke liye handler override kiya.

## 3.3 Pydantic v2 and pydantic-settings

**Kya hai:** Python type hints se data validation library. v2 ka core Rust mein hai (fast). `pydantic-settings` environment variables/.env se config load karta hai.

**Problem:** External data (API body, LLM output, env vars) pe bharosa nahi kar sakte. Manual `if` checks error-prone hain.

**Internal working:** Model class ke fields + types se ek validator schema banta hai. `model_validate(data)` data ko check + convert karta hai (string "12.5" -> Decimal), galat ho toh `ValidationError` with field-wise errors. `model_json_schema()` JSON Schema deta hai.

**Project mein use:**
- **Request bodies:** `ChatIn(message: str = Field(min_length=1, max_length=2000))`, `CategorizeIn`, `AssignIn`, `SplitIn` etc. `CamelModel` (in `schemas.py`) camelCase aliases deta hai (React `conversationId` bhejta hai, Python `conversation_id`).
- **Tool arguments:** `class Args(BaseModel): model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)` - unknown fields (jaise attacker ka `user_id`) chupchaap drop. `CreateExpenseArgs.amount: Decimal = Field(gt=0)`.
- **Tool JSON schema for LLM:** `tools.model_schema()` -> `model_json_schema()` -> `_inline()` flatten (no `$ref`, `anyOf` null hatao, Decimal ke liye number choose) kyunki har provider full JSON Schema support nahi karta.
- **LLM output validation:** `ParsedReceipt` (OCR), `Transcript` (voice), `CategoryResult` (categorize), `_Result` (receipt assign).
- **Config:** `Settings(BaseSettings)` in `config.py`; `jwt_secret: str = Field(min_length=32)` - weak secret pe app start hi nahi hoga. `langfuse_host` `AliasChoices("LANGFUSE_HOST","LANGFUSE_BASE_URL")`.

**Kyun:** FastAPI natively use karta hai; LLM structured outputs validate karne ke liye best.

**Common mistakes:** LLM JSON ko bina validate kiye use karna; `float` for money (yahan `Decimal`).

**Interview Q&A**
- **Q: LLM output pe bharosa kaise karte ho?** A: Do layer - provider ko JSON schema dete hain (`response_format=json_schema`), phir Pydantic se dobara validate. Fail ho toh fallback (categorize -> "Other") ya error (OCR -> status failed).
- **Q: `extra="ignore"` kyun?** A: LLM extra fields bhej de (jaise `user_id`) toh woh use hi nahi hote. Identity sirf JWT se aati hai.

## 3.4 PostgreSQL 16

**Kya hai:** Open-source relational database. Tables, rows, SQL, transactions (ACID), indexes, views, roles, extensions.

**Kyun bana / problem:** Data ko reliable tareeke se store, query aur concurrent access ke saath consistent rakhna.

**Key concepts (project se linked):**

| Concept | Simple meaning | Project mein |
|---|---|---|
| Transaction / ACID | Ya poora kaam ho ya kuch nahi | Expense + splits + notifications ek commit mein |
| Foreign key | Ek table ka column dusre ki row ko point kare | `expense_splits.expense_id -> expenses.id ON DELETE CASCADE` |
| CHECK constraint | DB level rule | `amount > 0`, `split_type IN (...)`, `user_id <> friend_id` |
| Index | Kitab ka index, fast search | `ix_expenses_paid_by_created_at`, GIN on `tsv`, HNSW on `embedding` |
| View | Saved query jo table jaisi dikhe | `analytics.my_expenses` |
| Role | DB user/permission group | `splity_analyst` (read-only on analytics) |
| `current_setting` / `set_config` | Per-transaction variable | `app.user_id` -> views filter |
| Advisory lock | App-defined lock | `pg_advisory_xact_lock(hashtext('settle:a:b'))` |
| CTE (`WITH`) | Named sub-query | `_LEDGER_CTE` |
| `percentile_cont` | Percentile calculation | p50/p95 in `ops.py` |
| Generated column | Auto-computed column | `tsv = to_tsvector('simple', content)` STORED |
| Extensions | Plugins | `vector` (pgvector) |
| JSONB | Binary JSON column | `ai_messages.tool_calls`, `ai_traces.spans`, `receipts.issues` |

**Kyun Postgres (alternatives):** MySQL mein pgvector jaisa mature vector support aur rich features (generated tsvector, roles+views, advisory locks) kam. MongoDB mein relational money data (joins, constraints, transactions) natural nahi. Ek Postgres = relational + vector + full-text, alag vector DB nahi chahiye.

**Limitations:** Single node pe write scaling limited; HNSW index memory leta hai; full-text `simple` config stemming nahi karta (Hindi/English stemming nahi).

**Interview Q&A**
- **Q: Ek hi DB mein vectors kyun?** A: Data chhota-medium hai, access control SQL WHERE mein chahiye, aur transactions. Alag vector DB mein sync aur permission problem aati.
- **Q: CHECK constraints kyun jab Python mein validation hai?** A: Defense in depth - koi bug ya manual SQL bhi galat data nahi daal sakta.

## 3.5 SQLAlchemy 2.0 (async) and asyncpg

**Kya hai:** SQLAlchemy Python ka ORM + SQL toolkit. ORM = tables ko Python classes ki tarah use karna. asyncpg = Postgres ka fast async driver.

**Internal working:** `create_async_engine` connection pool banata hai. `AsyncSession` ek unit-of-work hai: `session.add(obj)` changes track karta hai, `flush()` SQL bhejta hai (IDs mil jaate hain) par commit nahi, `commit()` transaction pakka karta hai, `rollback()` cancel.

**Concepts:**
- **Declarative models with `Mapped[...]`** (`models.py`), `type_annotation_map` - `Decimal -> Numeric(12,2)`, `datetime -> timestamptz`.
- **`expire_on_commit=False`** (`session.py`) - commit ke baad objects ke attributes dobara load nahi karne padte (async mein lazy load = error).
- **`pool_pre_ping=True`** - dead connections detect.
- **`text()` raw SQL** - complex queries (ledger CTE, expense listing with `json_agg`, RAG search) ke liye, named parameters (`:uid`) se - SQL injection safe.
- **`update(...).returning(...)`** - atomic claim (`store._claim`).

**Project-specific lesson (MissingGreenlet):** Async SQLAlchemy mein `rollback()` ke baad ORM objects "expired" ho jaate hain; unka attribute padhna implicit lazy-load karta hai jo async mein `MissingGreenlet` error deta hai. Fix: `_Claimed` frozen dataclass snapshot (store.py) aur `confirm` route mein `user_id = user.id` pehle padh lena.

**`normalize_database_url`:** Neon/Supabase jaise libpq URLs (`postgresql://...?sslmode=require`) asyncpg nahi samajhta - driver `postgresql+asyncpg` karte hain aur `sslmode` ko `connect_args["ssl"]` mein move karte hain.

**Alternatives:** Raw asyncpg (zyada boilerplate), Tortoise ORM / SQLModel (kam mature for complex SQL), psycopg3 async (valid alternative).

**Interview Q&A**
- **Q: flush aur commit mein farak?** A: flush SQL database ko bhejta hai (transaction ke andar, IDs generate) - commit transaction ko permanent karta hai. `create_expense` mein flush karke expense.id liya, phir splits add, phir ek commit.
- **Q: ORM aur raw SQL dono kyun?** A: Simple CRUD ORM se readable; ledger/RAG jaise complex aggregations raw SQL mein clear aur fast. Dono parameterised.

## 3.6 Alembic (migrations)

**Kya hai:** SQLAlchemy ka migration tool - database schema changes ko versioned scripts mein rakhta hai (git for DB).

**Project migrations (`api/alembic/versions`):**

| Rev | Kya kiya |
|---|---|
| 0001 | Initial schema (users, friendships, groups, expenses, splits, settlements, notifications...) |
| 0002 | AI tables (conversations, messages, pending actions) |
| 0003 | ai_traces |
| 0004 | `ai_messages.tool_call_id` VARCHAR(100) -> TEXT (Gemini 3 long IDs bug) |
| 0005 | receipts, receipt_items, `CREATE EXTENSION vector`, documents (+ GIN, HNSW indexes), sql_examples, analytics views, `splity_analyst` role |

**Interesting detail:** asyncpg ek prepared statement mein multiple SQL commands nahi chalata, isliye 0005 mein views string ko `;` pe split karke alag `op.execute` kiya, aur role statements list mein.

**Interview Q:** "Production DB mein column change kaise karte ho?" A: Migration likho (upgrade + downgrade), staging pe test, deploy se pehle `alembic upgrade head`. `alembic check` se ensure kiya ki models aur migrations match karte hain.

## 3.7 pgvector and embeddings

**Embedding kya hai:** Text ko fixed-length numbers ki list (vector) mein badalna jahan similar meaning ke texts ke vectors paas-paas hon. Yahan 768 numbers (`EMBEDDING_DIM = 768`).

**pgvector kya hai:** Postgres extension jo `vector(768)` column type, distance operators (`<=>` cosine distance) aur ANN indexes (HNSW, IVFFlat) deta hai.

**Internal working - HNSW (simple):** Hierarchical Navigable Small World = multi-level graph. Upar ki levels pe kam nodes (highway), neeche zyada (local roads). Search upar se shuru hoke greedily paas wale node pe jaata hai, neeche utarta hai. Approximate hai (100% exact nahi) par bahut fast.

**Cosine similarity:** Do vectors ke beech angle. Same direction = similar meaning. Vectors ko unit length pe normalise karte hain (`llm._normalize`) taaki cosine sahi kaam kare jab provider dimensions truncate kare.

**Project mein use:**
- `documents.embedding Vector(768)` + index `ix_documents_embedding` (hnsw, `vector_cosine_ops`).
- `sql_examples.embedding` - text-to-SQL few-shot retrieval (`SqlExample.embedding.cosine_distance(vector)`).
- Query: `ORDER BY d.embedding <=> CAST(:vec AS vector) LIMIT :n` (rag.py `_VECTOR_SQL`).
- Embedding model: `gemini/gemini-embedding-001` with `dimensions=768` via `litellm.aembedding`.
- Tests: `fake_embedding()` - deterministic bag-of-words hash vector (no network).
- Embedding fail ho toh document bina embedding save hota hai (`vectors = [None]*n`) - full-text search phir bhi kaam karega.

**Alternatives:** Pinecone, Weaviate, Chroma, Qdrant, FAISS. Kyun nahi: extra service, data sync, aur access control alag. Scale bahut badhne pe dedicated vector DB consider kar sakte hain.

**Limitations:** HNSW build/memory cost; filter + ANN combo mein recall gir sakta hai (WHERE filter ke saath HNSW kabhi kam results deta hai) - not tuned in this project (no `ef_search` setting).

**Interview Q&A**
- **Q: HNSW vs IVFFlat?** A: HNSW better recall/speed trade-off, training ki zarurat nahi, inserts handle karta hai; IVFFlat ko lists train karni padti hain aur kam memory leta hai. Maine HNSW liya.
- **Q: 768 dimensions kyun?** A: Gemini embedding model configurable dimension deta hai; 768 storage aur quality ka balance hai. Change karna ho toh column aur re-index dono badalne padenge.
- **Follow-up: Embedding provider down ho toh?** A: Indexing text save karta hai (no vector); search mein vector step skip hota hai aur sirf full-text results aate hain (graceful degradation in `rag.search`).

## 3.8 PostgreSQL full-text search

**Kya hai:** Text ko tokens (lexemes) mein todke `tsvector` banana aur query (`tsquery`) se match karna; `ts_rank_cd` relevance score.

**Project mein:** `documents.tsv` generated column `to_tsvector('simple', content)` + GIN index. Query: `websearch_to_tsquery('simple', :q)` (Google-style input safe parse karta hai) aur `ORDER BY ts_rank_cd(d.tsv, query) DESC`.

**`simple` config kyun:** English stemming Hinglish/naam ko bigaad sakta hai; `simple` sirf lowercase karta hai. Trade-off: "orders" aur "order" alag tokens.

**Interview Q:** "Keyword search kyun jab embeddings hain?" A: Naam, dish names, exact amounts mein keyword search precise hai; embeddings paraphrase mein. Dono milake hybrid.

## 3.9 JWT with PyJWT

**Kya hai:** JSON Web Token = `header.payload.signature`. Server secret se sign karta hai; client har request mein bhejta hai; server signature verify karke user pehchanta hai (stateless - session table nahi).

**Project mein (`core/security.py`):** HS256, payload `{"userId", "email", "iat", "exp"}`, expiry 7 din (`jwt_expires_minutes = 60*24*7`). Claim naam `userId` legacy frontend ke saath compatible. `decode_access_token` invalid/expired pe `None`, aur `userId` string hona chahiye. `deps.get_current_user` token decode karke **DB se user load** karta hai (deleted user ka token reject).

**Security notes:** Secret min 32 chars (Settings validation). Token `localStorage` mein hai (frontend) - XSS hua toh token chori ho sakta hai; alternative httpOnly cookie (not implemented). Revocation (logout pe token invalidate) implemented nahi - expiry tak valid.

**Interview Q&A**
- **Q: JWT stateless ka nuksaan?** A: Token revoke karna mushkil; solutions: short expiry + refresh token, ya denylist. Abhi 7-day token hai - improvement point.
- **Q: User ID body se kyun nahi lete?** A: Client-sent ID pe bharosa = IDOR. Identity sirf verified token se.

## 3.10 bcrypt

**Kya hai:** Password hashing algorithm, deliberately slow (cost factor), har hash mein random salt.

**Project mein:** `BCRYPT_ROUNDS = 12`. `verify_password` - agar `password_hash` null hai toh `False` (legacy Node mein aise accounts kisi bhi password se login ho jaate the). **Timing equalisation:** `users.authenticate` - user exist nahi karta toh bhi `_dummy_hash()` ke against verify karta hai taaki response time se pata na chale ki email registered hai (user enumeration defense).

**Interview Q:** "SHA-256 kyun nahi?" A: SHA fast hai - attacker GPU se billions guesses/sec. bcrypt slow + salted hai. Alternative: Argon2 (modern, memory-hard).

## 3.11 Docker and Docker Compose

**Kya hai:** Container = app + dependencies ka isolated package. Compose = multiple containers ko YAML se define/run karna.

**Project mein (`docker-compose.yml`):** Sirf DB service - image `pgvector/pgvector:pg16`, port 5432, named volume `pgdata` (data restart ke baad bhi), healthcheck `pg_isready`, aur `init-test-db.sql` mount (test database `splity_test` banata hai). API aur frontend local chalte hain (containerised nahi - not implemented).

**Interview Q:** "pgvector image kyun?" A: Plain postgres image mein vector extension nahi hota; ye image pre-installed deti hai.

## 3.12 uv and ruff

- **uv:** Rust-based Python package/project manager (pip + venv + lock ka fast replacement). Commands: `uv run pytest`, `uv run python -m evals.run`. `pyproject.toml` mein `[dependency-groups] dev`.
- **ruff:** Rust-based linter + formatter. Rules: E, F, I (imports), B (bugbear), UP (pyupgrade), ASYNC. `line-length = 120`. Per-file ignore: `evals/*` E501. `B008` ignore (FastAPI `Depends()` defaults idiomatic hai).

**Interview Q:** "ASYNC rules ne kya pakda?" A: Async function mein blocking file I/O (receipt image) - `asyncio.to_thread` se fix.

## 3.13 pytest, pytest-asyncio, httpx, Hypothesis

**Kya hain:** pytest = test runner. pytest-asyncio = async tests (`asyncio_mode = "auto"`). httpx = HTTP client (FastAPI app ko in-process call karne ke liye ASGI transport). Hypothesis = property-based testing (random inputs generate karke rule check).

**Project mein:**
- `tests/conftest.py`: `TEST_DATABASE_URL` na ho toh DB tests skip; client fixture `get_session` / `get_session_factory` override karta hai; limiters reset; `enable_background_indexing(None)` (tests mein background tasks nahi).
- `tests/unit/test_splitting.py`: Hypothesis se "shares hamesha total ke barabar" property.
- Integration: `test_auth.py`, `test_expenses.py`, `test_groups_and_access.py`, `test_ai_agent.py` (ScriptedLLM, security tests "legacy weakness" ke naam se), `test_mcp_server.py` (in-memory MCP client), `test_observability.py`.
- Result: **93 tests pass** (pytest collected count; 72 test functions, kuch parametrised/Hypothesis).

**Honest gap:** OCR, text-to-SQL, RAG, guardrails, voice ke liye dedicated unit tests nahi hain - unhe eval harness cover karta hai (aur `validate_sql` manually check kiya gaya). Improvement point.

**Interview Q:** "LLM wale code ko test kaise kiya?" A: `ScriptedLLM` - fake client jo pehle se likhe responses (tool calls/text) deta hai aur record karta hai agent ne kya bheja, kaunse tools diye. Deterministic, free, fast.

## 3.14 PyYAML and python-multipart

- **PyYAML:** eval datasets `evals/datasets/*.yaml` load karne ke liye (agent, sql, rag, redteam).
- **python-multipart:** FastAPI mein `UploadFile`/`File(...)` (receipt image, voice audio) parse karne ke liye zaruri.
