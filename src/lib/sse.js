// Reading a server-sent-event stream, one network chunk at a time.
//
// The bug this exists to prevent: a reader gives you BYTES, not messages. A
// single JSON line routinely arrives split across two reads — half in one chunk,
// half in the next — and code that does `chunk.split('\n')` and parses each
// piece works perfectly on a fast connection, then drops tokens on a slow one.
// It is the kind of failure that only shows up on the phone, on mobile data,
// halfway through the sentence you cared about.
//
// So: buffer, split on newlines, and keep the unterminated tail for next time.
// Pure and synchronous, so the awkward cases can be tested without a network.

export function createSSEParser(onEvent) {
  let buf = '';
  return {
    /** Feed one decoded chunk. Calls onEvent for each complete `data:` line. */
    push(chunk) {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || line.startsWith(':')) continue;      // blank line or comment
        if (!line.startsWith('data:')) continue;          // event:/id: are not used here
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let obj;
        try { obj = JSON.parse(payload); } catch { continue; }  // a torn line is skipped, never thrown
        onEvent(obj);
      }
    },
    /** Anything left after the last newline, in case a stream ends unterminated. */
    flush() {
      const rest = buf.trim();
      buf = '';
      if (!rest.startsWith('data:')) return;
      const payload = rest.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      try { onEvent(JSON.parse(payload)); } catch { /* half a line is not an event */ }
    },
  };
}
