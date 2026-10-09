// Rule-based triage used when no OPENAI_API_KEY is set.
const P1_WORDS = ['outage', 'down', 'cannot log in', 'data loss', 'security', 'breach'];
const P2_WORDS = ['error', 'slow', 'bug', 'broken', 'fails'];

export function ruleTriage(ticket) {
  const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
  const priority = P1_WORDS.some(w => text.includes(w)) ? 'P1'
    : P2_WORDS.some(w => text.includes(w)) ? 'P2' : 'P3';
  const team = /invoice|refund|billing|charge/.test(text) ? 'Billing'
    : /login|password|sso|access/.test(text) ? 'Identity' : 'Product';
  return { priority, team, reason: 'rule-based' };
}

export async function aiTriage(ticket) {
  if (!process.env.OPENAI_API_KEY) return ruleTriage(ticket);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Classify a support ticket. Reply JSON {"priority":"P1|P2|P3","team":"Billing|Identity|Product","reason":"..."}' },
        { role: 'user', content: `${ticket.subject}\n\n${ticket.body}` }
      ]
    })
  });
  if (!res.ok) return ruleTriage(ticket);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}
