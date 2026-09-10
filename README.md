# SpendSavvy - Production-Grade AI-Powered Expense Sharing & Settlement Platform

SpendSavvy is an intelligent, secure, and collaborative expense splitting and social finance management application built with **React (Vite)**, **Node.js/Express**, **Model Context Protocol (MCP)**, **LangChain + Google Gemini AI**, and **PostgreSQL (Neon/Supabase)**.

---

## 🏗️ Architecture

SpendSavvy follows a decoupled 3-tier architecture with dedicated `frontend/`, `backend/`, and `mcp/` packages:

```text
SpendSavvy/
├── frontend/             # React 19 + Vite SPA (Port 5173)
│   ├── src/
│   │   ├── components/   # UI components, dashboard cards, rich markdown chat renderer
│   │   ├── pages/        # Dashboard, Friends, Groups, Expenses, Bills/OCR, Insights, Chat, Notifications, Parent Monitoring
│   │   ├── layouts/      # MainLayout, navigation & responsive sidebar
│   │   ├── services/     # API client handlers (`api.js` with Bearer JWT interceptors)
│   │   ├── context/      # AuthContext provider (JWT session & user profile)
│   │   ├── App.jsx       # React Router DOM routing
│   │   └── main.jsx      # Vite React entry point
│   ├── package.json
│   └── vite.config.js
│
├── backend/              # Express REST API & AI Orchestration Server (Port 5000)
│   ├── ai/               # LangChain configuration & SpendSavvyMcpAgent (Gemini tool calling & fallbacks)
│   ├── mcp/              # SpendSavvyMcpClient (Stdio client bridge with strict identity injection)
│   ├── config/           # PostgreSQL pool, Cloudinary, and JWT configuration
│   ├── database/         # Schema migrations, indexes, and initialization (`initializeDatabase`)
│   ├── controllers/      # Route controllers (auth, users, friends, groups, expenses, settlements, bills, AI)
│   ├── services/         # Canonical business logic layer (single source of truth)
│   ├── middlewares/      # Strict Bearer JWT auth, rate limiting, error handling
│   ├── routes/           # REST endpoints (`/api/*`)
│   ├── tests/            # Integration & safety test suites (Security, MCP, Splitting, Settlement)
│   ├── uploads/          # Local static storage for uploaded bills (`/uploads/bills`)
│   ├── app.js            # Express app configuration (CORS, Helmet, Rate Limiters)
│   ├── server.js         # HTTP server entry listener
│   └── package.json
│
└── mcp/                  # Standalone Model Context Protocol Server
    ├── server.js         # Stdio MCP Server defining 22 tools with input validation & IDOR protection
    └── package.json
```

---

## ⚡ Tech Stack

- **Frontend**: React 19, Vite, React Router DOM, Tailwind CSS, Lucide React, Framer Motion
- **Backend API**: Node.js (ES Modules), Express.js, PostgreSQL (Neon / Supabase), Helmet, `express-rate-limit`, Bcrypt, JWT
- **AI & MCP Layer**: `@modelcontextprotocol/sdk` (Stdio Transport), `@langchain/core`, `@google/genai`, Gemini 3.6 / 3.7 Flash
- **Image & Receipt Processing**: Cloudinary SDK, Tesseract.js OCR, Gemini Vision
- **Messaging & Alerts**: Nodemailer

---

## 🛡️ Key Features & Engineering Highlights

### 1. AI Assistant & Model Context Protocol (MCP)
- **22 Production MCP Tools**: Covers expenses, debts, group analytics, balance queries, settlements, and notifications.
- **Two-Phase Write Confirmation**: All mutating operations (`create_expense_with_split`, `settle_up`, `create_group`, `add_friend`, etc.) require explicit user confirmation before writing to the database. Read-only tools execute unhindered.
- **Strict Identity & Authorization Boundary**: The MCP client automatically injects the authenticated `userId` from the verified JWT into all tool calls—preventing LLM impersonation or IDOR attempts.
- **No Hallucinated Financial Defaults**: The system never guesses or defaults amounts (e.g., ₹50) or participants. If required data is missing, the agent asks clarifying questions.
- **Modification Detection**: Modifying a request (e.g. *"Actually make it $80"*) invalidates previous confirmations and generates a new review payload.

### 2. Expense Splitting Engine
- **Equal & Custom Splits**: Supports equal division or custom per-participant allocations.
- **Cent Precision**: Uses integer cents internally to eliminate floating-point rounding errors and safely distributes leftover cents to the payer.
- **Single-Query Balance Aggregations**: Uses PostgreSQL CTE queries with optimized composite indexes for high-speed balance and debt computation without N+1 queries.

### 3. Unified Settlement Flow
- **Single Source of Truth**: REST endpoints (`POST /api/expenses/settle`) and MCP AI tools (`settle_up`) execute the exact same canonical `settleDebt()` service in ACID transactions.
- **Validation**: Rejects over-settlements, negative amounts, and self-settlements.

### 4. Security & Hardening
- **Authentication**: Strict Bearer JWT token verification across all private endpoints.
- **Rate Limiting**: Dedicated rate limiters for login attempts (10 req / 15 min) and AI queries (30 req / min).
- **IDOR Protection**: Group details, expenses, messages, and child monitoring are verified for membership and ownership before returning data.
- **Sanitized Errors**: Internal SQL errors and stack traces are suppressed from user responses.

---

## 🚀 Getting Started

### 1. Environment Configuration

Create a `.env.local` or `backend/.env` file with:

```env
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/expense_splitter
# or Neon / Supabase cloud database URL:
# NEON_DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require

# AI & LLM
GEMINI_API_KEY=your_gemini_api_key

# Authentication
JWT_SECRET=your_super_secret_jwt_key_at_least_32_characters

# Cloudinary (Optional - local filesystem fallback included)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Email Alerts (Optional)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_email_app_password

# Server Ports
PORT=5000
FRONTEND_URL=http://localhost:5173
```

### 2. Install Dependencies

```bash
npm install
npm --prefix backend install
npm --prefix frontend install
npm --prefix mcp install
```

### 3. Run the Development Servers

Start the backend and frontend concurrently:

```bash
npm run dev
```

Or run individual components:

- **Frontend (Vite)**: `npm run dev:frontend` → [http://localhost:5173](http://localhost:5173)
- **Backend (API)**: `npm run dev:backend` → [http://localhost:5000](http://localhost:5000)
- **MCP Server**: Spawned automatically as a Stdio sub-process by the backend client, or run via `npm run dev:mcp`.

---

## 🧪 Running Test Suites

SpendSavvy includes automated test suites covering all major system boundaries:

```bash
# Run MCP & AI Agent Safety & Confirmation Tests
node backend/tests/mcpSafetyTest.js

# Run MCP Agent Conversational & Fallback Tests
node backend/tests/mcpAgentTest.js

# Run Security, Authentication & IDOR Hardening Tests (33 tests)
node backend/tests/securityHardeningTest.js

# Run Expense Splitting & Precision Tests
node backend/tests/expenseSplittingTest.js

# Run Settlement Service Consistency Tests
node backend/tests/settlementServiceTest.js
```

---

## 📄 License

MIT License. Built for seamless and intelligent group financial collaboration.
