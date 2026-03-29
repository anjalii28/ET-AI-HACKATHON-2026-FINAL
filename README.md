# Call Intelligence — ET AI Hackathon 2026

A full-stack **call analytics and operations** workspace: process call JSON, extract entities with AI, prioritize work in a **React dashboard**, connect **Twenty CRM** and **Chatwoot**, and run **Review Intelligence** (Google reviews + sentiment analysis) via a dedicated NestJS service.

---

## What’s in this repository

| Area | Role |
|------|------|
| **Python pipeline** | Batch transcription/entity extraction (`extract_entities.py`, `process_audio_batch.py`, helpers) |
| **Dashboard** (`dashboard/`) | Vite + React + TypeScript UI: calls, leads, tickets, feedback |
| **Reviews service** (`reviews-service/`) | NestJS API: ingest reviews, Gemini insights, optional Chatwoot tickets |
| **Ops** | Shell helpers (`start-all-services.sh`, nginx example, etc.) |

> **Commit history:** Features were added in logical steps (pipeline → extraction → CRM → Chatwoot → reviews → dashboard → fixes). Clone the repo and run `git log --oneline` to follow the build narrative.

---

## Prerequisites

- **Node.js** 18+ and npm  
- **Python** 3.10+ (for the audio/entity pipeline)  
- **PostgreSQL** (for `reviews-service`; local user/db per `.env`)  
- Optional: **Google AI (Gemini)** and **Google Places** API keys for live review analysis and Places fetch  

---

## Quick start (local development)

### 1. Clone

```bash
git clone https://github.com/anjalii28/ET-AI-HACKATHON-2026.git
cd ET-AI-HACKATHON-2026
```

### 2. Python environment (call processing & scripts)

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Copy `.env` at the repo root if your scripts expect API keys (see project scripts you use). Generated call JSON is typically read from `output/` (configure paths in the relevant script).

### 3. Dashboard (frontend)

```bash
cd dashboard
npm install
```

Create **`dashboard/.env.local`** (not committed) for embedded apps:

```bash
# Optional — defaults shown in src/config.ts if unset
VITE_CHATWOOT_URL=http://localhost:3001
VITE_CHATWOOT_OPEN_URL=http://localhost:3001/app/accounts/1/inbox
VITE_TWENTY_URL=http://localhost:3002
```

```bash
npm run dev
```

Open **http://localhost:5173/app/** (Vite `base` is `/app/`).

### 4. Reviews service (backend for Feedback / Review Intelligence)

```bash
cd reviews-service
npm install
cp .env.example .env
# Edit .env: DB_*, GEMINI_API_KEY, GOOGLE_PLACES_API_KEY (if using API mode), PORT=3003
```

Create the database (example for local Postgres user matching your OS user on macOS):

```bash
createdb chatwoot   # or the DB name in DB_NAME
```

```bash
npm run start:dev
```

The dashboard proxies **`/reviews`** → `http://127.0.0.1:3003` in `vite.config.ts`, so with both processes running, **Feedback** works without extra nginx.

### 5. Optional: Playwright (scrape mode for reviews)

If `REVIEWS_MODE=scrape` in `reviews-service/.env`:

```bash
cd reviews-service
npx playwright install chromium
```

---

## Environment variables (cheat sheet)

### `reviews-service/.env` (from `.env.example`)

| Variable | Purpose |
|----------|---------|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | PostgreSQL connection |
| `REVIEWS_MODE` | `api` (Places API) or `scrape` (Playwright) |
| `GOOGLE_PLACES_API_KEY` | Required when `REVIEWS_MODE=api` |
| `GEMINI_API_KEY` | Required for AI summaries and aggregate insights |
| `PORT` | Default `3003` |
| `CHATWOOT_*` | Optional: push negative reviews to Chatwoot |

### Dashboard `VITE_*`

Used for iframe / links to **Chatwoot** and **Twenty**; see `dashboard/src/config.ts`.

---

## Useful commands

| Task | Command |
|------|---------|
| Dashboard dev server | `cd dashboard && npm run dev` |
| Dashboard production build | `cd dashboard && npm run build` |
| Reviews API (watch) | `cd reviews-service && npm run start:dev` |
| Repo helper scripts | `./start-all-services.sh` (if present; adjust paths for your machine) |

---

## Project layout (high level)

```
├── dashboard/              # React app (Vite)
├── reviews-service/        # NestJS + TypeORM + Postgres
├── extract_entities.py     # Entity extraction from transcripts
├── process_audio_batch.py  # Audio batch processing (when used)
├── requirements.txt        # Python deps for pipeline scripts
├── nginx.conf              # Example reverse-proxy layout (optional)
└── README.md
```

---

## Development journey

- Built a **transcription and batch processing** path for call audio and JSON.  
- Added **structured extraction** for entities, priorities, and prescriptions.  
- Integrated **Twenty CRM** for lead and pipeline views in the dashboard.  
- Integrated **Chatwoot** for tickets and embedded conversation handling.  
- Implemented **review intelligence** (ingestion, sentiment, themes, executive summary).  
- Added **routing and ops** scripts (nginx, start/stop helpers).  
- Refined the **dashboard** for prioritization and insights, and tightened validation and edge cases.  

---

## License / attribution

Submitted as part of **ET AI Hackathon 2026**. Use and modify per your team’s and the hackathon’s rules.
