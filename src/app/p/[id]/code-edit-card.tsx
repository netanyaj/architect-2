import { Icon } from "@/components/ax/icon";
import { SimTag } from "@/components/ax/pill";
import { StatusMark, StatusWord } from "@/components/ax/status-mark";
import { editLine, type CodeEditView } from "@/lib/code-edits";

/** A code edit from Developer view (simulated): which file, which part's check runs again, and how it went. */
export function CodeEditCard({ edit }: { edit: CodeEditView }) {
  return (
    <section aria-label={`Code edit to ${edit.path}`} className="flex w-full min-w-0 flex-col gap-1.5 rounded-card border border-line bg-surface px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="code" size="sm" />
        <h3 className="flex-1 font-[650]">{editLine(edit)}</h3>
        <SimTag title="Edits are simulated: nothing is written to a repo, and the check run is simulated." />
      </div>
      <p className="text-small text-ink-2">
        {edit.byKind === "coding_agent" ? `Coding agent: ${edit.by} · via MCP` : `By ${edit.by}`} · +{edit.added} −{edit.removed}
        {edit.prNumber ? ` · on PR #${edit.prNumber}` : ""}
      </p>
      {edit.check === "running" ? (
        <StatusWord status="building">{edit.partTitle}&apos;s check is running again</StatusWord>
      ) : (
        <span className="flex items-center gap-1.5 text-small">
          <StatusMark status="works" />
          {edit.partTitle}&apos;s check passed again
        </span>
      )}
    </section>
  );
}

