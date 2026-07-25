# GOAL TRACKER — COMPLETE PROJECT BLUEPRINT

## Architecture Overview

This is a **pnpm monorepo** with two main artifacts: the React frontend (`calendar-todo`) and the Express API server (`api-server`). Shared packages live in `lib/`. The database is Neon PostgreSQL accessed via Drizzle ORM.

---

## Complete File Tree

```
/                                          ← project root
├── BLUEPRINT.md                           ← this file
├── package.json                           ← root package (workspace scripts)
├── pnpm-workspace.yaml                    ← defines workspace members
├── tsconfig.base.json                     ← shared TypeScript config
├── tsconfig.json                          ← root TypeScript config
├── replit.md                              ← project notes & user preferences
│
├── lib/                                   ← SHARED PACKAGES
│   ├── api-client-react/                  ← typed API client (used by frontend)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts                   ← setAuthTokenGetter, API fetch helpers
│   ├── api-zod/                           ← shared Zod schemas (request/response types)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts                   ← SaveStateBody, etc.
│   └── db/                                ← database schema + Drizzle client
│       ├── package.json
│       ├── tsconfig.json
│       ├── drizzle.config.ts
│       └── src/
│           ├── index.ts                   ← exports: db, all tables
│           └── schema.ts                  ← Drizzle table definitions (see below)
│
├── scripts/                               ← utility scripts
│   └── post-merge-setup.sh                ← runs after task-agent merges
│
├── artifacts/                             ← DEPLOYABLE ARTIFACTS
│   │
│   ├── api-server/                        ← EXPRESS BACKEND (port 8080)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── build.mjs                      ← esbuild production bundler
│   │   ├── dist/                          ← compiled output (do not edit)
│   │   └── src/
│   │       ├── index.ts                   ← server entry point
│   │       ├── app.ts                     ← Express app setup, middleware, routes
│   │       ├── lib/
│   │       │   ├── auth.ts                ← Google OAuth (Passport.js), sessions
│   │       │   ├── authStorage.ts         ← user CRUD (create/find by Google ID)
│   │       │   ├── azureOcr.ts            ← Azure Cognitive Services OCR
│   │       │   ├── logger.ts              ← Pino structured logger
│   │       │   ├── objectAcl.ts           ← ownership enforcement for object storage
│   │       │   └── objectStorage.ts       ← Replit Object Storage wrapper
│   │       ├── middlewares/
│   │       │   └── requireAuth.ts         ← auth middleware: session > Bearer UUID
│   │       └── routes/
│   │           ├── index.ts               ← mounts all route handlers
│   │           ├── state.ts               ← GET/PUT /api/state  (user data sync)
│   │           ├── informed.ts            ← POST /api/informed  (Claude chat)
│   │           ├── assistant.ts           ← POST /api/assistant (quick AI)
│   │           ├── documents.ts           ← CRUD /api/documents (user docs)
│   │           ├── projects.ts            ← CRUD /api/projects
│   │           ├── ocr.ts                 ← POST /api/ocr (image → text)
│   │           ├── voice.ts               ← POST /api/voice (audio → text)
│   │           ├── psychology.ts          ← POST /api/psychology
│   │           ├── storage.ts             ← object storage proxy routes
│   │           ├── health.ts              ← GET /api/health
│   │           └── testSecrets.ts         ← dev-only secret checks
│   │
│   └── calendar-todo/                     ← REACT FRONTEND (port 21916)
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts                 ← Vite build config
│       ├── components.json                ← shadcn/ui config
│       ├── index.html                     ← HTML entry
│       ├── public/                        ← static assets (icons, manifest)
│       └── src/
│           ├── main.tsx                   ← React entry point
│           ├── App.tsx                    ← router, auth sync, query client
│           ├── index.css                  ← global styles (Tailwind)
│           ├── components/                ← reusable UI components
│           │   ├── AppLayout.tsx          ← sidebar nav, page shell
│           │   ├── TaskRow.tsx            ← single task row with controls
│           │   ├── AddTaskDialog.tsx      ← new task modal
│           │   ├── AddRuleDialog.tsx      ← new standing rule modal
│           │   ├── CompletionControl.tsx  ← checkbox / completion UI
│           │   ├── DocumentTextButton.tsx ← attach doc to task
│           │   ├── ImageOcrButton.tsx     ← upload image for OCR
│           │   ├── RestoreDataDialog.tsx  ← data recovery UI
│           │   ├── VoiceCapture.tsx       ← voice dictation component
│           │   └── ui/                    ← shadcn base components (50+ files)
│           ├── hooks/
│           │   ├── use-mobile.tsx
│           │   └── use-toast.ts
│           ├── lib/
│           │   ├── storage.ts             ← CORE: Zustand store, localStorage,
│           │   │                            DB sync (syncDevice / syncUser)
│           │   ├── types.ts               ← Task, Rule, JournalEntry, etc.
│           │   ├── useAuth.ts             ← useAuth() hook → /api/auth/user
│           │   ├── assistantContext.ts    ← buildAssistantContext() for Claude
│           │   ├── analytics.ts           ← completion rate calculations
│           │   ├── periods.ts             ← daily/weekly/long-term grouping
│           │   ├── recurrence.ts          ← recurring task expansion
│           │   ├── seed.ts                ← first-run demo data
│           │   ├── utils.ts               ← cn(), date helpers
│           │   ├── useServerSync.ts       ← sync status hooks
│           │   └── viewDate.ts            ← current view date atom
│           └── pages/
│               ├── DayView.tsx            ← / (today's tasks, default view)
│               ├── AllTasks.tsx           ← /all
│               ├── Upcoming.tsx           ← /upcoming
│               ├── Goals.tsx              ← /goals
│               ├── Analytics.tsx          ← /analytics
│               ├── Journal.tsx            ← /journal
│               ├── Mind.tsx               ← /mind
│               ├── Assistant.tsx          ← /assistant (quick AI)
│               ├── Documents.tsx          ← /documents
│               ├── ProjectsList.tsx       ← /projects
│               ├── ProjectDetail.tsx      ← /projects/:id
│               ├── Informed.tsx           ← /informed (Claude with full context)
│               ├── Rules.tsx              ← /commands (standing rules)
│               ├── AdminPage.tsx          ← /admin (visit stats)
│               ├── AuthPages.tsx          ← sign-in page
│               ├── Landing.tsx            ← marketing landing
│               └── not-found.tsx          ← 404
```

