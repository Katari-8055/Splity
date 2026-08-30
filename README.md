# SpendSavvy - AI-Powered Expense Sharing Application

An intelligent expense splitting application using Model Context Protocol (MCP), LLM orchestration (Gemini), and Neon PostgreSQL.

Refactored into a decoupled 3-tier JavaScript architecture with dedicated `frontend/`, `backend/`, and `mcp/` packages.

---

## 🏗️ Architecture

```text
bit_mesra/
├── frontend/             # Standalone React.js (Vite) App
│   ├── src/
│   │   ├── components/   # UI, Dashboard, Analytics, Chat components
│   │   ├── pages/        # Dashboard, Friends, Groups, Expenses, Bills, Insights, Chat, Notifications, Parent Monitoring
│   │   ├── layouts/      # MainLayout navigation & responsive sidebar
│   │   ├── services/     # API Client handlers (`fetchAPI`)
│   │   ├── context/      # AuthContext session provider
│   │   ├── App.jsx       # React Router DOM configuration
│   │   └── main.jsx     # Entry point
│   ├── package.json
│   └── vite.config.js
│
├── backend/              # Standalone Express REST API Server
│   ├── config/           # Neon PostgreSQL Pool & dotenv configuration
│   ├── database/         # Database schema initialization (`initializeDatabase`)
│   ├── controllers/      # Express request/response handlers
│   ├── services/         # Core business logic (users, friends, groups, expenses, bills, OCR, notifications, AI)
│   ├── routes/           # REST endpoint definitions (`/api/*`)
│   ├── middlewares/      # Auth token, file upload, error handling
│   ├── uploads/          # Local static upload storage
│   ├── app.js            # Express app configuration
│   ├── server.js         # Entry listener (Port 5000)
│   └── package.json
│
└── mcp/                  # Standalone MCP Server
    ├── server.js         # Stdio MCP Server handling tool execution
    └── package.json
```

---

## ⚡ Tech Stack

- **Frontend**: React 19, Vite, React Router DOM, Tailwind CSS, Lucide React, Framer Motion
- **Backend**: Node.js, Express.js, PostgreSQL / Neon, Nodemailer, Tesseract OCR, Google Generative AI (Gemini)
- **MCP Server**: `@modelcontextprotocol/sdk` Stdio Server

---

## 🚀 Quick Start

### 1. Environment Setup

Create a `.env.local` or `.env` file in the root directory:

```env
NEON_DATABASE_URL=postgresql://username:password@ep-xxx-xxx.aws.neon.tech/dbname?sslmode=require
DATABASE_URL=postgresql://username:password@ep-xxx-xxx.aws.neon.tech/dbname?sslmode=require
GEMINI_API_KEY=your_gemini_api_key
JWT_SECRET=your_jwt_secret_key
EMAIL_USER=your_gmail_user@gmail.com
EMAIL_PASS=your_gmail_app_password
PORT=5000
```

### 2. Install All Dependencies

```bash
npm install
npm --prefix backend install
npm --prefix frontend install
npm --prefix mcp install
```

### 3. Run Development Servers

Start backend, frontend, and MCP server concurrently:

```bash
npm run dev
```

Or run services individually:

- **Backend**: `npm run dev:backend` (Listening on `http://localhost:5000`)
- **Frontend**: `npm run dev:frontend` (Listening on `http://localhost:3000`)
- **MCP Server**: `npm run dev:mcp` (Stdio transport)

---

## 🛠️ Features Overview

- 🤖 **AI Chatbot & Split Assistant**: Natural language expense parsing with Gemini LLM.
- 👥 **Friend & Group Management**: Search friends with autocomplete, manage group expenses, and send in-group messages.
- 💰 **Intelligent Expense Splitting**: Equal or custom expense splits with automatic balance calculation.
- 📄 **Receipt & OCR Extraction**: Upload bill images and extract merchant name and items using Tesseract OCR.
- 📊 **Financial Insights & Analytics**: Monthly and weekly spending summaries with category breakdown.
- 👨‍👩‍👧 **Parent-Child Safety Monitoring**: Set spending thresholds for child accounts with safety notifications.
- 🔌 **MCP Tool Integration**: 19+ Model Context Protocol tools for AI agent interactions.
