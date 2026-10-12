"""The prototype as built (editable source): what runs where, and what's real or simulated.

Matches ARCHITECTURE.md section 9 and docs/DECISIONS.md.
Run: python3 docs/product/diagrams/src/prototype.py, then node scripts/render-diagrams.mjs prototype-as-built
"""
import os

W, H = 1400, 860
INK, INK2, LINE = "#1A1A19", "#42413D", "#D6D4CC"
out = []
BADGE = {"REAL": ("#E5F2E8", "#1D6E30", "none"), "PART": ("#FCEFDC", "#8A4500", "none"), "SIM": ("#FFFFFF", "#5C5B56", "4 3")}


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def band(x, y, w, h, title, fill, stroke):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    out.append(f'<text x="{x + 18}" y="{y + 28}" font-size="15" font-weight="700" fill="{INK}">{esc(title)}</text>')


def badge(x, y, kind):
    bg, fg, dash = BADGE[kind]
    w = 48 if kind == "PART" else 44
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="20" rx="10" fill="{bg}" stroke="{fg}" stroke-width="1.2" stroke-dasharray="{dash}"/>')
    out.append(f'<text x="{x + w / 2}" y="{y + 14}" font-size="11" font-weight="700" fill="{fg}" text-anchor="middle">{kind}</text>')


def node(x, y, w, h, title, sub, kind):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#FFFFFF" stroke="{LINE}" stroke-width="1.3"/>')
    out.append(f'<text x="{x + 14}" y="{y + 26}" font-size="14" font-weight="700" fill="{INK}">{esc(title)}</text>')
    for i, line in enumerate(sub):
        out.append(f'<text x="{x + 14}" y="{y + 47 + i * 16}" font-size="12" fill="{INK2}">{esc(line)}</text>')
    badge(x + w - (58 if kind == "PART" else 54), y + 10, kind)


def arrow(x1, y1, x2, y2, dashed=False):
    d = ' stroke-dasharray="6 5"' if dashed else ""
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#8A8983" stroke-width="1.6"{d} marker-end="url(#a)"/>')


out.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="Helvetica, Arial, sans-serif">')
out.append('<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#8A8983"/></marker></defs>')
out.append(f'<rect width="{W}" height="{H}" fill="#F6F5F2"/>')
out.append(f'<text x="40" y="48" font-size="24" font-weight="700" fill="{INK}">What this repo runs, and on what</text>')
out.append(f'<text x="40" y="70" font-size="13.5" fill="{INK2}">Vercel and Supabase, both in Mumbai. Badges say what is real.</text>')
badge(960, 34, "REAL"); out.append(f'<text x="1010" y="48" font-size="12.5" fill="{INK2}">real</text>')
badge(1060, 34, "PART"); out.append(f'<text x="1114" y="48" font-size="12.5" fill="{INK2}">real records, simulated effects</text>')
badge(960, 58, "SIM"); out.append(f'<text x="1010" y="72" font-size="12.5" fill="{INK2}">simulated</text>')

band(40, 96, 250, 340, "Browser", "#FFFFFF", LINE)
node(60, 136, 210, 70, "Landing and sign-in", ["Try the demo · Google,", "GitHub, email"], "REAL")
node(60, 220, 210, 70, "Architect web app", ["plan, build, launch,", "governance, ⌘K"], "REAL")
node(60, 304, 210, 112, "Preview frame", ["a shell drawn from the", "plan's parts, or the", "Meeting Prep sample;", "no app is running"], "SIM")

band(320, 96, 560, 520, "Vercel · Mumbai (bom1) · Next.js 16", "#EEF2FF", "#A5B4FC")
node(340, 136, 250, 70, "Server actions and routes", ["every write checks the role"], "REAL")
node(610, 136, 250, 70, "Model gateway", ["Vercel AI SDK · quota", "fallback to OpenRouter"], "REAL")
node(340, 220, 250, 86, "Simulator", ["a precomputed event timeline", "per run, replayed on the", "clock: the build"], "SIM")
node(610, 220, 250, 86, "Terminal", ["6 commands read project data", "(npm test, pytest, git status,", "git diff, ls, cat); nothing runs"], "PART")
node(340, 320, 250, 70, "Lyzr Studio client", ["the workspace's own key;", "demo agent on ours"], "REAL")
node(610, 320, 250, 70, "MCP Test connection", ["initialize + tools/list;", "no private addresses"], "REAL")
node(340, 404, 250, 70, "Governance", ["policies and approvals stored;", "their effects simulated"], "PART")
node(610, 404, 250, 70, "Launch", ["Test → Team → Live and", "domains are simulated"], "SIM")
node(340, 488, 250, 70, "Daily cron", ["purges Trash; deletes demo", "visitors after 7 days"], "REAL")
node(610, 488, 250, 70, "Vercel Analytics", ["page views, no cookies"], "REAL")
out.append(f'<text x="340" y="596" font-size="12.5" fill="{INK2}">No sandbox: no code is written, run or deployed.</text>')

band(910, 96, 450, 520, "Supabase · Mumbai (ap-south-1)", "#ECFEFF", "#67E8F9")
node(930, 136, 410, 70, "Postgres with row-level security", ["every table; members read their workspace only"], "REAL")
node(930, 220, 410, 70, "Auth", ["Google, GitHub, email · anonymous demo sessions"], "REAL")
node(930, 304, 410, 70, "Realtime", ["run events: parts turn Works as they happen"], "REAL")
node(930, 388, 410, 70, "Vault", ["Lyzr keys, project keys, MCP auth headers"], "REAL")
node(930, 472, 200, 70, "Storage", ["uploaded files"], "REAL")
node(1140, 472, 200, 70, "analytics_events", ["insert-only, ours"], "REAL")

band(40, 646, 1320, 180, "Outside services", "#FFFFFF", LINE)
node(60, 686, 250, 70, "Gemini", ["writes plans and answers chat"], "REAL")
node(325, 686, 250, 70, "OpenRouter (free)", ["a picker choice and the", "fallback on Gemini quota"], "REAL")
node(590, 686, 250, 70, "Claude and GPT", ["real with a key; otherwise", "Gemini answers, labelled"], "SIM")
node(855, 686, 240, 70, "Lyzr Studio", ["agents, Try it, sync"], "REAL")
node(1110, 686, 230, 70, "GitHub App", ["read-only: repos, files"], "REAL")
node(60, 766, 515, 44, "Your MCP servers · Test connection lists tools", [], "REAL")
node(590, 766, 750, 44, "Apps your plans connect to (Gmail, Slack, HubSpot…): sign-in and keys simulated", [], "SIM")

arrow(290, 171, 338, 171)
arrow(880, 171, 928, 171)
arrow(880, 423, 928, 423)
arrow(600, 616, 600, 644)
out.append(f'<text x="612" y="636" font-size="12" fill="{INK2}">model calls, Lyzr Studio, GitHub and MCP, from the server only</text>')
out.append("</svg>")

open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "prototype-as-built.svg"), "w").write("\n".join(out))
print("wrote prototype-as-built.svg")
