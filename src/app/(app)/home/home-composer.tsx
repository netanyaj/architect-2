"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { AttachmentChip, Composer } from "@/components/ax/composer";
import { ModelPicker } from "@/components/ax/model-picker";
import { Pill } from "@/components/ax/pill";
import { TemplatesDialog } from "@/components/ax/templates-dialog";
import { loginUrl, PENDING_PROMPT_KEY } from "@/lib/auth-paths";
import { createBrowserDb } from "@/lib/db";
import { useHomePrompt } from "@/lib/home-prompt";
import { formatBytes, UPLOAD_LIMITS } from "@/lib/uploads";
import { AUTO, DEFAULT_MODEL, type ModelChoice, type ModelOption, type ModelPick } from "@/lib/models";
import { startProject } from "@/server/actions/projects";
import { finishUploads } from "@/server/actions/uploads";
import { AddMenu, type AttachedAgent } from "./attach-agent";

function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * Home's hero: greeting, heading and the composer.
 * Signed out, Write the plan keeps the prompt through sign-in. Signed in, it creates the project and opens it.
 */
export function HomeComposer({
  signedIn,
  firstName,
  startBlockedReason,
  initialPrompt,
  models,
  defaultModel = DEFAULT_MODEL,
  blockedModels = [],
}: {
  signedIn: boolean;
  firstName?: string;
  /** Why this person can't start a project (Viewers). */
  startBlockedReason?: string;
  /** From a Marketplace pick (?starter=). A prompt kept through sign-in wins. */
  initialPrompt?: string;
  /** The models this workspace allows (all of them when signed out). */
  models: ModelOption[];
  /** Blocked by the workspace's policy: listed in the picker, disabled (M5.8). */
  blockedModels?: ModelOption[];
  /** The model Auto uses (M5.8): the policy's Architect model (C-2), else Gemini. */
  defaultModel?: ModelChoice;
}) {
  const router = useRouter();
  const { prompt, setPrompt, templatesOpen, setTemplatesOpen } = useHomePrompt();
  // Auto first and by default (M5.8): it picks a model for each step.
  const [model, setModel] = useState<ModelPick>(AUTO);
  const [hello, setHello] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const [agents, setAgents] = useState<AttachedAgent[]>([]);
  const [progress, setProgress] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setError(undefined);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!UPLOAD_LIMITS.types.includes(f.type) && !/\.(csv|xlsx)$/i.test(f.name)) {
        setError(`${f.name} isn't a PDF, a CSV or Excel file, or an image (PNG, JPG, WebP).`);
        continue;
      }
      if (f.size > UPLOAD_LIMITS.maxBytes) {
        setError(`${f.name} is ${formatBytes(f.size)}. Files can be up to ${formatBytes(UPLOAD_LIMITS.maxBytes)}.`);
        continue;
      }
      if (next.length >= UPLOAD_LIMITS.maxFiles) {
        setError(`Attach up to ${UPLOAD_LIMITS.maxFiles} files.`);
        break;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next);
  };

  useEffect(() => {
    // Browser-only values, read after mount: the local time of day and a prompt kept through sign-in.
    /* eslint-disable react-hooks/set-state-in-effect */
    setHello(greeting(new Date()));
    try {
      const kept = sessionStorage.getItem(PENDING_PROMPT_KEY);
      if (kept) {
        setPrompt(kept);
        if (signedIn) sessionStorage.removeItem(PENDING_PROMPT_KEY);
      } else if (initialPrompt) {
        setPrompt(initialPrompt);
      }
    } catch {
      if (initialPrompt) setPrompt(initialPrompt);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [signedIn, setPrompt, initialPrompt]);

  const submit = (text: string) => {
    setError(undefined);
    if (!signedIn) {
      try {
        sessionStorage.setItem(PENDING_PROMPT_KEY, text);
      } catch {
        // Storage blocked: they'll retype after signing in.
      }
      router.push(loginUrl("/home"));
      return;
    }
    start(async () => {
      // Without files the action opens the new project itself; it only returns when something's wrong.
      const r = await startProject({ prompt: text, model, agents, files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })) });
      if (!r) return;
      if (!r.ok) return setError(r.message);
      if (!r.projectId || !r.uploads) return;
      // Files go straight to private storage (no size limit from our server in between), then the server reads them.
      const db = createBrowserDb();
      const done: { name: string; path: string }[] = [];
      for (const [i, slot] of r.uploads.entries()) {
        setProgress(`Uploading ${i + 1} of ${r.uploads.length}: ${slot.name}`);
        const file = files.find((f) => f.name === slot.name)!;
        const { error: upErr } = await db.storage.from("uploads").uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
        if (!upErr) done.push({ name: slot.name, path: slot.path });
      }
      setProgress("Reading your files…");
      const fin = await finishUploads({ projectId: r.projectId, uploads: done });
      if (fin.ok && fin.unreadable.length) setProgress(`Couldn't read text from ${fin.unreadable.join(", ")}. The plan is written without it.`);
      router.push(`/p/${r.projectId}`);
    });
  };

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <span className="min-h-6 text-sub font-medium text-ink-2">{hello && (firstName ? `${hello}, ${firstName}` : hello)}</span>
        <h1 className="text-display font-[650] tracking-[-0.03em] max-sm:text-title">What should we build?</h1>
        <p className="text-sub text-ink-2">Describe it once. You’ll see the full plan and what it costs before anything is built.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Composer
          variant="home"
          value={prompt}
          onChange={setPrompt}
          onSubmit={submit}
          pending={pending}
          placeholder="Describe the app you want. For example: before each meeting, send me a Slack brief with each attendee’s last email."
          label="Describe your app"
          attachments={
            files.length || agents.length ? (
              <>
                {agents.map((a) => (
                  <AttachmentChip key={a.id} icon="agent" onRemove={() => setAgents(agents.filter((x) => x.id !== a.id))}>
                    {a.name} <span className="text-small text-ink-3">Lyzr Studio agent</span>
                  </AttachmentChip>
                ))}
                {files.map((f) => (
                  <AttachmentChip key={`${f.name}-${f.size}`} icon="file" onRemove={() => setFiles(files.filter((x) => x !== f))}>
                    {f.name} <span className="text-small text-ink-3">{formatBytes(f.size)}</span>
                  </AttachmentChip>
                ))}
              </>
            ) : undefined
          }
          submitDisabledReason={signedIn ? startBlockedReason : undefined}
          modelPicker={
            <ModelPicker<ModelPick>
              value={model}
              options={models}
              blocked={blockedModels}
              auto
              autoResolves={models.find((m) => m.choice === defaultModel)?.label ?? models[0]?.label}
              onChange={setModel}
            />
          }
          contextPills={
            <>
              <AddMenu
                onAddFiles={() => fileInput.current?.click()}
                attached={agents}
                onAttach={(a) => setAgents([...agents, a])}
                disabledReason={signedIn ? undefined : "Sign in to attach your agents."}
              />
              <Pill icon="repo" onClick={() => router.push("/import")} disabledReason={signedIn ? undefined : "Sign in to import a repo."}>
                Import a repo
              </Pill>
              <Pill icon="grid" onClick={() => setTemplatesOpen(true)}>
                Templates and prompts
              </Pill>
              <Pill icon="sparkle" onClick={() => router.push("/home/decide")} disabledReason={signedIn ? undefined : "Sign in to get ideas."}>
                Help me decide
              </Pill>
            </>
          }
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={UPLOAD_LIMITS.accept}
          aria-label="Add files: PDFs, CSV or Excel files, or images"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {progress && (
          <p role="status" className="text-small text-ink-2">
            {progress}
          </p>
        )}
        {signedIn && startBlockedReason && <p className="text-small text-ink-2">{startBlockedReason}</p>}
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
      </div>
      <TemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onPick={(s) => {
          setPrompt(s.prompt);
          setTemplatesOpen(false);
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')?.focus());
        }}
      />
    </>
  );
}
