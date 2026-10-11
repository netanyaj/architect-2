/**
 * Files attached to a request become parts (simulated, like today's Architect): a PDF becomes a knowledge base the
 * agents search, and a CSV a data analyst that answers questions about it. Added after the plan is written when the
 * plan doesn't already use the file, so they're there whatever the model wrote. Shared; no I/O.
 */
import type { Item } from "./blueprint";

export type AttachedFile = { name: string; kind: "pdf" | "csv" };

/** "agenda.pdf" → pdf, "leads.csv" → csv; images and anything else aren't parts. */
export function attachedFileKind(name: string): AttachedFile["kind"] | null {
  return /\.pdf$/i.test(name) ? "pdf" : /\.(csv|xlsx)$/i.test(name) ? "csv" : null;
}

/** The quote a file's part shows: "From your file: agenda.pdf". */
export const FILE_QUOTE = "Attached: ";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "file";

const short = (name: string, max: number) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

export function fileParts(files: AttachedFile[], items: Pick<Item, "key" | "title" | "description" | "grp">[]): Item[] {
  const out: Item[] = [];
  const keys = new Set(items.map((i) => i.key));
  for (const f of files) {
    const base = f.name.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
    const mentioned = items.some((i) => `${i.title} ${i.description}`.toLowerCase().includes(base));
    if (f.kind === "pdf" && !mentioned) {
      const key = `knowledge-${slug(f.name)}`;
      if (keys.has(key)) continue;
      keys.add(key);
      out.push({
        key,
        grp: "data",
        title: short(`Knowledge base from ${f.name}`, 60),
        description: short(`${f.name} is read into a knowledge base the agents search for answers.`, 200),
        proved_when: short(`Done when a question about ${f.name} is answered from it, citing the page`, 160),
        source_quote: short(`${FILE_QUOTE}${f.name}`, 120),
        item_class: "data.import",
        size: "s",
      });
    }
    if (f.kind === "csv" && !items.some((i) => i.grp === "agents" && `${i.title} ${i.description}`.toLowerCase().includes(base))) {
      const key = `analyst-${slug(f.name)}`;
      if (keys.has(key)) continue;
      keys.add(key);
      out.push({
        key,
        grp: "agents",
        title: short(`Data analyst for ${f.name}`, 60),
        description: short(`Answers questions about ${f.name} in plain words, with the rows it used.`, 200),
        proved_when: short(`Done when 3 sample questions about ${f.name} get answers that match its rows`, 160),
        source_quote: short(`${FILE_QUOTE}${f.name}`, 120),
        item_class: "agent.summariser",
        size: "m",
      });
    }
  }
  return out;
}