---

## Database Schema (`lib/db/src/schema.ts`)

```
users                   ← Google OAuth users
  id          serial PK
  username    text
  email       text
  displayName text
  googleId    text
  createdAt   timestamp

user_state              ← serialized app state per user (tasks, rules, journal)
  userId      text PK   ← Google user ID ("1") or device UUID
  data        jsonb     ← { tasks[], completions[], journal[], rules[], seeded }
  updatedAt   timestamp

user_sessions           ← connect-pg-simple session store
  sid         varchar PK
  sess        json
  expire      timestamp

informed_conversations  ← Informed chat conversation list
  id          uuid PK
  userId      text
  title       text
  createdAt   timestamp
  updatedAt   timestamp

informed_messages       ← Informed chat messages
  id          uuid PK
  conversationId uuid FK
  role        text      ← "user" | "assistant"
  content     text
  images      jsonb
  createdAt   timestamp

documents               ← uploaded user documents
  id          uuid PK
  userId      text
  name        text
  mimeType    text
  extractedText text
  objectPath  text
  createdAt   timestamp

projects                ← user projects
  id          uuid PK
  userId      text
  name        text
  description text
  createdAt   timestamp
  updatedAt   timestamp
```

---

## Auth Flow

```
Browser Request
     │
     ├─ Has Passport session cookie?  ──YES──► req.userId = Google user ID ("1")
     │                                          (works in production / full tab)
     │
     └─ No session cookie             ──────► Check Authorization: Bearer <token>
              │
              ├─ Valid device UUID?   ──YES──► req.userId = device UUID
              │                                (works in workspace iframe)
              │
              └─ No token            ──────► 401 Unauthorized
```

**Frontend (`App.tsx`):**
- Always sends `Authorization: Bearer <deviceId>` (stable UUID from localStorage)
- On Google login: calls `syncUser(googleId)` → loads state from DB under Google ID
- On anonymous: calls `syncDevice()` → loads state from DB under device UUID

---

## State Sync Flow

```
App loads
   │
   └─ syncUser("1") or syncDevice()
         │
         ├─ fetchServerState() → GET /api/state → DB row for userId
         ├─ Compare with localStorage cache
         ├─ Pick richest (most tasks)
         └─ persist() → localStorage + schedule PUT /api/state (debounced 3s)

User edits task
   └─ useStore().addTask() → Zustand state update → persist() → DB save
```

---

## Informed Chat — Context Pipeline

```
User sends message in /informed
        │
        ▼
Frontend builds context:
  assistantContext.ts → buildAssistantContext()
    - tasks (all, with completion rates)
    - standing rules
    - journal entries
    - projects
    - documents (titles)
        │
        ▼
POST /api/informed  { message, conversationId, context, images, documents }
        │
        ▼
informed.ts → buildTaskContext(context)
    - formats tasks by timeframe
    - calculates follow-through rates
    - lists standing rules
    - lists journal entries
        │
        ▼
Claude system prompt:
  "You are an AI with complete knowledge of this user's life, goals, and projects..."
  + full task/rule/journal context (up to 8000 chars)
  + conversation history
        │
        ▼
Streaming response → Informed chat UI
```

---

## Environment Variables (secrets)

| Variable | Used For |
|---|---|
| `NEON_DATABASE_URL` | PostgreSQL connection |
| `GOOGLE_LOGIN_CLIENT_ID` | Google OAuth |
| `GOOGLE_LOGIN_CLIENT_SECRET` | Google OAuth |
| `SESSION_SECRET` | Express session signing |
| `ASSEMBLYAI_API_KEY` | Voice transcription |
| `AZURE_COGNITIVE_KEY` | OCR |
| `AZURE_COGNITIVE_ENDPOINT` | OCR |
| `ELEVENLABS_API_KEY` | Text-to-speech |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | File storage |

---

## Key Design Decisions

1. **Dual auth**: session cookie (Google, production) + Bearer device UUID (iframe/anonymous) — backend prefers session when present
2. **State under Google ID**: `user_state.userId = "1"` holds 450KB of task history; device UUID rows are empty fallbacks
3. **No documents uploaded yet**: `documents` table is empty for user "1" — document context in Informed will be blank until docs are uploaded via the Documents page
4. **Informed context comes from the frontend store** — if the store hasn't synced from DB, Claude sees nothing; fixing auth sync fixes context
