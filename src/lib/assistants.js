// Which assistant owns which tab.
//
// PLAYER ONE has three assistants and they were never told about each other.
// PLAYER TWO is mounted at the app root (deliberately — an assistant that
// vanishes when you navigate is a widget, not a partner), LEDGER is mounted
// inside Money, and Ally inside Media. Nothing reconciled them, so on those two
// tabs you got two docks stacked on each other, and the one on top was the one
// that answers finance questions with "I don't have access to money".
//
// The DATA boundary was already built and holds: PLAYER TWO reads no financial
// table and its requests are tagged agent:'home'. What was missing is the
// PRESENCE boundary — being absent from a screen someone else owns.
//
// One map, so the answer lives in exactly one place. A tab absent from it
// belongs to PLAYER TWO, which is the right default: a new tab should get the
// system-wide assistant without anyone remembering to add it here.
export const TAB_ASSISTANT = {
  money: 'ledger',    // LedgerDock, mounted in tabs/Money.jsx
  movies: 'ally',     // Ally, mounted in tabs/Movies.jsx — the tab labelled "Media"
};

export const PLAYER_TWO = 'player-two';

export function assistantForTab(tab) {
  // hasOwnProperty, not a bare lookup. `TAB_ASSISTANT['constructor']` walks the
  // prototype chain and returns a function, which is truthy — so a plain
  // `TAB_ASSISTANT[tab] || PLAYER_TWO` hands back Object's constructor for a
  // handful of tab ids and silently hides the dock. No tab is called
  // "constructor" today, and that is exactly the kind of assumption that stops
  // being true without anyone noticing.
  return Object.prototype.hasOwnProperty.call(TAB_ASSISTANT, tab)
    ? TAB_ASSISTANT[tab]
    : PLAYER_TWO;
}

// Note on the Journal: PLAYER TWO's system prompt tells it that the journal is
// off-limits, and that stays true — but that is a privacy rule about what it may
// READ, not an ownership rule about where it may appear. The Journal has no
// assistant of its own, so hiding the dock there would remove help without
// giving any back. Not-allowed-to-read and not-allowed-to-be-here are different
// rules and conflating them is how you end up with neither working.
export function ownsTab(who, tab) {
  return assistantForTab(tab) === who;
}
