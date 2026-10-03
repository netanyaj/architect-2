# Blueprint generation (the real AI feature)

`POST /api/blueprint` takes `{projectId, prompt, attachments[], model}` and **streams** a Blueprint into the Blueprint pane, item by item. It never starts a build: the user clicks Build afterwards.

## Flow
1. **Read the inputs.** Attachments: PDFs are text-extracted server-side (first 20 pages), images captioned by the same model. A repo import passes `repo_imports.analysis`.
2. **Generate.** Call `streamObject()` from the Vercel AI SDK through `src/lib/gateway.ts` with the schema below. As each item completes, write it to `items` (`status = 'proposed'`). The client renders from Realtime on `items`, so streaming and reloads look the same.
3. **Estimate.** Price each item server-side with `estimate(item)` (below). Prices never come from the model.
4. **Validate.** Check the result for:
   - 3 to 15 items;
   - at most 5 questions, and every question names items it affects;
   - every item has `proved_when` and `source_quote`.
   On failure, retry once with the validation errors appended; then show an error state with "Try again" and "Try another model".
5. **Finish.** Write `blueprints.total_*`, `est_minutes`, `questions` and `defaults`, and add a `usage_ledger` row of kind `blueprint` (Blueprint drafting costs a little and is shown).

## Schema (zod)
```ts
import { z } from "zod";

export const Item = z.object({
  key: z.string().regex(/^[a-z0-9-]{3,40}$/),           // stable id, e.g. "last-email-thread"
  grp: z.enum(["features", "data", "integrations", "agents", "quality"]),
  title: z.string().max(60),                             // plain words, no jargon
  description: z.string().max(200),
  proved_when: z.string().max(160),                      // an observable, checkable condition
  source_quote: z.string().max(120),                     // exact words from the prompt it came from
  item_class: z.enum(ITEM_CLASSES),                      // drives the estimate (below)
  size: z.enum(["s", "m", "l"]),
  provider: z.string().optional(),                       // gmail, slack, hubspot… for integrations
  framework: z.enum(["lyzr", "crewai", "langgraph"]).optional() // agents only; default lyzr
});

export const Question = z.object({
  text: z.string().max(120),
  affects: z.array(z.string()).min(1),                   // item keys
  options: z.array(z.object({ label: z.string(), value: z.string() })).min(2).max(4),
  recommended: z.string(),                               // one of options[].value, applied by default
  blocking: z.boolean()                                  // true ONLY if the default would remove or weaken a requested item,
                                                         // or no safe default exists (e.g. which Slack workspace)
});

export const Blueprint = z.object({
  name: z.string().max(40),
  summary: z.string().max(240),
  items: z.array(Item).min(3).max(15),
  defaults: z.array(z.object({ label: z.string(), value: z.string(), alternatives: z.array(z.string()) })).max(6),
  questions: z.array(Question).max(5),
  not_in_this_version: z.array(z.object({ title: z.string(), reason: z.string() })).max(5)
});
```

## System prompt (keep in `src/server/prompts/blueprint.ts`)
```
You are Architect's planner. Turn the user's request into a Blueprint: the complete, plain-language
plan for an agentic web app. A non-technical business user will read it before anything is built.

Rules:
- Every requirement in the request must map to at least one item. Never drop something they asked for.
- Write titles a business user understands ("Last email thread per attendee", not "Gmail thread API").
- Each item has "proved_when": one observable condition an automatic check can verify.
- Quote the exact words from the request each item came from in "source_quote".
- Put each item in one group: features, data, integrations, agents, quality.
- Use recommended defaults instead of asking. Only mark a question "blocking" when its default would
  remove or weaken something the user asked for, or when there is no safe default.
- Ask at most 5 questions, and only questions whose answer changes an item.
- Put anything deliberately left out in "not_in_this_version" with the reason.
- Do not estimate cost or time; the system does that.
```

## Estimator (A-4), prototype version
`src/server/estimate.ts` is a table of item classes with seeded medians. In the product these come from metered history.

| item_class | likely credits (m) | p50–p90 range | fix rate |
|---|---|---|---|
| screen.list | 12 | 10–16 | 0.15 |
| screen.detail | 10 | 8–14 | 0.10 |
| screen.form | 12 | 10–17 | 0.20 |
| integration.read_email | 8 | 6–10 | 0.20 |
| integration.calendar | 10 | 8–12 | 0.10 |
| integration.chat_send | 12 | 10–14 | 0.10 |
| integration.crm_lookup | 11 | 9–13 | 0.25 |
| agent.summariser | 16 | 12–20 | 0.40 |
| agent.researcher | 24 | 20–28 | 0.35 |
| data.table | 9 | 7–11 | 0.05 |
| data.import | 6 | 5–9 | 0.20 |
| quality.schedule | 4 | 3–6 | 0.10 |

- **Size:** s ×0.7, m ×1.0, l ×1.5.
- **Model price factor** from `src/lib/gateway.ts` (cheaper models are below 1.0).
- **Fix allowance:** `likely × fix_rate × 0.3` is added to likely and to p90.
- **Confidence:** high if the class has ≥10 seeded builds, medium for 5–9, low below 5. The UI shows the range and "likely N", never the word "confidence".
- **Time:** about 45 s per credit-weighted unit, rounded to whole minutes.

## Demo prompts (fixtures in `tests/fixtures/prompts/`)
1. **Meeting Prep:** "Before each meeting on my calendar, send me a Slack brief with each attendee's last email thread, a summary of any attached agenda PDF, and three talking points."
2. **Lead scorer:** "Every morning, score new HubSpot leads from 0 to 100 using company size and recent activity, explain each score, and post the top 5 to #sales."
3. **Support triage:** "Classify incoming Zendesk tickets by urgency and team, draft a reply for simple ones, and escalate anything from VIP customers."

**Each fixture test asserts:**
- the schema is valid;
- every quoted phrase exists in the prompt;
- there are no blocking questions except where expected (Meeting Prep: the Slack workspace).
