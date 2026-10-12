"""Hero architecture diagram for README and ARCHITECTURE.md (editable source).

How Architect 2.0 works in production: no prototype badges here (those are on the
prototype diagram and the prototype system map). The numbered boxes are the twelve steps
in ARCHITECTURE.md section 2, one box per step, joined by the path arrows in order.
The control plane holds only the CDN, gateway, identity, tenant directory, billing and
policy authoring; everything that touches prompts, plans, code or data runs in the cell.
Run: python3 docs/product/diagrams/src/hero.py, then node scripts/render-diagrams.mjs hero-architecture
"""
import os
import textwrap

W, H = 1640, 1250
INK, INK2, LINE, PATH = "#1A1A19", "#42413D", "#D6D4CC", "#1A1A19"
out = []


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, t, size=12.5, weight=400, fill=INK2, anchor="start"):
    out.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{esc(t)}</text>')


def band(x, y, w, h, title, note, fill, stroke):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    text(x + 18, y + 28, title, 15, 700, INK)
    if note:
        text(x + 26 + len(title) * 8.1, y + 28, note, 12.5)


def label(x, y, t):
    text(x, y, t.upper(), 10.5, 700, INK2)


def step(cx, cy, n):
    out.append(f'<circle cx="{cx}" cy="{cy}" r="12.5" fill="{PATH}"/>')
    text(cx, cy + 4.5, str(n), 12.5, 700, "#FFFFFF", "middle")


def node(x, y, w, h, title, sub, n=None, chars=None):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#FFFFFF" stroke="{INK if n else LINE}" stroke-width="{1.6 if n else 1.2}"/>')
    tx = x + 14
    if n:
        step(x + 26, y + 22, n)
        tx = x + 46
    text(tx, y + 27, title, 14, 700, INK)
    for i, line in enumerate(textwrap.wrap(sub, chars or int((w - 26) / 6.4))):
        text(x + 14, y + 47 + i * 15.5, line, 12)


