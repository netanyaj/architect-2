import { Button } from "@/components/ax/button";
import { EmptyState } from "@/components/ax/empty-state";

export default function ProjectNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="rounded-pane border border-line bg-surface shadow-pane">
        <EmptyState icon="projects" title="This project isn't here" primary={<Button variant="primary" href="/projects">Go to your projects</Button>}>
          It was deleted, or it&apos;s in a workspace you&apos;re not part of. Ask whoever sent the link to invite you.
        </EmptyState>
      </div>
    </main>
  );
}
