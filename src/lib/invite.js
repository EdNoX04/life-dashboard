// What actually goes on the clipboard.
//
// A bare URL is the least useful thing to paste into a chat. It carries no date,
// no time and no zone — and a Meet link is NOT time-restricted, so anyone holding
// it can join whenever they like. There is no Calendar API setting that changes
// that; Google does not gate a Meet room to its event window. The honest fix is
// therefore not to pretend the link is bounded, but to make the message say when
// the meeting actually is, in a form a person can read at a glance.
export function inviteText(m, tzLabel = 'IST') {
  if (!m?.meet) return '';
  const d = new Date(m.start);
  const day = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const t = x => new Date(x).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const when = m.end ? `${t(m.start)} – ${t(m.end)}` : t(m.start);
  return [
    m.title || 'Meeting',
    `${day} · ${when} ${tzLabel}`,
    '',
    `Join: ${m.meet}`,
  ].join('\n');
}