def arrow(x1, y1, x2, y2, dashed=False, color=PATH, width=2.2):
    d = ' stroke-dasharray="6 5"' if dashed else ""
    m = "p" if color == PATH else "g"
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}"{d} marker-end="url(#{m})"/>')


out.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="Helvetica, Arial, sans-serif">')
out.append(
    '<defs>'
    f'<marker id="p" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{PATH}"/></marker>'
    '<marker id="g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#8A8983"/></marker>'
    '</defs>'
)
out.append(f'<rect width="{W}" height="{H}" fill="#F6F5F2"/>')
text(40, 48, "How Architect 2.0 works in production", 24, 700, INK)
text(40, 72, "From one prompt to a live app. Follow the numbers: they are the twelve steps in ARCHITECTURE.md section 2.", 13.5)
# Legend
step(1192, 44, 1)
text(1212, 48, "a step, in order")
arrow(1180, 70, 1230, 70)
text(1240, 74, "the path from prompt to a live app")

# People (full width)
band(40, 96, 1560, 120, "People", "", "#FFFFFF", LINE)
node(60, 132, 330, 70, "Org admins", "Set where it runs and which models and apps are allowed; approve Live")
node(410, 132, 470, 70, "Developers and their coding agents", "Sam, with Claude Code or Cursor, through Architect's MCP server and CLI: the same tools and policy")
node(900, 132, 240, 70, "Builders", "Morgan types the prompt in the web app", 1)
node(1160, 132, 420, 70, "People who use the built app", "Sign in to the app on its own domain")

# Lyzr control plane (full width): global, holds no prompts, plans, code or app data
band(40, 236, 1560, 120, "Lyzr control plane", "global, run by Lyzr · holds no prompts, plans, code or app data", "#EEEAFB", "#C9BEF2")
cw, cx0 = 236, 60
cp = [
    ("CDN", "The builder's front end, served worldwide"),
    ("Identity and SSO", "Google, GitHub, email; Keycloak single sign-on"),
    ("Tenant directory", "Which workspace lives in which cell; feature flags"),
    ("API gateway", "One entry: checks sign-in, routes to the cell, rate limits"),
    ("Billing and credits", "Credits, subscription tiers and invoices from usage counts"),
    ("Policy authoring", "Admins write org policy; it is pushed to every cell"),
]
for i, (t, s) in enumerate(cp):
    node(cx0 + i * (cw + 20), 272, cw, 70, t, s)

# The boundary
out.append(f'<line x1="40" y1="376" x2="1600" y2="376" stroke="#9C8FE0" stroke-width="1.5" stroke-dasharray="7 6"/>')
out.append('<rect x="60" y="366" width="640" height="20" fill="#F6F5F2"/>')
text(70, 381, "The boundary: only IDs, statuses, usage and health go up; policy, config and updates come down", 12.5, 600, INK)

# A cell: the data plane
band(40, 396, 1120, 662, "A cell: the data plane", "Lyzr Cloud, a dedicated region, the customer's VPC, or on-prem", "#E6F5F6", "#A9DCE0")
X = [60, 340, 620, 900]
BW, BH = 240, 90
R = [452, 576, 700, 824, 948]
label(60, R[0] - 10, "Services")
node(X[0], R[0], BW, BH, "Audit log", "Append-only: every run, change, approval and data access")
node(X[1], R[0], BW, BH, "Run orchestrator", "Durable workflows (Temporal) for build, fix and launch; resume after a crash", 4)
node(X[2], R[0], BW, BH, "Policy and approvals", "Budget and allowed models before Build; anything leaving a sandbox: allow, ask or refuse", 3)
node(X[3], R[0], BW, BH, "Plan service", "Parts, checks and costs through the model gateway; the estimator; versions", 2)

label(60, R[1] - 10, "Workers and sandboxes")
node(X[0], R[1], BW, BH, "Warm pool", "Pre-booted sandboxes per image; paused after 10 idle minutes, resumed from a snapshot")
node(X[1], R[1], BW, BH, "Verifier", "Writes and locks each part's check before any code exists", 5)
node(X[2], R[1], BW, BH, "Architect agent", "Workers outside the sandbox (Claude Agent SDK); act only through the daemon's tools", 6)
node(X[3], R[1], BW, BH, "Sandbox", "One per project (E2B). Code and checks run here; a pass marks the part Works; no keys inside", 7)

label(60, R[2] - 10, "Ways out: to models, GitHub, apps and the browser")
node(X[0], R[2], BW, BH, "Git executor", "Short-lived GitHub tokens; branches and PRs after approval")
node(X[1], R[2], BW, BH, "Model gateway", "Every model call: routing by role and policy, private models, metering")
node(X[2], R[2], BW, BH, "Realtime and preview", "Part status pushed live; the running app through the preview proxy", 10)
node(X[3], R[2], BW, BH, "Egress proxy and vault", "A blocker fixed: keys go to the vault; the proxy injects them on the way out", 9)

label(60, R[3] - 10, "Built apps' runtime (Kubernetes)")
node(X[0], R[3], BW, BH, "Per-environment data", "Its own Postgres, bucket, secrets and URL for Test, Team and Live")
node(X[1], R[3], BW, BH, "Queue and agent workers", "App agent calls wait in a queue instead of crashing the app")
node(X[2], R[3], BW, BH, "Launch", "Image built and checked; Test, Team, then Live after approval when governance is on", 11)
node(X[3], R[3], BW, BH, "Live app", "Runs per environment, at least 2 copies, autoscaling; audit and metering", 12)

label(60, R[4] - 10, "Stores")
node(X[0], R[4], BW, BH, "Postgres", "Projects, plans, parts, checks, runs, policies, approvals")
node(X[1], R[4], BW, BH, "Redis", "Sandbox state, sessions, realtime fan-out")
node(X[2], R[4], BW, BH, "Object storage", "Files, proofs, screenshots, sandbox snapshots")
node(X[3], R[4], BW, BH, "Event log", "Every run, model call and approval once: metering, metrics, the estimator")

# Right column: cells note, Lyzr Studio, ways out note
for i, line in enumerate([
    "Cells are the unit of scale: about 500",
    "running sandboxes each. Lyzr adds cells as",
    "load grows, and a customer's VPC or",
    "on-prem install is just another cell.",
]):
    text(1190, 420 + i * 17, line)
band(1180, R[1] - 44, 420, R[3] + BH + 22 - (R[1] - 44), "Lyzr Studio", "each workspace's own account", "#E8F1E6", "#B7D3B0")
node(1200, R[1], 380, BH, "Agent registry", "Each agent part that works is created in the workspace's own Studio; edits sync both ways", 8)
for i, line in enumerate([
    "In VPC and on-prem modes, the Studio",
    "runtime and registry run inside the",
    "customer's cell, so agent prompts and",
    "data stay in the customer's cloud.",
]):
    text(1200, R[2] + 14 + i * 17, line)
node(1200, R[3], 380, BH, "Agent runtime and evals", "Runs every built app's agents one way; evals over time; reuse an agent in the next app")
for i, line in enumerate([
    "Only the model gateway, the egress proxy",
    "and the git executor reach outside the",
    "cell; each call is checked against policy.",
]):
    text(1190, R[4] + 20 + i * 17, line)

# Outside services
band(40, 1080, 1560, 132, "Outside services", "", "#F1F0EC", LINE)
ow = (1520 - 40) / 3
node(60, 1118, ow, 74, "Model providers", "Claude, GPT, Gemini, or the customer's own and self-hosted models", chars=70)
node(60 + ow + 20, 1118, ow, 74, "GitHub", "The user's own repos: import, branches and pull requests", chars=70)
node(60 + 2 * (ow + 20), 1118, ow, 74, "Apps and MCP servers", "Gmail, Slack, HubSpot, and the customer's own MCP servers", chars=70)

# The path, 1 to 12 (drawn last so it sits on top)
c = [r + BH / 2 for r in R]
arrow(1020, 202, 1020, 270)                      # 1 → API gateway
arrow(1020, 342, 1020, R[0] - 2)                 # API gateway → 2
arrow(X[3], c[0], X[2] + BW + 2, c[0])           # 2 → 3
arrow(X[2], c[0], X[1] + BW + 2, c[0])           # 3 → 4
arrow(X[1] + BW / 2, R[0] + BH, X[1] + BW / 2, R[1] - 2)  # 4 → 5
arrow(X[1] + BW, c[1], X[2] - 2, c[1])           # 5 → 6
arrow(X[2] + BW, c[1], X[3] - 2, c[1])           # 6 → 7
arrow(X[3] + BW, c[1], 1198, c[1])               # 7 → 8
arrow(1214, R[1] + BH, X[3] + BW + 2, c[2] - 12, dashed=True)  # 8 then 9 (dashed: "then", not a call)
arrow(X[3], c[2], X[2] + BW + 2, c[2])           # 9 → 10
arrow(X[2] + BW / 2, R[2] + BH, X[2] + BW / 2, R[3] - 2)  # 10 → 11
arrow(X[2] + BW, c[3], X[3] - 2, c[3])           # 11 → 12
arrow(X[3] + BW, c[3], 1198, c[3], dashed=True, color="#8A8983", width=1.6)  # 12: the app's agents run on Studio
out.append("</svg>")

here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, "hero-architecture.svg"), "w").write("\n".join(out))
print("wrote hero-architecture.svg")
