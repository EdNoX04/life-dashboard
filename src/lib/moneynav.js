// The Money tab's navigation, as data rather than markup.
//
// It grew to twenty-four views one button at a time, and by the end they were a
// single flat row that had to wrap onto three lines. Wrapping made every view
// reachable, but it did not make any of them findable: "Levers" sat next to
// "Dividends" for no reason other than the order they were built in, and the
// only way to locate a view was to read all twenty-four labels.
//
// So the strip is two tiers now. The top row picks a section; the row beneath it
// shows only that section's views. The important property is that the section
// row is *derived* from the active view rather than being its own piece of
// state - see sectionOf below. If it were separate state the two could disagree,
// and deep links or a restored view would land you on a view whose section
// header was not lit.
//
// Keeping it here, outside the component, is what lets the tests assert against
// the real list instead of regex-scraping the JSX for setView() calls - which is
// what they used to do, and which quietly stopped being true the moment the
// buttons were generated in a loop.

export const MONEY_SECTIONS = [
  {
    id: 'holdings',
    label: 'MY MONEY',
    color: 'var(--green)',
    hint: 'What you own and what it did',
    views: [
      // Portfolio leads because it is the answer to "what is my money doing",
      // which is why the tab gets opened. The briefing is the second question,
      // not the first: it reads across every other screen, so it makes more
      // sense once you have seen the book it is talking about.
      { id: 'portfolio', label: 'Portfolio' },
      { id: 'brief', label: '◆ Briefing' },
      { id: 'book', label: 'Book' },
      { id: 'accounts', label: 'Accounts' },
      { id: 'india', label: 'India' },
      { id: 'cash', label: 'Cash' },
      { id: 'crypto', label: 'Crypto' },
    ],
  },
  {
    id: 'perf',
    label: 'PERFORMANCE',
    color: 'var(--cyan)',
    hint: 'How it is doing, and how exposed it is',
    views: [
      { id: 'vs', label: 'vs Index' },
      { id: 'risk', label: 'Risk' },
      { id: 'factors', label: 'Factors' },
      { id: 'divers', label: 'Spread' },
      { id: 'xray', label: '◎ X-ray' },
      { id: 'rebal', label: 'Rebalance' },
      { id: 'report', label: 'Report' },
    ],
  },
  {
    id: 'research',
    label: 'RESEARCH',
    color: 'var(--purple)',
    hint: 'Look something up before you buy it',
    views: [
      { id: 'ticker', label: 'Ticker' },
      { id: 'value', label: 'Value' },
      { id: 'intrinsic', label: 'Intrinsic' },
      { id: 'yield', label: 'Yield' },
      { id: 'vlib', label: 'Worth' },
      { id: 'fin', label: 'Financials' },
      { id: 'scanner', label: 'Screens' },
      { id: 'compare', label: 'Compare' },
      { id: 'markets', label: 'Markets' },
    ],
  },
  {
    id: 'income',
    label: 'INCOME',
    color: 'var(--yellow)',
    hint: 'What pays you, and when',
    views: [
      { id: 'divs', label: 'Dividends' },
      { id: 'divhist', label: 'History' },
      { id: 'divgot', label: 'Received' },
      { id: 'divsync', label: 'Data' },
      { id: 'divlists', label: 'Lists' },
      { id: 'calendar', label: 'Calendar' },
      { id: 'earn', label: 'Earnings' },
    ],
  },
  {
    id: 'plan',
    label: 'PLAN',
    color: 'var(--pink)',
    hint: 'Where this is all going',
    views: [
      { id: 'plan', label: 'Plan' },
      { id: 'levers', label: 'Levers' },
      { id: 'nextbuy', label: '✦ Next buy' },
      { id: 'tax', label: 'Tax' },
      { id: 'finboy', label: 'FinBoy' },
    ],
  },
];

/** Every view id, flattened, in strip order. */
export const MONEY_VIEWS = MONEY_SECTIONS.flatMap(s => s.views.map(v => v.id));

/** view id -> section id. Built once; the lookup happens on every render. */
const SECTION_OF = new Map(
  MONEY_SECTIONS.flatMap(s => s.views.map(v => [v.id, s.id])),
);

/**
 * Which section a view belongs to. Falls back to the first section rather than
 * undefined so an unrecognised view - a stale value out of localStorage, say -
 * still renders a lit section rather than a strip with nothing selected.
 */
export function sectionOf(view) {
  return SECTION_OF.get(view) || MONEY_SECTIONS[0].id;
}

/** The section record itself, for the label and colour. Never undefined. */
export function sectionRecord(view) {
  const id = sectionOf(view);
  return MONEY_SECTIONS.find(s => s.id === id) || MONEY_SECTIONS[0];
}
