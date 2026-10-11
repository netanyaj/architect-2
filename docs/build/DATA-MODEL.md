# Data model

The schema is `supabase/migrations/0001_init.sql`. Everything belongs to a **workspace**; a **project** has numbered **Blueprint** versions; each version has **items**.

```
workspace ─┬─ members (owner · admin · builder · viewer)
           ├─ connections, policies, approvals, audit_log, usage_ledger, agents
           └─ project ─┬─ blueprints (v1, v2…) ─┬─ items ─┬─ checks ── proofs
                       │                        ├─ questions        (attempt 0..3)
                       │                        └─ defaults
                       ├─ runs ── events  (Realtime)
                       ├─ messages ── change_proposals
                       ├─ files, environments, deployments, repo_imports
```

## Rules the code must enforce
1. **The Build gate.** A run of kind `build` or `change` is created only by a server action triggered by a user click. `runs.started_by` is never null, and `blueprints.agreed_at` is set in the same transaction. The action refuses when:
   - any `questions.blocking = true` has no `answer`;
   - the user can't build (`can_build()`);
   - the run's estimate would exceed the project budget.
2. **Item keys are stable across versions.** A new version copies items by `key`. Statuses of unchanged built items carry over; changed items go back to `agreed`. Compare-versions is a diff on `key`.
3. **Conflict guard.** An item can't leave a version silently. Removing or weakening one needs a `change_proposals.conflict` decision (Keep / Defer / Drop with reason). Dropped items stay, with `status = 'dropped'` and a `drop_reason`.
4. **Checks before code.** For each item, `checks.written_at` must be earlier than its first `item.building` event. The builder never edits a check (`locked`).
5. **Built ✓ needs proof.** `items.status = 'built'` only with a passing `proofs` row attached.
6. **Fix loop.**
   - Each fix is a `proofs.attempt` from 1 to 3 plus a `usage_ledger` row of kind `fix`.
   - After attempt 3 fails, the item becomes `paused` and the run `paused_item`.
7. **Budgets.** Before each simulated step, check spend plus the next step against `projects.budget_credits`. If it would be exceeded, the run goes to `paused_budget` and finished items stay.
8. **Readiness** = built items / items not in (`deferred`, `dropped`). Shown as "N of M parts work" in the Plan panel and the stepper.
9. **Audit.** Every approval decision, deploy, policy change and role change writes an `audit_log` row.

## Item statuses (UI mapping)
| `items.status` | Chip | Token | Icon |
|---|---|---|---|
| proposed | (none: grey dot, in the plan) | `ink-2` outline | dot |
| agreed | (none: grey dot) | `ink-2` outline | dot |
| building | "Building now" (In progress group) | `building` | spinner |
| built | quiet check only (Works group) | `works` | check |
| sample_data | "using sample data" on the part; Launch checklist | `attention` | lines |
| needs_connection | Needs you card: "Connect …" | `attention` | plug |
| needs_approval | Needs you card: "… is waiting for IT" | `approval` | lock |
| failed | "A check failed (…). Fixing it, try n of 3." | `failed` | ! |
| paused | **Blocked**, reason on the next line | neutral `ink` | pause |
| deferred | "Set aside" (Up next, muted) | `ink-2` | pause |
| dropped | struck through in the plan | `ink-3` | minus |

## Seed data (`supabase/seed.sql`, write in M1)
- One workspace, "Acme Ops", with governance on. The demo user is Owner; "Sam" is Builder; "Jordan (IT)" is Admin.
- Projects:
  - **Meeting Prep** (live, 12/12);
  - **ticket-triage** (5/6, needs approval);
  - **Lead scorer** (paused at budget, 4/7);
  - **Vendor tracker** (draft).
- Connections: Google Calendar and Slack connected; Gmail missing; HubSpot not allowed by policy.
- Policies:
  - location: Lyzr Cloud;
  - models: Claude, GPT, Gemini and OpenRouter (free models) allowed;
  - connectors: allow list without HubSpot;
  - egress: allow list;
  - permission: push to main and Production deploy need approval.
- Approvals waiting: HubSpot connector, ticket-triage Production deploy, Claude Code token.
