# Splity API (Python / FastAPI)

The backend for Splity: shared expenses, balances and settlements. It's the
foundation for the AI assistant (MCP tools, text-to-SQL, RAG and evals in
later phases).

## Stack
FastAPI · SQLAlchemy 2.0 (async) · asyncpg · Alembic · PostgreSQL (+ pgvector) · Pydantic v2 · PyJWT · bcrypt · pytest · Hypothesis · Ruff · uv

## Run locally
```bash
docker compose up -d db                 # from the repo root
cd api
cp .env.example .env                    # then set JWT_SECRET
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 5000
```
The React app (`frontend/`) proxies `/api` to port 5000, so it works with no frontend changes.
Interactive API docs: http://localhost:5000/docs

## Test
```bash
# Unit tests only (no database needed)
uv run pytest tests/unit

# Everything, against a disposable database (the schema is dropped and rebuilt)
TEST_DATABASE_URL=postgresql://splity:splity@localhost:5432/splity_test uv run pytest
```

## Demo data
```bash
uv run python -m scripts.seed_demo     # log in as demo@splity.app / Demo@12345
```

## AI assistant
```
React chat ──SSE──▶ /api/ai/chat ──▶ LangGraph agent ──▶ tool registry ──▶ services ──▶ Postgres
                                            │                   ▲
                                            ▼                   │
                                    LiteLLM (Gemini/…)    MCP server (Claude Desktop, Cursor…)
```
- **One tool registry** (`app/ai/tools.py`) serves the in-app agent and the MCP server.
  The tools call the same services as the REST API, so they get the same authorization.
- **No identity or IDs from the model.** Tools run as the JWT user and take names
  ("Rahul"), resolved against *your* friends and groups. Ambiguous or unknown
  names make the model ask instead of guess.
- **Confirm-to-run.** Write tools only create a pending action (stored on the server,
  owner-bound, expires after 10 minutes, runs once). It runs only via
  `POST /api/ai/actions/{id}/confirm`. After proposing, the model loses its tools.
- **Honest failures.** If the LLM is down you get an "unavailable" message, never a
  guessed action. The transcript stays valid for the next turn.
- **Model-agnostic.** Set `LLM_MODEL` to any LiteLLM model. Tests use a scripted fake LLM.

### Use Splity from Claude Desktop (MCP)
```json
{
  "mcpServers": {
    "splity": {
      "command": "uv",
      "args": ["--directory", "C:/path/to/Splity/api", "run", "python", "-m", "app.mcp_server"],
      "env": { "SPLITY_ACCESS_TOKEN": "<token from /api/auth/signin>" }
    }
  }
}
```
Read tools answer directly. Changes proposed over MCP wait for approval in the
Splity chat page, so a model can never approve its own change.

## Design notes
- **Money is integer paise.** Every split adds up to the total exactly. Equal,
  percentage (largest-remainder rounding) and custom splits are property-tested
  with Hypothesis.
- **One ledger formula** (`app/services/ledger.py`) drives every balance, so
  the REST API and the AI agent can't disagree.
- **Settlements have their own table.** They're never counted as spending.
- **Analytics use your share**, not the full bill.
- **Concurrent settlements** for the same pair are serialized with a Postgres
  advisory lock, so they can't over-pay.
- **Authorization:** identity comes only from the JWT. Expenses can only
  include friends or group members, groups are looked up by ID only, and
  non-members get 404.
