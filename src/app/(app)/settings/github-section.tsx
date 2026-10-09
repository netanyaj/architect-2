"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ax/button";
import { Toggle } from "@/components/ax/toggle";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { disconnectGitHub } from "@/server/actions/import";

export type GitHubInstallRow = {
  installationId: number;
  accountLogin: string;
  accountType: string;
  manageUrl: string;
  repos: { fullName: string; private: boolean; project: string | null }[] | null;
  problem: string | null;
};

const link = "text-body font-semibold underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink";

/**
 * Settings › GitHub (BL-11): the App's installations this workspace uses, the repos each can read, connect or
 * disconnect, and Manage on GitHub. Real. Real pull requests stay off: they'd need Contents: Read and write.
 */
export function GitHubSection({ installs, installUrl, canConnect, canDisconnect }: { installs: GitHubInstallRow[]; installUrl: string | null; canConnect: boolean; canDisconnect: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState<GitHubInstallRow | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <section aria-labelledby="github" className="flex flex-col gap-3">
      <h2 id="github" className="text-heading font-[650]">
        GitHub
      </h2>
      <div className="flex flex-col gap-4 rounded-card border border-line p-4">
        <p className="text-ink-2">Architect&apos;s GitHub App reads only the repos you chose: their files, branches and settings. Changes come back as pull requests, and nothing reaches main until someone merges.</p>
        {installs.length === 0 ? (
          <p>No GitHub account is connected to this workspace.</p>
        ) : (
          <ul aria-label="GitHub accounts" className="flex flex-col divide-y divide-line rounded-card border border-line">
            {installs.map((i) => (
              <li key={i.installationId} className="flex flex-col gap-2 p-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex-1 font-semibold">
                    {i.accountLogin} <span className="font-normal text-ink-2">· {i.accountType === "Organization" ? "organisation" : "personal account"} · installation {i.installationId}</span>
                  </span>
                  <a href={i.manageUrl} target="_blank" rel="noreferrer" className={link}>
                    Manage on GitHub
                  </a>
                  <Button size="sm" disabledReason={canDisconnect ? undefined : "Only Owners and Admins can disconnect GitHub."} onClick={() => setAsking(i)}>
                    Disconnect
                  </Button>
                </div>
                {i.problem ? (
                  <p role="alert" className="text-small font-semibold text-failed">
                    {i.problem}
                  </p>
                ) : (
                  <ul aria-label={`Repos ${i.accountLogin} shares`} className="flex flex-col gap-1 text-small">
                    {(i.repos ?? []).map((r) => (
                      <li key={r.fullName} className="flex flex-wrap items-center gap-2">
                        <code className="font-mono">{r.fullName}</code>
                        <span className="text-ink-2">{r.private ? "private" : "public"}</span>
                        {r.project && (
                          <a href={`/p/${r.project}`} className="font-semibold underline decoration-line-ctl underline-offset-[3px]">
                            Open its project
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {installUrl &&
            (canConnect ? (
              <a href={installUrl} className={buttonClasses({ size: "sm" })}>
                {installs.length ? "Install on more repos" : "Install the GitHub App"}
              </a>
            ) : (
              <Button size="sm" disabledReason="Viewers can't connect GitHub.">
                Install the GitHub App
              </Button>
            ))}
          {canConnect && (
            <a href="/api/github/connect" className={link}>
              {installs.length ? "Connect another account" : "Already installed? Connect it"}
            </a>
          )}
        </div>
        <Toggle
          checked={false}
          onCheckedChange={() => {}}
          label="Open real PRs on test repos"
          consequence="Off: pull requests are simulated, and nothing is written to your repos."
          disabledReason="Needs Contents: Read and write on the GitHub App (it can only read now). Ask the person who manages the App."
        />
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
      </div>
      <Dialog open={asking !== null} onOpenChange={(o) => !o && setAsking(null)}>
        <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[460px]" showCloseButton={false}>
          <DialogTitle className="text-sub font-semibold">Disconnect {asking?.accountLogin}?</DialogTitle>
          <DialogDescription className="text-ink-2">
            Architect stops reading its repos in this workspace. Projects imported from them keep their plans, but their files can&apos;t be read until you connect it again. The App stays installed on GitHub; remove it there with Manage on GitHub.
          </DialogDescription>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="quiet" onClick={() => setAsking(null)}>
              Keep it
            </Button>
            <Button
              variant="primary"
              disabledReason={pending ? "Disconnecting…" : undefined}
              onClick={() =>
                start(async () => {
                  setError(undefined);
                  const r = await disconnectGitHub({ installationId: asking!.installationId });
                  setAsking(null);
                  if (!r.ok) setError(r.message);
                  router.refresh();
                })
              }
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
