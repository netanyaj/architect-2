# Ticket Triage (repo for import testing)

A small support-ticket triage tool. Support agents see incoming tickets, and an AI triage step suggests a priority (P1–P3) and a team.

**Fictional sample project. Not production code.**

## Stack
- **Frontend:** React 18 + Vite (`client/`)
- **API:** Node.js + Express (`server/`), with tickets stored in `data/tickets.json`
- **Triage agent:** Python + CrewAI (`agents/triage_agent.py`). Not wired to the API yet; the API uses a rule-based fallback.
- **Tests:** Node's built-in test runner (`tests/`)

## Run locally
```bash
npm install
cp .env.example .env      # optional: add OPENAI_API_KEY for AI triage
npm run dev               # API on :4000, client on :5173
npm test
```

## Environment variables
| Name | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | optional | Enables AI triage in the API; falls back to rules without it |
| `SLACK_WEBHOOK_URL` | optional | Posts P1 tickets to Slack |
| `PORT` | optional | API port (default 4000) |

## Known issues
- The "Only P1" filter in the UI shows all tickets (bug).
- The CrewAI agent in `agents/` is not connected to the API.
