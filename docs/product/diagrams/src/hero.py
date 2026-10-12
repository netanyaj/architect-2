"""Hero architecture diagram for README and ARCHITECTURE.md (editable source).

Numbered steps match ARCHITECTURE.md section 2. Badges say what the prototype does today:
REAL = works for real, PART = stored for real with simulated effects, SIM = simulated.
Run: python3 docs/product/diagrams/src/hero.py, then node scripts/render-diagrams.mjs hero-architecture
"""
import os

W, H = 1600, 1000
INK, INK2, LINE = "#1A1A19", "#42413D", "#D6D4CC"
out = []


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def band(x, y, w, h, title, fill, stroke):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    out.append(f'<text x="{x + 18}" y="{y + 28}" font-size="15" font-weight="700" fill="{INK}">{esc(title)}</text>')


BADGE = {"REAL": ("#E5F2E8", "#1D6E30", "none"), "PART": ("#FCEFDC", "#8A4500", "none"), "SIM": ("#FFFFFF", "#5C5B56", "4 3")}


def badge(x, y, kind):
    bg, fg, dash = BADGE[kind]
    w = 44 if kind != "PART" else 48
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="20" rx="10" fill="{bg}" stroke="{fg}" stroke-width="1.2" stroke-dasharray="{dash}"/>')
    out.append(f'<text x="{x + w / 2}" y="{y + 14}" font-size="11" font-weight="700" fill="{fg}" text-anchor="middle">{kind}</text>')


def step(x, y, n):
    out.append(f'<circle cx="{x}" cy="{y}" r="13" fill="{INK}"/>')
    out.append(f'<text x="{x}" y="{y + 5}" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">{n}</text>')


def node(x, y, w, h, title, sub, kind, steps=()):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#FFFFFF" stroke="{LINE}" stroke-width="1.3"/>')
    # Step numbers sit inside the box, before its title, so they never cover a layer's name.
    for i, n in enumerate(steps):
        step(x + 24 + i * 30, y + 21, n)
    tx = x + 14 + len(steps) * 30
    out.append(f'<text x="{tx}" y="{y + 26}" font-size="14.5" font-weight="700" fill="{INK}">{esc(title)}</text>')
    for i, line in enumerate(sub):
        out.append(f'<text x="{x + 14}" y="{y + 48 + i * 17}" font-size="12.5" fill="{INK2}">{esc(line)}</text>')
    badge(x + w - (58 if kind == "PART" else 54), y + 10, kind)


def arrow(x1, y1, x2, y2, dashed=False, label=None):
    d = ' stroke-dasharray="6 5"' if dashed else ""
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#8A8983" stroke-width="1.6"{d} marker-end="url(#a)"/>')
    if label:
        out.append(f'<text x="{(x1 + x2) / 2 + 6}" y="{(y1 + y2) / 2 - 4}" font-size="11.5" fill="{INK2}">{esc(label)}</text>')


out.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="Helvetica, Arial, sans-serif">')
out.append('<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#8A8983"/></marker></defs>')
out.append(f'<rect width="{W}" height="{H}" fill="#F6F5F2"/>')
out.append(f'<text x="40" y="48" font-size="24" font-weight="700" fill="{INK}">Architect 2.0 · from prompt to a live app</text>')
out.append(f'<text x="40" y="70" font-size="13.5" fill="{INK2}">Numbers are the steps in ARCHITECTURE.md §2. Badges say what the prototype does today.</text>')
# Legend
lx = 1030
badge(lx, 34, "REAL"); out.append(f'<text x="{lx + 50}" y="48" font-size="12.5" fill="{INK2}">works for real</text>')
badge(lx + 150, 34, "PART"); out.append(f'<text x="{lx + 204}" y="48" font-size="12.5" fill="{INK2}">stored for real, effects simulated</text>')
badge(lx, 58, "SIM"); out.append(f'<text x="{lx + 50}" y="72" font-size="12.5" fill="{INK2}">simulated</text>')
step(lx + 162, 68, 1); out.append(f'<text x="{lx + 182}" y="72" font-size="12.5" fill="{INK2}">step in §2</text>')

# Layers (left) and the governance column (right)
band(40, 92, 1110, 120, "People", "#FFFFFF", LINE)
node(70, 132, 330, 66, "Architect web app", ["Parts panel · stage · chat · ⌘K"], "REAL", (1, 3))
node(430, 132, 300, 66, "Live preview", ["the app as each part works"], "SIM", (10,))
node(760, 132, 360, 66, "Your coding agent", ["Claude Code, Cursor · via MCP"], "SIM")

