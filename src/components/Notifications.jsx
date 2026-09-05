import React, { useEffect, useState } from 'react';
import * as notify from '../lib/notify.js';
import * as alarm from '../lib/alarm.js';

// The app-wide notification surface.
//
// WHY THE BANNER EXISTS AT ALL
//
// The pomodoro's popup switch shipped working and did nothing for anybody,
// because it was one small button at the bottom of one card in one tab. Neel
// looked for it twice and reported notifications as broken. They were not
// broken; `Notification.permission` was still `default`, which means the browser
// had never been asked, which means the button had never been found.
//
// A permission that must be granted exactly once, from a click, and that cannot
// be requested again once refused, is not something to hide. So it is asked for
// at the top of the app, once, and dismissible forever.

function useNotifyState() {
  const [, bump] = useState(0);
  useEffect(() => notify.subscribe(() => bump(n => n + 1)), []);
  const [perm, setPerm] = useState(notify.permission);
  return { perm, setPerm };
}

/** One line at the top of the app. Mounted once, at the root. */
export function NotifyBanner() {
  const { perm, setPerm } = useNotifyState();
  const [gone, setGone] = useState(notify.bannerDismissed);

  // Nothing to say once it is granted, and nothing to say if he has waved it
  // away. `denied` still shows, because that is the one state where the app can
  // never ask again and the person needs to know where the switch went.
  if (gone || perm === 'granted' || perm === 'unsupported') return null;

  const dismiss = () => { notify.dismissBanner(); setGone(true); };

  return (
    <div className="notify-bar">
      <span className="notify-bar-i">🔔</span>
      {perm === 'denied' ? (
        <span className="notify-bar-t">
          Notifications are blocked for this site. Chrome will not ask again —
          click the padlock in the address bar → Notifications → Allow.
        </span>
      ) : (
        <span className="notify-bar-t">
          Turn on notifications and PLAYER ONE can tell you when a focus block ends,
          when a class is about to start, and when a SIP fails.
        </span>
      )}
      {perm === 'default' && (
        <button className="btn btn-sm btn-cyan" onClick={async () => setPerm(await notify.ask())}>
          Enable
        </button>
      )}
      <button className="notify-bar-x" onClick={dismiss} title="Not now">✕</button>
    </div>
  );
}

/**
 * The full panel, for Settings.
 *
 * Every channel says what it needs to be open, because none of this fires when
 * PLAYER ONE is closed — the timers live in the page. Saying so here is the
 * difference between a feature and a false promise.
 */
export function NotifySettings() {
  const { perm, setPerm } = useNotifyState();
  const [, bump] = useState(0);
  const p = notify.prefs();

  const toggle = id => {
    notify.setPrefs({ enabled: { ...p.enabled, [id]: !notify.isOn(id) } });
    bump(n => n + 1);
  };

  return (
    <div className="notify-panel">
      <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="chip" style={{
          borderColor: perm === 'granted' ? 'var(--green)' : 'var(--yellow, var(--pink))',
          color: perm === 'granted' ? 'var(--green)' : 'var(--yellow, var(--pink))',
        }}>
          {perm === 'granted' ? '✓ allowed' : perm === 'denied' ? '✕ blocked' : '• not asked yet'}
        </span>
        {perm === 'default' && (
          <button className="btn btn-sm btn-cyan" onClick={async () => setPerm(await notify.ask())}>
            Enable notifications
          </button>
        )}
        {perm === 'granted' && (
          <button className="btn btn-sm" onClick={() => alarm.notify('PLAYER ONE', 'This is what one looks like.', 'p1-test')}>
            Send a test
          </button>
        )}
        {perm === 'denied' && (
          <span className="small muted">Unblock in the padlock menu — the page cannot ask again.</span>
        )}
      </div>

      {perm === 'granted' && (
        <div className="small muted" style={{ lineHeight: 1.6, marginBottom: 12 }}>
          On a Mac these also need <b>System Settings → Notifications → Google Chrome</b> switched
          on. Chrome grants the permission happily and then shows nothing if the OS has it off,
          which looks exactly like a broken app.
        </div>
      )}

      <div className="notify-list">
        {notify.CHANNELS.map(c => {
          const on = notify.isOn(c.id);
          return (
            <div key={c.id} className={`notify-row ${on ? 'on' : ''}`}>
              <button className={`btn btn-sm ${on ? 'btn-green' : ''}`}
                aria-pressed={on} onClick={() => toggle(c.id)}>
                {on ? '● on' : '○ off'}
              </button>
              <div className="notify-row-t">
                <b>{c.label}</b>
                <span className="notify-needs" title="Where this one's data lives">needs {c.needs} open</span>
                <div className="small muted">{c.note}</div>
              </div>
            </div>
          );
        })}
      </div>

      {notify.isOn('money') && (
        <label className="notify-thresh">
          <span className="small muted">Tell me when a holding moves more than</span>
          <input type="number" inputMode="numeric"
            min={notify.MIN_MOVE} max={notify.MAX_MOVE} value={p.movePct}
            onChange={e => { notify.setPrefs({ movePct: e.target.value }); bump(n => n + 1); }} />
          <b>% in a day</b>
        </label>
      )}

      <div className="small muted mt" style={{ lineHeight: 1.6 }}>
        These arrive only while PLAYER ONE is open in a tab — the timers that decide
        when to speak live in the page. Delivery with the app closed needs a push
        subscription and a server to send from, and neither exists yet.
      </div>
    </div>
  );
}
