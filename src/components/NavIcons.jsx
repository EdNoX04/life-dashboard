import React from 'react';

// Retro line-icon set for the sidebar. Crisp square caps + currentColor so each
// icon glows in its tab colour. No bounding box — just the glyph.
const P = d => <path d={d} />;

const ICONS = {
  hq: <>{P('M2 8 L8 2.5 L14 8')}{P('M4 7 V13.5 H12 V7')}{P('M7 13.5 V10 H9 V13.5')}</>,
  calendar: <>{P('M2.5 3.5 H13.5 V13.5 H2.5 Z')}{P('M2.5 6.5 H13.5')}{P('M5.5 2 V5')}{P('M10.5 2 V5')}<rect x="5" y="9" width="1.6" height="1.6" fill="currentColor" stroke="none" /><rect x="9.4" y="9" width="1.6" height="1.6" fill="currentColor" stroke="none" /></>,
  todos: <>{P('M6 4.5 H14')}{P('M6 8 H14')}{P('M6 11.5 H14')}{P('M2 4 L3 5 L4.5 3')}<rect x="2" y="7.4" width="1.6" height="1.6" fill="currentColor" stroke="none" /><rect x="2" y="10.9" width="1.6" height="1.6" fill="currentColor" stroke="none" /></>,
  habits: P('M8 1.8 L9.7 5.6 L13.8 6 L10.7 8.8 L11.7 12.9 L8 10.7 L4.3 12.9 L5.3 8.8 L2.2 6 L6.3 5.6 Z'),
  goals: <>{P('M8 3 A5 5 0 1 0 8 13 A5 5 0 1 0 8 3')}{P('M8 5.5 A2.5 2.5 0 1 0 8 10.5 A2.5 2.5 0 1 0 8 5.5')}<rect x="7.2" y="7.2" width="1.6" height="1.6" fill="currentColor" stroke="none" /></>,
  college: <>{P('M1.5 6 L8 3 L14.5 6 L8 9 Z')}{P('M4.5 7.3 V10.5 Q8 12.5 11.5 10.5 V7.3')}{P('M14.5 6 V9.5')}</>,
  placement: <>{P('M2.5 5.5 H13.5 V13 H2.5 Z')}{P('M6 5.5 V4 H10 V5.5')}{P('M2.5 9 H13.5')}</>,
  dsa: <>{P('M6 3 Q3.5 3 3.5 5.5 Q3.5 8 1.8 8 Q3.5 8 3.5 10.5 Q3.5 13 6 13')}{P('M10 3 Q12.5 3 12.5 5.5 Q12.5 8 14.2 8 Q12.5 8 12.5 10.5 Q12.5 13 10 13')}</>,
  study: <>{P('M8 4.5 Q5 2.8 2 3.8 V12 Q5 11 8 12.8')}{P('M8 4.5 Q11 2.8 14 3.8 V12 Q11 11 8 12.8')}{P('M8 4.5 V12.8')}</>,
  subjects: <>{P('M3 3.5 H13')}{P('M3 6.5 H13')}{P('M3 9.5 H10')}{P('M3 12.5 H11')}</>,
  notes: <>{P('M3.5 12.5 L3.5 10.5 L10.5 3.5 L12.5 5.5 L5.5 12.5 Z')}{P('M9 5 L11 7')}</>,
  books: <>{P('M3 3 H8 V13 H3 Z')}{P('M8 3.6 L12.8 4.6 L11 13.4 L8 12.8')}{P('M4.5 5.5 H6.5')}</>,
  decision: <>{P('M8 2.5 A5.5 5.5 0 1 0 8 13.5 A5.5 5.5 0 1 0 8 2.5')}{P('M10.5 5.5 L7.2 7.2 L5.5 10.5 L8.8 8.8 Z')}</>,
  money: <><text x="8" y="12.4" textAnchor="middle" fontSize="13" fontFamily="VT323, monospace" fill="currentColor" stroke="none">$</text></>,
  health: <path d="M8 13.2 C3 9.8 2.2 6.5 4.2 4.8 C5.8 3.5 7.4 4.3 8 5.6 C8.6 4.3 10.2 3.5 11.8 4.8 C13.8 6.5 13 9.8 8 13.2 Z" fill="currentColor" stroke="none" />,
  nutrition: <>{P('M8 5 Q4.5 4 3.5 7.5 Q3 11 6 12.8 Q8 13.6 10 12.8 Q13 11 12.5 7.5 Q11.5 4 8 5')}{P('M8 5 Q8.2 3 10 2.2')}</>,
  sleep: <path d="M11.5 9.5 A4.5 4.5 0 1 1 7 3.2 A3.6 3.6 0 0 0 11.5 9.5 Z" fill="currentColor" stroke="none" />,
  journal: <>{P('M3.5 12.5 Q4 9 7 6 L11 2.5 Q13 4.5 11.5 6 L7.5 10 Q5 12 3.5 12.5 Z')}{P('M3.5 12.5 L6 11.5')}</>,
  music: <>{P('M6 12 A2 1.6 0 1 0 8 12 V4 L12.5 2.8 V10')}{P('M10.5 11 A2 1.6 0 1 0 12.5 11')}</>,
  movies: <>{P('M2.5 4 H13.5 V12 H2.5 Z')}{P('M6.5 6 L10 8 L6.5 10 Z')}</>,
  news: <>{P('M2.5 4 H11 V12.5 H2.5 Z')}{P('M11 6 H13.5 V11.5 A1 1 0 0 1 11 11.5')}{P('M4 6.5 H9')}{P('M4 9 H9')}{P('M4 11 H7')}</>,
  builds: <path d="M11.5 3 A2.6 2.6 0 0 0 8.3 6.4 L3.5 11.2 L4.8 12.5 L9.6 7.7 A2.6 2.6 0 0 0 13 4.5 L11 6.5 L9.5 5 Z" />,
  settings: <>{P('M8 5.5 A2.5 2.5 0 1 0 8 10.5 A2.5 2.5 0 1 0 8 5.5')}{P('M8 1.8 V3.5 M8 12.5 V14.2 M2.2 8 H3.9 M12.1 8 H13.8 M3.9 3.9 L5.1 5.1 M10.9 10.9 L12.1 12.1 M12.1 3.9 L10.9 5.1 M5.1 10.9 L3.9 12.1')}</>,
  _default: <>{P('M8 3 A5 5 0 1 0 8 13 A5 5 0 1 0 8 3')}</>,
};

export default function NavIcon({ id, color }) {
  return (
    <svg className="nav-svg" viewBox="0 0 16 16" width="17" height="17"
      fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter"
      style={{ color }} aria-hidden="true">
      {ICONS[id] || ICONS._default}
    </svg>
  );
}
