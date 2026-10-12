"""The system map (editable source): every layer of Architect 2.0 in one picture, in two lenses.

  system-map-production.svg  how it works in production; numbers are the steps in ARCHITECTURE.md section 2
  system-map-prototype.svg   the same boxes, each marked REAL / PART / SIM / NOT BUILT, with the prototype piece

Layers: people, Lyzr's control plane, the boundary, a cell (services, workers and sandboxes, ways out,
stores, the built apps' runtime), Lyzr Studio, outside services. Matches ARCHITECTURE.md sections 2, 4, 9 and 10.
Run: python3 docs/product/diagrams/src/system_map.py, then node scripts/render-diagrams.mjs system-map
"""
import os

import textwrap

C = dict(
    bg="#EEEDE9", surface="#FFFFFF", tray="#F6F5F2", ink="#1A1A19", ink2="#5C5B56", line="#DDDBD4",
    cp="#EEEAFB", cp_line="#C9BEF2", dp="#E6F5F6", dp_line="#A9DCE0", st="#E8F1E6", st_line="#B7D3B0", out="#F1F0EC",
)
BADGE = {
    "real": ("REAL", "#1D6B3A", "#E3F2E8", None),
    "part": ("PART", "#9A5B00", "#FBEFD9", None),
    "sim": ("SIM", "#5C5B56", "#FFFFFF", "3 2"),
    "nb": ("NOT BUILT", "#A33A2E", "#F9E5E2", None),
}

