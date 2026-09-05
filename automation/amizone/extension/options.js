// The options page, which doubles as the toolbar popup.
//
// The service key lives in chrome.storage.local and nowhere else — not in the
// repo, not in a config file, not in this page's markup. That is the same trust
// boundary as amizone.config.local.json: a secret on Neel's own machine, in a
// place git cannot reach.

const $ = id => document.getElementById(id);
const msg = (text, cls = 'muted') => { $('msg').className = cls; $('msg').textContent = text; };

(async function load() {
  const s = await chrome.storage.local.get(['supabaseUrl', 'serviceKey', 'everyMinutes', 'lastRun']);
  $('url').value = s.supabaseUrl || 'https://xroynvkzephebhcztvfo.supabase.co';
  $('key').value = s.serviceKey || '';
  $('every').value = s.everyMinutes || 30;
  if (s.lastRun) msg(s.lastRun.text, s.lastRun.ok ? 'ok' : 'bad');
})();

$('save').addEventListener('click', async () => {
  const every = Math.min(1440, Math.max(5, Number($('every').value) || 30));
  await chrome.storage.local.set({
    supabaseUrl: $('url').value.trim().replace(/\/+$/, ''),
    serviceKey: $('key').value.trim(),
    everyMinutes: every,
  });
  $('every').value = every;
  msg(`Saved. Running every ${every} minutes.`, 'ok');
});

$('now').addEventListener('click', async () => {
  msg('Fetching from Amizone…');
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'run-now' });
  } catch (e) {
    res = { ok: false, reason: String(e?.message || e) };
  }
  const text = res?.ok
    ? `Captured ${res.registers} attendance registers, ${res.diary} diary chunks and the placement page${res.placement === 200 ? '' : ' (FAILED — ' + res.placement + ')'} via ${res.via}. The sync will parse them.`
    : `Did not run — ${res?.reason || 'unknown error'}`;
  msg(text, res?.ok ? 'ok' : 'bad');
  // Remembered so reopening the popup shows the last outcome rather than a blank
  // panel, which reads as "nothing has ever happened".
  await chrome.storage.local.set({ lastRun: { ok: Boolean(res?.ok), text, at: Date.now() } });
});
