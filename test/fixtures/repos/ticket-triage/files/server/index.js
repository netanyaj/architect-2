import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { aiTriage } from './triage.js';

const DB = new URL('../data/tickets.json', import.meta.url);
const app = express();
app.use(express.json());

const load = async () => JSON.parse(await readFile(DB, 'utf8'));
const save = async t => writeFile(DB, JSON.stringify(t, null, 2));

app.get('/api/tickets', async (_req, res) => res.json(await load()));

app.post('/api/tickets/:id/triage', async (req, res) => {
  const tickets = await load();
  const t = tickets.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  t.triage = await aiTriage(t);
  await save(tickets);
  if (t.triage.priority === 'P1' && process.env.SLACK_WEBHOOK_URL) {
    await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `P1 ticket: ${t.subject}` }) }).catch(() => {});
  }
  res.json(t);
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API on :${port}`));
