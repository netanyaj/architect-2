/**
 * Intent (M5.8, replaces the Ask · Make changes switch): is a chat message a question or a change request?
 * Rules first, so most messages cost nothing; only the ones the rules can't call go to one cheap model call.
 * Shared and pure (no I/O), so it's unit-tested on its own.
 */
export type Intent = "question" | "change";

/** Verbs that ask for something to be different. */
const CHANGE_VERBS =
  "add|remove|delete|drop|change|make|send|post|include|exclude|rename|replace|use|switch|connect|build|create|let|allow|stop|update|set|turn|move|show|hide|skip|swap|fix|support|attach|keep|split|merge|limit|cap|raise|lower|increase|decrease|email|notify|schedule|translate|export|import|sort|filter|group|track|log|store|save|ask|require|restrict|block|run|edit|undo|write";
const QUESTION_WORDS = "why|what|whats|what's|how|when|where|who|whom|whose|which|is|are|was|were|does|do|did|has|have|had|will|would|should|could|can|may|might|am";

const lower = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The rules: a clear request ("Add Slack", "Please send it at 9", "Can you add a filter?", "I want it to…", "also…")
 * is a change; a clear question ("Why did…?", "What would Excel support cost?", "How does the check work?") is a
 * question. Returns null when the rules can't tell (the model decides, and the card offers "Just answer instead").
 */
export function intentByRules(message: string): Intent | null {
  const m = lower(message).replace(/^(hi|hey|ok|okay|thanks|great|cool|so|and|but)[,!.]?\s+/, "");
  if (!m) return null;
  const verbs = new RegExp(`^(?:${CHANGE_VERBS})\\b`);
  const asksFor = /^(?:(?:can|could|would|will) you(?: please)?|(?:can|could|shall) we|please|pls|let's|lets|also|i want(?: it)? to|i'd like(?: it)? to|i would like(?: it)? to|i need(?: it)? to|we need(?: it)? to|it should|it needs to|make sure)\b\s*/;
  const ask = m.endsWith("?");

  // "Can you add…?", "Please send…", "Also post…", "I want it to email…": a change, question mark or not.
  const after = m.replace(asksFor, "");
  if (after !== m && (verbs.test(after) || /^(it|this|the|a|an|my|our)\b/.test(after))) {
    // "Could you explain…?" / "Can you tell me…?" are questions in a request's clothes.
    if (/^(explain|tell|describe|walk|show me why|clarify|remind)\b/.test(after)) return "question";
    return "change";
  }
  // "Show me…" reads things; it doesn't change them.
  if (/^show me\b/.test(m)) return ask ? "question" : null;
  // An imperative opening: "Add a Slack step", "Send briefs at 8".
  if (verbs.test(m) && !ask) return "change";
  // "Is it possible to add Slack?": a request asked as a question. The model decides.
  if (ask && /\b(possible to|able to|any way to|a way to)\b/.test(m)) return null;
  // "Instead of email, Slack" / "No PDFs" / "Only on weekdays": a change without a verb.
  if (/^(instead of|rather than|no more|only|don't|do not|never|always)\b/.test(m) && !ask) return "change";
  // Wh- and yes/no questions ("Why…?", "Is there…?", "What would Excel support cost?").
  if (new RegExp(`^(?:${QUESTION_WORDS})\\b`).test(m) && (ask || /^(why|what|whats|what's|how|when|where|who|which)\b/.test(m))) {
    // "What if we added Slack?" / "How about weekly?" lean towards a change, but stay unclear for the model.
    if (/^(what if|how about|what about)\b/.test(m)) return null;
    return "question";
  }
  // "Explain the rate-card check" / "Tell me…" / "I don't understand…": a question without a question mark.
  if (/^(explain|tell me|describe|help me understand|i don't understand|i do not understand|i'm confused|im confused)\b/.test(m)) return "question";
  return null;
}
