import React, { useState, useEffect } from 'react';

// Retro analogue clock — neon arcade face, live ticking hands, 24-hour aware.
export default function RetroClock({ className = '' }) {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const s = t.getSeconds(), m = t.getMinutes(), h = t.getHours();
  const secA = s * 6;
  const minA = m * 6 + s * 0.1;
  const hrA = (h % 12) * 30 + m * 0.5;
  const ticks = Array.from({ length: 12 }, (_, i) => i);
  const dayMode = h >= 6 && h < 18; // light face by day, dark at night

  return (
    <div className={`rclk ${dayMode ? 'day' : 'night'} ${className}`} role="timer" aria-label="current time">
      <svg viewBox="0 0 100 100" className="rclk-face">
        <circle className="rclk-glow" cx="50" cy="50" r="47" />
        <circle className="rclk-rim" cx="50" cy="50" r="46" />
        <circle className="rclk-inner" cx="50" cy="50" r="42" />
        {ticks.map(i => (
          <line key={i} className={`rclk-tick${i % 3 === 0 ? ' major' : ''}`}
            x1="50" y1="9" x2="50" y2={i % 3 === 0 ? 15 : 12.5}
            transform={`rotate(${i * 30} 50 50)`} />
        ))}
        <line className="rclk-hand rclk-hr" x1="50" y1="50" x2="50" y2="31" transform={`rotate(${hrA} 50 50)`} />
        <line className="rclk-hand rclk-min" x1="50" y1="50" x2="50" y2="21" transform={`rotate(${minA} 50 50)`} />
        <line className="rclk-hand rclk-sec" x1="50" y1="55" x2="50" y2="17" transform={`rotate(${secA} 50 50)`} />
        <circle className="rclk-pin" cx="50" cy="50" r="2.6" />
      </svg>
      <span className="rclk-tz">{h >= 12 ? 'PM' : 'AM'} · IST</span>
    </div>
  );
}