# name, production description, what the prototype uses, badge, steps
B = {
    "people": [
        ("Builders", "Morgan: describes the app, reviews the plan, clicks Build and Launch", "The Architect web app in a browser", "real", [1, 3, 9, 10]),
        ("Developers and their coding agents", "Sam, plus Claude Code or Cursor through Architect's MCP server and CLI", "Project tokens are real records; no MCP server accepts them", "sim", [6]),
        ("Org admins", "Set where it runs, allowed models and apps, and approve Live", "Governance pages, approvals and audit log", "part", [3, 11]),
        ("People who use the built app", "Sign in to the app on its own domain", "Only the simulated preview exists", "sim", [12]),
    ],
    "cp": [
        ("CDN", "Serves the builder's front end worldwide", "Vercel's edge network", "real", [1]),
        ("API gateway", "One entry point: sign-in check, tenant routing to the right cell, rate limits", "No separate gateway: Next.js server actions and routes on Vercel (bom1)", "real", [1]),
        ("Identity and SSO", "Google, GitHub and email; Keycloak single sign-on for enterprises", "Supabase Auth: Google, GitHub, email and anonymous demo sessions. SSO itself is simulated", "real", [1]),
        ("Tenant directory", "Which workspace lives in which cell, feature flags, plans", "Workspaces and members tables with row-level security; one region, no cells", "real", [1]),
        ("Billing and credits", "Credits, plans and invoices from usage counts", "Credit ledger with real numbers; plans and payment simulated", "part", [3, 12]),
        ("Policy authoring", "Admins write org policy; pushed down to every cell", "Governance settings stored in Postgres", "part", [3]),
    ],
    "services": [
        ("Plan service and estimator", "Writes the plan: parts, checks, costs, defaults, questions; the conflict guard; versions", "Real model calls through one gateway (src/server/blueprint/)", "real", [2, 3]),
        ("Run orchestrator (Temporal)", "Durable workflows for build, fix, test and launch; resumes after a crash", "A precomputed event timeline per run, replayed on the clock", "sim", [4, 7, 11]),
        ("Realtime hub", "Pushes part status, logs and cost to the browser over a WebSocket", "Supabase Realtime on the events table", "real", [10]),
        ("Policy check and approvals", "Checked before anything leaves a sandbox: allowed by rule, sent for approval, or refused", "The app's own gates: model allow-list, budget stop, Live waits for an Owner or Admin", "part", [3, 6, 9, 11]),
        ("Audit log", "Append-only record of every run, change, approval and data access", "Audit table, insert-only, with CSV export", "real", [11, 12]),
    ],
    "work": [
        ("Architect agent workers", "Claude Agent SDK harness outside the sandbox; acts only through the daemon's tools", "Not running; the timeline stands in", "sim", [6]),
        ("Verifier workers", "Write each part's check before code, run it, attach the proof", "Checks and proofs come from the timeline", "sim", [5, 7]),
        ("Sandbox fleet (E2B microVMs)", "One per project; warm pools per image; paused after 10 idle minutes; a daemon exposes tools over MCP; no keys inside", "None. No code is written, run or deployed", "nb", [4, 6, 7]),
        ("Preview proxy", "Serves the sandbox's dev server on a separate domain, with click-to-edit and the console", "A shell drawn from the plan's parts, or the Meeting Prep sample", "sim", [10]),
    ],
    "gates": [
        ("Model gateway", "Every model call: routing by role and policy, private models, metering; failover only to pre-approved fallbacks, always announced", "Vercel AI SDK: Gemini and OpenRouter live, falls back on quota and says so; Claude and GPT with a key", "real", [2, 6]),
        ("Egress proxy and secrets vault", "Injects keys on the way out, applies the allow-list and redaction, draws the data-flow view", "Vault is real (Supabase Vault). No proxy: nothing leaves a sandbox because there is none", "part", [9]),
        ("Git executor", "Short-lived GitHub tokens per operation; branches and PRs after approval; two-way sync", "Read-only GitHub App: repos, files, the import analysis. PRs simulated", "part", [6, 11]),
    ],
    "stores": [
        ("Postgres", "Projects, plans, parts, checks, runs, policies, approvals", "Supabase Postgres (Mumbai), row-level security on every table", "real", [2, 3, 12]),
        ("Redis", "Sandbox state, sessions, realtime fan-out", "Not used", "nb", [4]),
        ("Object storage", "Files, attachments, proofs, sandbox snapshots", "Supabase Storage for uploads", "real", [1, 7]),
        ("Event log and analytics store", "Every run, model call and approval once; feeds metering, audit, metrics and the estimator", "events and analytics_events tables; Vercel Analytics for page views", "real", [10, 12]),
    ],
    "runtime": [
        ("App runtime (Kubernetes)", "Test version, Team version and Live; at least 2 copies in Live, autoscaling; image built and checked before each launch", "Launch, environments and going back are simulated", "sim", [11, 12]),
        ("Per-environment data and secrets", "Its own Postgres, bucket, secrets and URL per environment; migrations gated", "Data tab with sample tables, or your uploaded CSV", "sim", [12]),
        ("Queue and agent workers", "App agent calls wait in a queue instead of crashing the app under load", "Not built", "nb", [12]),
        ("CDN and domains", "Static assets on a CDN; custom domains with automatic TLS", "Domains shown, simulated", "sim", [11]),
    ],
    "studio": [
        ("Agent registry", "Each workspace's agents, created when their part works; edits sync both ways", "Real, in the workspace's own Studio with its own Lyzr key (one-way sync on save)", "real", [8]),
        ("Agent runtime and evals", "Runs every app's agents one way; evals over time; reuse across apps", "Try it runs on Studio for real; the built app's agents don't run", "part", [8, 12]),
    ],
    "outside": [
        ("Model providers", "Claude, GPT, Gemini, or the customer's own and self-hosted models", "Gemini and OpenRouter free models; Claude and GPT only with a key", "real", [2, 6]),
        ("GitHub", "The user's own repos and PRs", "Read-only App on chosen repos", "part", [6, 11]),
        ("Apps and MCP servers", "Gmail, Slack, HubSpot, the customer's own MCP servers", "MCP Test connection is real; app sign-in and keys simulated", "part", [9]),
        ("Observability", "OpenTelemetry traces per run; per-cell health dashboards", "Vercel logs only", "nb", [12]),
    ],
}
STEPS = [
    ("Prompt", "Morgan describes the app and attaches a file.", "Real: sign-in, workspace, upload."),
    ("Write the plan", "Parts with checks and costs, defaults and questions, through the model gateway.", "Real model call."),
    ("Review, then Build", "Nothing runs until the click. Budget and allowed models are checked first.", "Real Build gate and budget."),
    ("Start the run", "Durable workflow; resume the sandbox or take one from the warm pool.", "Timeline starts; no sandbox."),
    ("Checks first", "The verifier writes and locks a check for every part before code exists.", "Simulated."),
    ("Build each part", "Agent workers code through the daemon's tools; anything leaving the sandbox is policy-checked.", "Simulated."),
    ("Prove each part", "The verifier runs the check; a pass marks it Works; up to 3 fixes, then it waits.", "Simulated."),
    ("Agents into Lyzr Studio", "Each agent part that works is created in the workspace's own Studio.", "Real with the workspace's Lyzr key."),
    ("Fix a blocker", "Connect the app (sign-in, key or MCP server); keys go to the vault; the proxy injects them.", "Vault and MCP test real; app sign-in simulated."),
    ("Live preview", "The app through the preview proxy; every status change pushed live.", "Real Realtime; preview simulated."),
    ("Launch", "Governance off: Test to Live. On: Test, Team, then Live after an Owner or Admin approves.", "Approvals real; deploy simulated."),
    ("Run and watch", "The app runs per environment; its agents on Studio; audit, metering and metrics.", "Audit and events real; runtime simulated."),
]
NOTES = [
    ("Control plane vs cell.", "Lyzr's control plane is global: sign-in, tenants, billing and policy authoring. Everything that touches prompts, plans, code or data runs inside a cell, so a whole cell can sit in a customer's own cloud while only IDs, statuses, usage and health cross to Lyzr."),
    ("Cells are the unit of scale.", "One cell handles about 500 running sandboxes. Lyzr adds cells as load grows, and a customer's VPC or on-prem install is just another cell."),
    ("Lyzr Studio sits beside the cell.", "In Lyzr Cloud it's Lyzr's shared Studio, with each workspace's own account. In VPC and on-prem modes the Studio runtime and registry run inside the customer's cell, so agent traffic stays there."),
    ("The prototype", "collapses the whole thing onto Vercel and Supabase in Mumbai. There's no sandbox, no worker and no egress proxy: the run is a precomputed timeline, and the boxes marked NOT BUILT exist only in the design."),
]

