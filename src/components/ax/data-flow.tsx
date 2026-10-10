import type { FlowPath } from "@/lib/egress";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { Tag } from "./pill";
import { StatusMark } from "./status-mark";

/**
 * The data-flow view (C-4): each place a project's data would go, as project → what it sends → where. A path the
 * policy doesn't allow is highlighted with the rule it breaks; personal data taken out first is listed on model paths.
 */
export function DataFlow({ project, paths, label = "Where data goes" }: { project: string; paths: FlowPath[]; label?: string }) {
  if (!paths.length) return <p className="text-small text-ink-2">Nothing leaves this project: it uses no apps or models outside it.</p>;
  const sorted = [...paths].sort((a, b) => Number(a.allowed) - Number(b.allowed));
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {sorted.map((p) => (
        <li key={p.id} className={cn("flex flex-col gap-2 rounded-card border p-3.5", p.allowed ? "border-line" : "border-attention")}>
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusMark status={p.allowed ? "works" : "attention"} icon={p.allowed ? "check" : "alert"} />
            <strong className="font-[650]">
              {p.to} <span className="font-normal text-ink-2">· {p.kind === "app" ? "app" : "model"}</span>
            </strong>
            <span className={cn("ml-auto text-small font-semibold", p.allowed ? "text-ink-2" : "text-attention")}>{p.allowed ? "Allowed" : "Not allowed"}</span>
          </div>
          <div className="ml-7 flex flex-wrap items-center gap-1.5 text-small">
            <Tag>{project}</Tag>
            <Icon name="arrowRight" size="sm" className="text-ink-3" />
            <Tag>{p.data}</Tag>
            <Icon name="arrowRight" size="sm" className="text-ink-3" />
            <Tag className={p.allowed ? undefined : "bg-attention-bg text-attention"}>{p.host}</Tag>
          </div>
          <p className="ml-7 text-small text-ink-2">From {p.from.join(", ")}.</p>
          {p.rule && <p className="ml-7 text-small font-semibold text-attention">Breaks the rule: {p.rule}.</p>}
          {p.redacted.length > 0 && <p className="ml-7 text-small text-ink-2">Taken out before it leaves: {p.redacted.join(", ")}.</p>}
        </li>
      ))}
    </ul>
  );
}
