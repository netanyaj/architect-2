# Architect today: importing an existing project

_Test run on 2026-10-02 with the sample repo `netanyaj/ticket-triage`, a Vite + React front end, an Express API, a disconnected CrewAI agent, a known UI bug and one failing test. Sources: an 11-minute screen recording, a network log (HAR) of the import session, and the GitHub repo state afterwards._

**Caveat:** the whole session stayed in **Planning mode** ("Start Building" was never pressed). What follows covers import, understanding and planning. Running, editing, testing and pushing were **not exercised**.

## 1. Flow observed
1. **Entry point.** The "Import codebase" dialog offers two routes:
   - paste a **public GitHub URL**, which is cloned anonymously;
   - **Connect GitHub**, to browse your repositories or import a private one.

   Optional **branch** and **subfolder** fields let you import part of a larger repository (a monorepo).
2. **The repository appears as a chip in the home prompt.** It reads `netanyaj/ticket-triage · main · will import`. You type your first message next to it.
3. **Staging.** `POST /apps/{id}/import-codebase {github_url, branch}` returns the following:

   ```
   {commit_sha, source_path: "/app/import-source", file_count: 15, total_kb: 9, staged_at}
   ```

   A toast confirms "Imported netanyaj/ticket-triage as existing project". The chip then reads `main · 15 files · existing project`.
4. **The rest of the session was planning.** Every message produced a planning turn (`POST plan/turn`, then `PATCH plan`). Alongside the chat sat a **Plan document** and an **App Mockup** tab showing screens of the proposed app.

## 2. How each prompt went

| Prompt | What Architect did | Verdict |
|---|---|---|
| **1. Understand the project** | Read every file and explained it accurately: Vite + Express rather than Next.js, a JSON file used as storage, the disconnected CrewAI agent, both environment variables and the rule-based fallback, the broken P1 filter, and **why** the test fails (the keyword "broken" maps to P2). It added issues we had not planted: no lockfile, no production start path, unvalidated `JSON.parse` on OpenAI output, and concurrent writes to the JSON file. "No files have been changed." | **Excellent.** Better understanding than many coding tools show |
| **2. Run it as is** | *"The eventual Architect implementation cannot run this repository verbatim. Architect keeps its Next.js App Router, TypeScript, Tailwind and shadcn template and ports the useful behaviour into it."* The imported repository is a **read-only donor** at `/app/import-source`; the new app lives at `/app/nextjs-project`. It offered: a minimal Next.js port / fix known bugs during the port / **stop here**. | **Import means porting into Architect's template, not running your project.** Stated honestly, but a developer asking to run their own stack can't |
| **3. Secrets** | Listed `OPENAI_API_KEY` and `SLACK_WEBHOOK_URL`, explained what fails when each is missing, and gave caveats such as Slack failures being silently ignored. Did not prompt for the values. | Good explanation, no setup flow |
| **4. The CrewAI agent** | Explained the agent and how it is disconnected from the app. Recommended **converting it to a hosted Lyzr agent**. Options offered: convert / **keep CrewAI as an external Python service, connected through an "Add custom tool" OpenAPI wrapper** / don't connect. Explained the trade-off before acting. | "Agents in any framework" today means **convert, or wrap as a tool**. Asking before acting was good |
| **5. Fix the P1 bug** | Pinpointed `tickets.filter(t => (onlyP1 ? true : true))` and the intended predicate. Asked whether untriaged tickets should be hidden. Updated the plan only. | Precise. **Nothing was applied, because this was planning** |
| **6. Tests** | *"I can't execute the test command in this planning session because no shell or test-runner tool is available."* It read the test and diagnosed the failure correctly. On "fix it the right way", it said it would change the classifier, **not the test**, and explained why. | Right judgement, could not run anything |
| **7. CSV export** | Asked visible rows vs all rows (we chose both) and added it to the plan. Proposed a client-side approach with no API or dependency changes. | Good scoping |
| **8. Push / pull** | *"No code changes have been saved… I cannot push a branch or open a pull request in this advisor session because Git/GitHub write tools are not available. The listed GitHub integration could support that during a build-capable workflow."* For the README change, it **fetched the latest commit through the GitHub API and raw files and showed the one-line diff**, without touching the read-only donor copy. | Clear about its limits. Reading upstream changes works |

**Confirmed on GitHub afterwards:** branches = `main` only, no pull requests, and the only commits are Netanya's two. Architect wrote nothing back to the original repository.

## 3. Throughout the session
- **Multiple-choice clarifying questions with a RECOMMENDED option**, now tied to the actual code. Compare the generic questionnaire in the first test.
- **Proactive suggestions**: "Generate a workflow diagram of the app (recommended)", "Create an on-brand design file", "Draft a skill.md for the core agent".
- The **Plan document is detailed**: overview, user stories, agent architecture, user flow, integrations, and a **Port Manifest** table listing each source file, its destination in the Architect project, the transfer type ("Needs adaptation" or "Rebuild") and notes. It ends with "Artifacts & references": donor repository, commit, defect and intended predicate.
- **Credits:** usage stayed flat at 288.54 used out of 2,000 for the whole 13-minute planning session. **Planning appears to be free.** The ~288 credits (≈ $2.88 at a divisor of 100) were consumed earlier, most likely by the Briefly build.
- **Privacy observation:** the Taboola ad pixel auto-captured the labels of the plan options clicked, for example `auto_stop_here_do_not_create_a_porting_plan_or_pre` and `auto_yes_show_classified_p1_tickets_only`. In-product choices are reaching an ad network. This is relevant to any enterprise or sovereignty story.

## 4. What this means for 2.0
- **Import today is "bring a reference, get a Next.js rebuild"**, not "keep working on my project". The brief asks to "import an existing project and keep working on it". For a developer that means:
  - their stack runs as it is;
  - their tests run;
  - changes land in their own repository as a branch or pull request.

  This is the largest developer gap found in the audit.
- **What already works and should be kept:** understanding the codebase, honest statements of limits, clarifying questions grounded in the code, the port manifest, and reading upstream changes.
- **Agents built in other frameworks:** convert-or-wrap is a reasonable default. 2.0 could add a third path: **run the framework natively in the sandbox, behind the same agent contract**, and show the trade-off in the UI.
- **Planning mode is an advisor with no tools.** It cannot run tests, execute code or touch git. A read-only "inspect" capability during planning (run tests, try the app) would make plans evidence-based without risking changes.