def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

class Map:
    def __init__(self, proto):
        self.proto, self.o = proto, []

    def text(self, x, y, t, size=12.5, weight=400, fill=C["ink2"], anchor="start", family=None):
        f = f' font-family="{family}"' if family else ""
        self.o.append(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{f}>{esc(t)}</text>')

    def badge(self, x, y, kind):
        label, fg, bg, dash = BADGE[kind]
        w = 14 + len(label) * 7.0
        d = f' stroke="{fg}" stroke-dasharray="{dash}"' if dash else ' stroke="none"'
        self.o.append(f'<rect x="{x:.1f}" y="{y}" width="{w:.1f}" height="18" rx="9" fill="{bg}"{d}/>')
        self.text(x + w / 2, y + 13, label, 10.5, 600, fg, "middle", "Menlo, monospace")
        return w

    def num(self, x, y, n):
        w = 18 if n < 10 else 24
        self.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="18" rx="9" fill="{C["ink"]}"/>')
        self.text(x + w / 2, y + 13, str(n), 11, 700, "#FFFFFF", "middle")
        return w

    def layout_box(self, w, item):
        name, prod, pr, b, steps = item
        bw = 14 + len(BADGE[b][0]) * 7.0 if self.proto else 0
        title = textwrap.wrap(name, max(10, int((w - 22 - bw - 6) / 7.3)))
        body = textwrap.wrap(pr if self.proto else prod, int((w - 20) / 6.2))
        return title, body, 10 + len(title) * 17 + 24 + len(body) * 15.5 + 8

    def box(self, x, y, w, h, item):
        name, prod, pr, b, steps = item
        title, body, _ = self.layout_box(w, item)
        fade = ' opacity="0.62"' if self.proto and b == "nb" else ""
        self.o.append(f'<g{fade}>')
        self.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{C["surface"]}" stroke="{C["line"]}"/>')
        for i, t in enumerate(title):
            self.text(x + 10, y + 22 + i * 17, t, 13.5, 700, C["ink"])
        if self.proto:
            bw = 14 + len(BADGE[b][0]) * 7.0
            self.badge(x + w - 10 - bw, y + 9, b)
        ny = y + 10 + len(title) * 17 + 2
        nx = x + 10
        for n in steps:
            nx += self.num(nx, ny, n) + 3
        for i, t in enumerate(body):
            self.text(x + 10, ny + 36 + i * 15.5, t, 12.2, 400, C["ink"] if self.proto else C["ink2"])
        self.o.append("</g>")

    def grid(self, x, y, w, items, cols, gap=8):
        bw = (w - gap * (cols - 1)) / cols
        for r in range(0, len(items), cols):
            row = items[r:r + cols]
            h = max(self.layout_box(bw, it)[2] for it in row)
            for i, it in enumerate(row):
                self.box(x + i * (bw + gap), y, bw, h, it)
            y += h + gap
        return y - gap

    def band(self, x, y, w, title, small, fill, stroke, body):
        """body(y) draws the inside and returns its bottom; the band is drawn behind it."""
        i = len(self.o)
        self.text(x + 12, y + 22, title, 13.5, 700, C["ink"])
        if small:
            self.text(x + 22 + len(title) * 7.6, y + 22, small, 12.2)
        bottom = body(y + 34) + 12
        self.o.insert(i, f'<rect x="{x}" y="{y}" width="{w}" height="{bottom - y}" rx="16" fill="{fill}" stroke="{stroke}"/>')
        return bottom

    def sub(self, x, y, w, title, items, cols):
        self.text(x, y + 10, title.upper(), 10.5, 600, C["ink2"])
        return self.grid(x, y + 18, w, items, cols)

    def render(self):
        W = 1700
        MX, MW = 40, 1290          # the map
        AX, AW = 1350, 310         # the steps list
        o = self.o
        self.text(40, 50, "Architect 2.0, one map", 28, 700, C["ink"])
        lede = ("What the prototype uses for each box: REAL works for real, PART real records with a simulated effect, "
                "SIM simulated, NOT BUILT design only. The numbers are the steps in ARCHITECTURE.md section 2."
                if self.proto else
                "How Architect 2.0 works in production: who uses it, what Lyzr runs centrally, what runs in each cell "
                "(Lyzr Cloud or the customer's own cloud), the app runtime, Lyzr Studio and outside services. "
                "The numbers are the steps in ARCHITECTURE.md section 2.")
        for i, t in enumerate(textwrap.wrap(lede, 150)):
            self.text(40, 76 + i * 18, t, 13.5)
        # legend
        lx, ly = 40, 116
        self.num(lx, ly, 1)
        self.text(lx + 24, ly + 13, "step in the path")
        lx += 140
        if self.proto:
            for k, d in [("real", "works for real"), ("part", "real records, simulated effect"), ("sim", "simulated"), ("nb", "design only")]:
                lx += self.badge(lx, ly, k) + 6
                self.text(lx, ly + 13, d)
                lx += len(d) * 6.4 + 22
        self.text(W - 40, 50, "What the prototype uses" if self.proto else "Production design", 13, 700, C["ink"], "end")

        y = 150
        y = self.band(MX, y, MW, "People", "", C["surface"], C["line"], lambda yy: self.grid(MX + 12, yy, MW - 24, B["people"], 4)) + 12
        y = self.band(MX, y, MW, "Lyzr control plane", "global, run by Lyzr · holds no prompts, code or app data", C["cp"], C["cp_line"],
                      lambda yy: self.grid(MX + 12, yy, MW - 24, B["cp"], 6 if not self.proto else 3)) + 10
        # the boundary
        o.append(f'<line x1="{MX + 8}" y1="{y + 10}" x2="{MX + MW - 8}" y2="{y + 10}" stroke="{C["cp_line"]}" stroke-width="1.5" stroke-dasharray="6 5"/>')
        msg = "Only IDs, statuses, usage and health go up; policy, config and updates come down"
        o.append(f'<rect x="{MX + MW / 2 - 290}" y="{y}" width="580" height="20" fill="{C["bg"]}"/>')
        self.text(MX + MW / 2, y + 14, msg, 12.5, 600, C["ink"], "middle")
        y += 32
        # the cell and the right column
        CW = 930
        RX, RW = MX + CW + 12, MW - CW - 12

        def cell(yy):
            x, w = MX + 12, CW - 24
            for title, key in [("Services", "services"), ("Workers and sandboxes", "work"), ("Ways out", "gates"), ("Stores", "stores"), ("Built apps' runtime", "runtime")]:
                yy = self.sub(x, yy, w, title, B[key], 4 if key != "gates" else 3) + 12
            return yy - 12
        cell_bottom = self.band(MX, y, CW, "A cell: the data plane", "Lyzr Cloud, a dedicated region, the customer's VPC, or on-prem · about 500 running sandboxes per cell", C["dp"], C["dp_line"], cell)
        ry = self.band(RX, y, RW, "Lyzr Studio", "", C["st"], C["st_line"],
                       lambda yy: (self.text(RX + 12, yy + 2, "each workspace's own account; inside the", 12.2),
                                   self.text(RX + 12, yy + 17, "customer's cell in VPC and on-prem modes", 12.2),
                                   self.grid(RX + 12, yy + 28, RW - 24, B["studio"], 1))[-1]) + 12
        self.band(RX, ry, RW, "Outside services", "", C["out"], C["line"], lambda yy: self.grid(RX + 12, yy, RW - 24, B["outside"], 1))
        y = cell_bottom + 18

        # the steps list (right)
        ay = 150
        start = len(o)
        self.text(AX + 14, ay + 26, "From prompt to a live app", 14, 700, C["ink"])
        sy = ay + 44
        for i, (t, d, p) in enumerate(STEPS):
            self.num(AX + 14, sy, i + 1)
            self.text(AX + 44, sy + 13, t, 13, 700, C["ink"])
            sy += 30
            for line in textwrap.wrap(d, 40):
                self.text(AX + 44, sy, line, 12)
                sy += 15
            if self.proto:
                for line in textwrap.wrap("Prototype: " + p, 40):
                    self.text(AX + 44, sy, line, 12, 400, C["ink"])
                    sy += 15
            sy += 8
        o.insert(start, f'<rect x="{AX}" y="{ay}" width="{AW}" height="{sy - ay + 4}" rx="16" fill="{C["surface"]}" stroke="{C["line"]}"/>')

        # how to read it (full width)
        y = max(y, sy + 22)
        start = len(o)
        self.text(54, y + 26, "How to read it", 14, 700, C["ink"])
        ny = y + 50
        for head, body in NOTES:
            lines = textwrap.wrap(head + " " + body, 215)
            for j, line in enumerate(lines):
                if j == 0:
                    self.text(64, ny, "•", 13, 700, C["ink"])
                    o.append(f'<text x="78" y="{ny:.1f}" font-size="13" fill="{C["ink2"]}"><tspan font-weight="700" fill="{C["ink"]}">{esc(head)}</tspan> {esc(line[len(head) + 1:])}</text>')
                else:
                    self.text(78, ny, line, 13)
                ny += 18
            ny += 2
        o.insert(start, f'<rect x="40" y="{y}" width="{W - 80}" height="{ny - y + 6}" rx="16" fill="{C["surface"]}" stroke="{C["line"]}"/>')
        H = ny + 40
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H:.0f}" width="{W}" height="{H:.0f}" '
                f'font-family="Helvetica, Arial, sans-serif"><rect width="{W}" height="{H:.0f}" fill="{C["bg"]}"/>')
        return "\n".join([head] + o + ["</svg>"])

here = os.path.dirname(os.path.abspath(__file__))
for proto, name in [(False, "system-map-production"), (True, "system-map-prototype")]:
    svg = Map(proto).render()
    assert chr(0xA7) not in svg
    open(os.path.join(here, f"{name}.svg"), "w").write(svg)
    print(f"wrote {name}.svg")
