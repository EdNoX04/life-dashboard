import React, { useState, useEffect } from 'react';

// Retro LED clock — live, 24-hour, ticking seconds with a blinking colon.
const z = n => String(n).padStart(2, '0');

export default function RetroClock({ className = '' }) {
  const [t, setT] = useState(() => new Date());
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => { setT(new Date()); setOn(o => !o); }, 1000);
    return () => clearInterval(id);
  }, []);

  const colon = <span className={`rclock-colon${on ? '' : ' off'}`}>:</span>;
  return (
    <div className={`rclock ${className}`} role="timer" aria-label="current time">
      <span className="rclock-digits">
        {z(t.getHours())}{colon}{z(t.getMinutes())}{colon}<span className="rclock-sec">{z(t.getSeconds())}</span>
      </span>
      <span className="rclock-tz">IST · 24H</span>
    </div>
  );
}
