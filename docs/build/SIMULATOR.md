# Build simulator

The prototype doesn't generate code. When the user clicks **Build**, the simulator plays a believable build over the **real** Blueprint items, so every screen state (Building, Built ✓ with proof, fixes, Needs connection, Sample data, pauses) appears in the same order a real orchestrator would produce it. Everything it drives carries the `Simulated` tag.

## How it works (serverless-friendly)
1. **Build click** → server action `startRun(projectId, blueprintVersion)`:
   - checks the Build gate (`docs/build/DATA-MODEL.md`, rule 1);
   - creates a `runs` row;
   - **computes the whole timeline up front** from the scenario rules and the items;
   - inserts every event into `events` with `payload.at_ms` (its offset from `runs.started_at`).
   Nothing long-running happens on Vercel.
2. **Clients replay** the timeline:
   - The workspace loads the run's events, then shows each one when `started_at + at_ms <= now`, using timers.
   - A reload or a second viewer computes the same state from the clock, so everyone sees the same thing.
   - Realtime on `events` delivers events added later (user actions, new runs).
3. **Settling.** When the timeline's last event is due, the first client to see it calls `settleRun(runId)`. Settling is idempotent: it writes final item statuses, `proofs`, `usage_ledger` rows and `runs.status`. Any later page load also settles overdue runs.
4. **User actions start new short runs**, again only on a click:
   - Connect → the item rebuilds;
   - Apply a change → a `change` run;
   - Try 1 more fix, or Raise budget and continue.

Determinism: the timeline is seeded with `hash(runId)`, so durations and costs differ by run but replay identically.

## Event types (`events.type`)
| Type | Payload | UI effect |
|---|---|---|
| `run.started` | `{at_ms, total_items, est_minutes}` | Header switches to progress |
| `check.written` | `{item_key, kind, description}` | Proof strip: "written by the verifier at …, before code" |
| `item.building` | `{item_key}` | Spinner and chip |
| `log.line` | `{actor, actor_label, verb, object}` | ActivityLine in the conversation |
| `item.built` | `{item_key, assertions:[n,m], screenshot, credits}` | Check icon; proof attached; readiness +1 |
| `item.failed` | `{item_key, attempt, reason, measured}` | Failed check · reason |
| `item.fixing` | `{item_key, attempt, credits}` | "Fixing n/3"; a Usage `fix` line |
| `item.needs_connection` | `{item_key, provider}` | Chip and inline Connect; build carries on |
| `item.sample_data` | `{item_key, reason}` | Dashed chip and preview banner |
| `item.needs_approval` | `{item_key, approval_id}` | Chip, "IT admin reviews"; creates an `approvals` row |
| `item.paused` | `{item_key, attempts:[…]}` | Screen 6 state |
| `run.progress` | `{done, total, eta_s}` | "Building 7 of 12 · about 6 min left" |
| `run.paused_budget` | `{used, budget, remaining_items, remaining_est}` | Screen 7 state |
| `preview.updated` | `{path}` | Preview iframe reloads at that path |
| `run.done` | `{proven, total}` | Stepper shows "Launch"; the Plan panel shows N of M parts work |

## Scenario rules
`sim/scenarios/meeting-prep.json` holds the rules. They match the **real** items by group and keywords, so an unexpected Blueprint still gets a sensible story:
- **Integration items** that need a user account the workspace hasn't connected → `needs_connection`.
- **Items naming a provider that policy doesn't allow** → `needs_approval`.
- **Data items about history or archives** → `sample_data`.
- **The last agent item** → fails once, then passes on fix 1. With `"demo": "paused"`, it fails all 3 attempts instead.
- **Everything else** → passes.
- **Timing:** `base_ms` × an item-size factor, ±20% seeded jitter. The whole run takes about 90 s for the demo, with `speed` adjustable from `?sim=fast`.
- **Costs:** the actual is the item's `estimate_likely` × a seeded factor between 0.85 and 1.15. Each fix costs 2–3 credits.

## Deploys
Sharing with the team (`staging`) and going live (`production`) are simulated deploys, one `deployments` row each. Every deploy runs four steps, recorded in `deployments.checks.steps`: **Build → Database changes → Web address → Health check**.
- **Success:** the new row is `live`; the row it replaces becomes `rolled_back` (kept for Go back), and the environment's address is updated (a secured custom domain wins).
- **Failure (`?sim=deployfail` on the Launch page):** the health check fails ("The new version didn't answer within 30 seconds"). The new row is `failed` with `checks.failure = {step, reason}`; the version before stays `live`, so nothing changes for people using it. Launch shows what failed, that the previous version is still running, and Try again · Ask a person. Nothing is charged.
- **Custom domains:** enter the domain → add the CNAME (`cname.architect.app`) → Checking (about 4 s, simulated) → Secured (HTTPS). Per environment, stored in `projects.launch_settings.domains`.
- **Governance off** (Settings): Test → Go live in one deploy, with the team version optional and no approval.

## Preview app
`public/preview/meeting-prep/` is a small static app (Today, This week, All briefs, Attendees, Settings) served in the preview iframe at `/preview/meeting-prep/today`. Each `preview.updated` reveals more of it (sections fade in as their items are built). The selected item's section is outlined via `postMessage({type:'highlight', key})`. Select element sends `postMessage({type:'select', selector, text})` back to the workspace, which attaches it to the composer.