band(40, 232, 1110, 140, "Control plane", "#EEF2FF", "#A5B4FC")
node(70, 272, 240, 82, "API gateway", ["one entry · sign-in", "workspaces · rate limits"], "REAL")
node(330, 272, 250, 82, "Plan service", ["parts, checks, cost", "the conflict guard"], "REAL", (2,))
node(600, 272, 260, 82, "Run orchestrator", ["durable workflows", "fix loop, up to 3"], "SIM", (4,))
node(880, 272, 240, 82, "Realtime hub", ["parts turn Works live"], "REAL")

band(40, 392, 1110, 250, "Data plane · Lyzr Cloud or your own cloud", "#ECFEFF", "#67E8F9")
node(70, 432, 250, 82, "Verifier", ["writes checks first", "proof per part"], "SIM", (5, 7))
node(340, 432, 260, 82, "Architect agent", ["workers outside the sandbox", "tools over MCP"], "SIM", (6,))
node(620, 432, 240, 82, "Sandbox per project", ["your stack + daemon", "no keys inside"], "SIM")
node(880, 432, 240, 82, "Model gateway", ["Gemini, OpenRouter, Claude,", "GPT · quota fallback"], "REAL", (2,))
node(70, 540, 250, 82, "Egress proxy", ["injects secrets", "allow-listed hosts"], "SIM", (9,))
node(340, 540, 260, 82, "Git executor", ["GitHub App · import is", "real, PRs simulated"], "PART")
node(620, 540, 500, 82, "App runtime", ["Test version → Team version → Live", "one runtime in every deployment mode"], "SIM", (11, 12))

band(40, 662, 1110, 132, "Lyzr Studio · each workspace's own account", "#E2E8DC", "#7DBA8A")
node(70, 702, 360, 74, "Agents made when their part works", ["saved edits sync · Try it runs on Studio"], "REAL", (8,))
node(450, 702, 330, 74, "Agent runtime for the built app", ["one runtime for every app's agents"], "SIM", (12,))
node(800, 702, 320, 74, "Reuse across apps", ["Attach a Studio agent as a part"], "REAL")

band(40, 814, 1110, 150, "Outside services", "#FFFFFF", LINE)
node(70, 854, 330, 82, "Model providers", ["Gemini and OpenRouter live;", "Claude, GPT with a key"], "REAL")
node(420, 854, 330, 82, "Your apps and MCP servers", ["OAuth and keys simulated;", "MCP Test connection real"], "PART", (9,))
node(770, 854, 350, 82, "GitHub", ["read-only App: repos, files,", "the import analysis"], "REAL")

band(1180, 92, 380, 872, "Governance layer · your organisation's rules", "#F0EAFA", "#C7AAFC")
node(1205, 140, 330, 100, "Policies", ["models · apps and MCP servers", "data and egress · budgets", "where it runs"], "PART", (3,))
node(1205, 262, 330, 100, "Approvals and allow-rules", ["Live deploys, new apps, keys", "for Live, push to main"], "PART", (11,))
node(1205, 384, 330, 82, "Keys and passwords", ["encrypted in Vault, never shown", "again · your Lyzr key too"], "REAL", (9,))
node(1205, 488, 330, 82, "Budgets and caps", ["cost before every paid action", "demo: 5 plans a day"], "PART", (3,))
node(1205, 592, 330, 82, "Audit log", ["every decision, CSV export"], "REAL", (12,))
out.append(f'<text x="1205" y="712" font-size="12.5" fill="{INK2}">Checked before anything leaves a sandbox:</text>')
out.append(f'<text x="1205" y="729" font-size="12.5" fill="{INK2}">allowed by rule, sent for approval,</text>')
out.append(f'<text x="1205" y="746" font-size="12.5" fill="{INK2}">or refused. Applies to the workers,</text>')
out.append(f'<text x="1205" y="763" font-size="12.5" fill="{INK2}">your coding agent and the built app.</text>')

# Main flow: only arrows that cross nothing; the step numbers give the order.
arrow(235, 198, 190, 272)
arrow(310, 313, 330, 313)
arrow(580, 313, 600, 313)
arrow(600, 473, 620, 473)
# Governance checks the control and data planes.
arrow(1180, 300, 1152, 300, dashed=True)
arrow(1180, 515, 1152, 515, dashed=True)
arrow(1180, 728, 1152, 728, dashed=True)
out.append("</svg>")

here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, "hero-architecture.svg"), "w").write("\n".join(out))
print("wrote hero-architecture.svg")
