"use client";

import { useState } from "react";
import { Button, IconButton, TextLink } from "@/components/ax/button";
import { ChangeCard } from "@/components/ax/change-card";
import { AttachmentChip, Composer, ModeSwitch, QueueLine } from "@/components/ax/composer";
import { DataTable } from "@/components/ax/data-table";
import { Drawer } from "@/components/ax/drawer";
import { EmptyState } from "@/components/ax/empty-state";
import { HelpPanel } from "@/components/ax/help-panel";
import { ListRow, Tray } from "@/components/ax/list-row";
import { NeedsYouCard } from "@/components/ax/needs-you-card";
import { Pill, SimTag, Tag } from "@/components/ax/pill";
import { PlanGroup, PlanPanel, PlanRow } from "@/components/ax/plan-panel";
import { PreviewDock, PreviewFrame } from "@/components/ax/preview-dock";
import { Segmented } from "@/components/ax/segmented";
import { Option, StageBanner } from "@/components/ax/stage-banner";
import { StatusLine, StatusMark, StatusWord } from "@/components/ax/status-mark";
import { Stepper } from "@/components/ax/stepper";
import { TemplateCard } from "@/components/ax/template-card";
import { SettingRow, Toggle } from "@/components/ax/toggle";
import { VersionCards } from "@/components/ax/version-cards";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-pane border border-line bg-surface p-5">
      <h2 className="text-sub font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function KitDemo() {
  const [dark, setDark] = useState(false);
  const [view, setView] = useState<"app" | "agents" | "data" | "files">("app");
  const [filter, setFilter] = useState<"all" | "needs" | "live" | "drafts">("all");
  const [prompt, setPrompt] = useState("");
  const [talk, setTalk] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [toggle, setToggle] = useState(true);
  const [size, setSize] = useState<"desktop" | "phone">("desktop");
  const [point, setPoint] = useState(false);
  const [help, setHelp] = useState(false);
  const [answer, setAnswer] = useState("acme");
  const [target, setTarget] = useState<"test" | "team" | "live">("team");

  return (
    <div data-theme={dark ? "dark" : "light"} className="min-h-dvh bg-canvas p-6 text-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-title font-[650]">Component kit</h1>
          <span className="flex-1" />
          <Toggle checked={dark} onCheckedChange={setDark} label="Dark theme" />
        </div>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon="plus">New project</Button>
            <Button>Share</Button>
            <Button variant="quiet">Discard</Button>
            <Button size="sm">Small</Button>
            <Button variant="primary" disabledReason="Answer 1 question to build">Build · ~160 credits</Button>
            <Button disabledReason="Fix the checklist first">Share with your team</Button>
            <IconButton icon="help" label="Help" />
            <IconButton icon="more" label="More" quiet />
            <TextLink href="/projects">All projects</TextLink>
          </div>
        </Section>

        <Section title="Pills, tags, status">
          <div className="flex flex-wrap items-center gap-2">
            <Pill icon="plus">Add files, agents or tools</Pill>
            <ModeSwitch ask={talk} onChange={setTalk} />
            <Pill soft iconAfter="chevronDown">Gemini</Pill>
            <Tag>Template</Tag>
            <SimTag />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {(["works", "building", "attention", "approval", "failed", "blocked", "todo"] as const).map((s) => (
              <StatusMark key={s} status={s} label={s} />
            ))}
            <StatusMark status="attention" icon="plug" />
            <StatusMark status="attention" icon="lines" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <StatusWord status="attention">Needs you: connect Gmail</StatusWord>
            <StatusWord status="approval">Waiting for IT approval</StatusWord>
            <StatusWord status="blocked">Blocked: budget used</StatusWord>
            <StatusLine status="blocked" icon="pause">Blocked: raise budget</StatusLine>
          </div>
        </Section>

        <Section title="Stepper and segmented">
          <Stepper current="plan" progress="1 question left" />
          <Stepper current="build" progress="7 of 12 working · about 6 min" />
          <Stepper current="build" progress="paused at budget" paused />
          <div className="flex flex-wrap gap-3">
            <Segmented label="Stage view" value={view} onChange={setView} options={[{ value: "app", label: "App" }, { value: "files", label: "Plan" }, { value: "agents", label: "Agents" }, { value: "data", label: "Data" }]} />
            <Segmented mode="filter" label="Filter projects" value={filter} onChange={setFilter} options={[{ value: "all", label: "All", count: 4 }, { value: "needs", label: "Needs you", count: 2 }, { value: "live", label: "Live", count: 1 }, { value: "drafts", label: "Drafts", count: 1 }]} />
          </div>
        </Section>

        <Section title="Composer">
          <Composer
            variant="home"
            value={prompt}
            onChange={setPrompt}
            onSubmit={() => {}}
            talkFirst={talk}
            onTalkFirstChange={setTalk}
            placeholder="Describe the app you want…"
            attachments={<AttachmentChip icon="file" onRemove={() => {}}>agenda-template.pdf</AttachmentChip>}
            modelPicker={<Pill soft iconAfter="chevronDown">Gemini</Pill>}
            contextPills={<><Pill icon="plus">Add files, agents or tools</Pill><Pill icon="repo">Import a repo</Pill><Pill icon="grid">Templates and prompts</Pill><Pill icon="sparkle">Help me decide</Pill></>}
          />
          <div className="w-[344px]">
            <QueueLine onEdit={() => {}}>Also send me a Friday recap</QueueLine>
            <Composer variant="chat" value="" onChange={() => {}} onSubmit={() => {}} talkFirst={false} onTalkFirstChange={() => {}} placeholder="Change anything in plain words…" modelPicker={<Pill soft iconAfter="chevronDown">Sonnet</Pill>} />
          </div>
        </Section>

        <Section title="Plan panel, needs you, change card">
          <div className="flex flex-wrap items-start gap-4">
            <div className="h-[520px]">
              <PlanPanel version="v1 · draft" intro="Read it, change anything in plain words, then click Build." progress={{ value: 7 / 12, label: "7 of 12 parts work · 112 of ~160 credits" }}>
                <PlanGroup title="Needs you" count={1}>
                  <NeedsYouCard status="attention" icon="plug" name="Last email thread per attendee" action={<Button variant="primary" size="sm">Connect Google account</Button>}>
                    Briefs still go out, using sample emails until you connect.
                  </NeedsYouCard>
                </PlanGroup>
                <PlanGroup title="In progress" count={1}>
                  <PlanRow status="building" title="Brief writer" detail="Building now" />
                </PlanGroup>
                <PlanGroup title="Works" count={5} collapseAfter={3}>
                  {["Calendar read", "Slack delivery", "Agenda summary", "Talking points", "Sign-in"].map((t) => <PlanRow key={t} status="works" title={t} />)}
                </PlanGroup>
                <PlanGroup title="Up next" count={1}>
                  <PlanRow status="todo" title="Friday recap" detail="Set aside" />
                </PlanGroup>
              </PlanPanel>
            </div>
            <div className="flex w-[320px] flex-col gap-3">
              <ChangeCard cost="~18 credits · about 3 min" onApply={() => {}}>Add a <b>Friday recap</b> of the week&apos;s meetings.</ChangeCard>
              <ChangeCard cost="~18 credits" applyDisabledReason="Viewers can't apply changes">Viewer sees why Apply is off.</ChangeCard>
            </div>
          </div>
        </Section>

        <Section title="Stage banners">
          <StageBanner kind="question" title="Which Slack workspace should briefs go to?" actions={<><Option selected={answer === "acme"} onClick={() => setAnswer("acme")}>Acme <Tag>recommended</Tag></Option><Option selected={answer === "sandbox"} onClick={() => setAnswer("sandbox")}>Acme-sandbox</Option></>}>
            There&apos;s no safe default, so Build waits for your answer.
          </StageBanner>
          <StageBanner kind="paused" title="Paused at the 100-credit budget" actions={<><Button variant="primary">Raise budget to 125 and continue</Button><Button>Set the parts aside</Button><Button variant="quiet">Stop here</Button></>}>
            4 of 7 parts work and are kept. 100 credits spent.
          </StageBanner>
          <StageBanner kind="error" title="The plan stopped part-way" actions={<><Button variant="primary">Try again</Button><Button>Try with another model</Button><Button variant="quiet">Edit my request</Button></>}>
            8 parts are kept. 3 credits spent.
          </StageBanner>
        </Section>

        <Section title="Lists, templates, empty state">
          <Tray label="Projects">
            <ListRow icon="calendar" darkTile name="Meeting Prep" meta="Morgan · 2 h ago · 172 credits" tools={["Calendar", "Gmail", "Slack"]} status={<StatusWord status="attention">Needs you: connect Gmail</StatusWord>} trailing={<IconButton icon="more" label="More for Meeting Prep" quiet size={32} />} href="#" />
            <ListRow icon="lines" name="ticket-triage" meta="Sam · yesterday · 96 credits" tools={["Zendesk", "Slack"]} status={<StatusWord status="approval">Waiting for IT approval</StatusWord>} />
          </Tray>
          <div className="grid gap-3 sm:grid-cols-3">
            <TemplateCard icon="chat" kind="Agentlet" name="Support triage" description="Sorts new tickets and drafts replies." footer="Zendesk · Slack · ~90 credits" />
            <TemplateCard icon="search" kind="Template" name="Lead research" description="Finds facts about new leads." footer="HubSpot · ~120 credits" />
            <TemplateCard icon="doc" kind="Template" name="Contract digest" description="Summarises contracts you upload." footer="~70 credits" />
          </div>
          <EmptyState icon="newProject" title="No projects yet" primary={<Button variant="primary">Describe an app</Button>} alternative={<Button>Import a repo</Button>} help={<TextLink>How Architect works</TextLink>}>
            Describe what you need and Architect writes the plan. Nothing is built until you click Build.
          </EmptyState>
        </Section>

        <Section title="Preview, versions, settings, table">
          <div className="flex h-[260px] flex-col">
            <PreviewFrame url="meeting-prep--test.architect.space" badge={<span className="inline-flex h-6 items-center rounded-full bg-building-bg px-2.5 text-small font-[650] text-building">Test version</span>} dock={<PreviewDock size={size} onSizeChange={setSize} pointing={point} onPointToggle={() => setPoint(!point)} problems={2} onOpenProblems={() => {}} />}>
              <div className="p-6 text-[#1d2330]">The app preview goes here.</div>
            </PreviewFrame>
          </div>
          <VersionCards target={target} onSelect={setTarget} cards={[{ id: "test", order: "Now", name: "Test version", audience: "Only you" }, { id: "team", order: "Next", name: "Team version", audience: "People in Acme Ops", status: "Blocked by 2 checklist items" }, { id: "live", order: "Then", name: "Live", audience: "Anyone with the link" }]} />
          <Toggle checked={toggle} onCheckedChange={setToggle} label="Show the Architect badge" consequence="A small badge in the corner of your app." />
          <div className="rounded-card border border-line">
            <SettingRow label="When briefs arrive" value="30 minutes before each meeting" action={<TextLink>Change</TextLink>} />
            <SettingRow label="Delivered as" value="A Slack direct message to you" action={<TextLink>Change</TextLink>} />
          </div>
          <DataTable caption="Usage" rowKey={(r) => r.id} rows={[{ id: "1", what: "Build · Meeting Prep", credits: 112 }, { id: "2", what: "Fix · Brief writer, try 1 of 3", credits: 3 }]} columns={[{ key: "what", header: "What", cell: (r) => r.what }, { key: "credits", header: "Credits", numeric: true, cell: (r) => r.credits }]} />
        </Section>

        <Section title="Drawer and help">
          <div className="flex gap-2">
            <Button onClick={() => setDrawer(true)}>Open a part</Button>
            <Button onClick={() => setHelp(true)}>Open help</Button>
          </div>
          <Drawer open={drawer} onOpenChange={setDrawer} icon={<StatusMark status="blocked" />} title="Brief writer" state="Blocked after 3 tries. The rest of the app works." footer={<><Button variant="primary">Allow 250 words</Button><Button>Edit this part</Button><Button variant="quiet">Set aside for now</Button></>}>
            <p>Check: the brief is 200 words or fewer.</p>
          </Drawer>
          <HelpPanel open={help} onClose={() => setHelp(false)} peopleOnline greeting={<>Hi Morgan. <b>Lead scorer</b> is blocked at its budget. What can I help with?</>} suggestions={["Why did Lead scorer stop?", "How are credits worked out?"]} messages={[]} pending={false} draft="" onDraftChange={() => {}} onAsk={() => {}} onTalkToPerson={() => {}} />
        </Section>
      </div>
    </div>
  );
}
