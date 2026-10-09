import { useEffect, useState } from 'react';

export default function App() {
  const [tickets, setTickets] = useState([]);
  const [onlyP1, setOnlyP1] = useState(false);
  const [busy, setBusy] = useState(null);

  useEffect(() => { fetch('/api/tickets').then(r => r.json()).then(setTickets); }, []);

  const triage = async id => {
    setBusy(id);
    const t = await fetch(`/api/tickets/${id}/triage`, { method: 'POST' }).then(r => r.json());
    setTickets(ts => ts.map(x => (x.id === id ? t : x)));
    setBusy(null);
  };

  // BUG: the filter ignores onlyP1, so every ticket is always shown.
  const visible = tickets.filter(t => (onlyP1 ? true : true));

  return (
    <main>
      <header>
        <h1>Ticket Triage</h1>
        <label><input type="checkbox" checked={onlyP1} onChange={e => setOnlyP1(e.target.checked)} /> Only P1</label>
      </header>
      <table>
        <thead><tr><th>ID</th><th>Customer</th><th>Subject</th><th>Priority</th><th>Team</th><th></th></tr></thead>
        <tbody>
          {visible.map(t => (
            <tr key={t.id}>
              <td>{t.id}</td><td>{t.customer}</td><td>{t.subject}</td>
              <td>{t.triage?.priority ?? '—'}</td><td>{t.triage?.team ?? '—'}</td>
              <td><button disabled={busy === t.id} onClick={() => triage(t.id)}>{busy === t.id ? 'Triaging…' : 'Triage'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
