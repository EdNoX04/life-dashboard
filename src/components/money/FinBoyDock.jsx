import React, { useEffect, useState } from 'react';
import FinBoy from './FinBoy.jsx';

// FinBoy, everywhere on the tab.
//
// It used to be a VIEW under PLAN, and that was wrong in two ways that
// reinforced each other.
//
// It was wrong for the reader: to ask "why is this position so big" you had to
// leave the screen showing the position. By the time FinBoy was open the thing
// you wanted to ask about was gone, and you were retyping from memory the
// number you had been looking at a second earlier.
//
// And it was wrong for FinBoy: a view is handed one section's props, so it knew
// the book, the tape and the series and nothing about the look-through, the
// accounts, the people ledger or the cash categories — everything built since.
// It answered confidently from a partial index, which is the failure this whole
// codebase keeps being rebuilt to avoid.
//
// So: a dock. One button, present on every view, opening a panel over the
// screen you are already on, fed the same whole-tab context regardless of which
// view is behind it. What changed is availability and completeness; nothing
// about the six decisions in FinBoy.jsx changes — a refusal is still an answer,
// citations still travel with the sentence, the cost is still shown before the
// press, and the tape is still never saved.
export default function FinBoyDock({ open, onOpen, onClose, ...props }) {
  // Escape closes it. A panel that covers the screen and can only be dismissed
  // by finding a small × is a panel people stop opening.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) {
    return (
      <button className="fb-launch" onClick={onOpen} title="Ask about your money (Esc to close)">
        <span className="fb-launch-i">◈</span>
        <span className="fb-launch-t">ASK FINBOY</span>
      </button>
    );
  }

  return (
    <div className="fb-dock" role="dialog" aria-label="FinBoy">
      <div className="fb-dock-head">
        <span className="fb-dock-t">◈ FINBOY</span>
        <span className="fb-dock-n">
          reading your whole book, not just this screen
        </span>
        <button className="fb-dock-x" onClick={onClose} title="close (Esc)">×</button>
      </div>
      <div className="fb-dock-body">
        <FinBoy {...props} />
      </div>
    </div>
  );
}
