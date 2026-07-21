import React, { useEffect, useRef, useState } from 'react';

// Barcode scanner. Uses html5-qrcode (loaded from CDN, works on iOS Safari + Android
// + desktop). Always offers manual barcode entry as a fallback if the camera is
// blocked or unavailable. Emits the detected/entered barcode string via onDetect.
const READER_ID = 'po-barcode-reader';

function loadLib() {
  return new Promise((res, rej) => {
    if (window.Html5Qrcode) return res(window.Html5Qrcode);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.onload = () => res(window.Html5Qrcode);
    s.onerror = () => rej(new Error('Could not load the scanner library.'));
    document.head.appendChild(s);
  });
}

export default function BarcodeScanner({ onDetect, onClose }) {
  const [status, setStatus] = useState('starting'); // starting | scanning | error
  const [err, setErr] = useState('');
  const [manual, setManual] = useState('');
  const scannerRef = useRef(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Html5Qrcode = await loadLib();
        if (cancelled) return;
        const scanner = new Html5Qrcode(READER_ID, { verbose: false });
        scannerRef.current = scanner;
        const fmts = window.Html5QrcodeSupportedFormats;
        const config = { fps: 10, qrbox: { width: 260, height: 150 } };
        if (fmts) config.formatsToSupport = [fmts.EAN_13, fmts.EAN_8, fmts.UPC_A, fmts.UPC_E, fmts.CODE_128, fmts.CODE_39, fmts.QR_CODE];
        await scanner.start({ facingMode: 'environment' }, config,
          (text) => { if (!doneRef.current) { doneRef.current = true; stop().then(() => onDetect(text)); } },
          () => {});
        if (!cancelled) setStatus('scanning');
      } catch (e) {
        if (!cancelled) { setStatus('error'); setErr(e.message || 'Camera unavailable — enter the barcode number below.'); }
      }
    })();
    return () => { cancelled = true; stop(); };
    // eslint-disable-next-line
  }, []);

  async function stop() {
    const s = scannerRef.current;
    scannerRef.current = null;
    try { if (s && s.isScanning) { await s.stop(); s.clear(); } } catch {}
  }
  function submitManual() {
    const code = manual.replace(/\D/g, '');
    if (code.length >= 6) { doneRef.current = true; stop().then(() => onDetect(code)); }
  }

  return (
    <div className="modal-overlay" onClick={() => { stop(); onClose(); }}>
      <div className="px scan-modal" onClick={e => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 10 }}>
          <span className="card-title" style={{ margin: 0 }}><span className="sq" style={{ background: 'var(--green)' }} />Scan food barcode</span>
          <button className="btn btn-sm btn-pink" onClick={() => { stop(); onClose(); }}>✕</button>
        </div>
        <div className="scan-view">
          <div id={READER_ID} className="scan-reader" />
          {status !== 'scanning' && (
            <div className="scan-overlay small muted">
              {status === 'starting' ? 'Starting camera…' : (err || 'Camera unavailable.')}
            </div>
          )}
          {status === 'scanning' && <div className="scan-line" />}
        </div>
        <div className="small muted mt">Point the camera at the barcode. Works best on packaged foods.</div>
        <div className="flex mt" style={{ gap: 6 }}>
          <input style={{ flex: 1 }} inputMode="numeric" placeholder="…or type the barcode number" value={manual}
            onChange={e => setManual(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitManual()} />
          <button className="btn btn-green" onClick={submitManual} disabled={manual.replace(/\D/g, '').length < 6}>Look up</button>
        </div>
      </div>
    </div>
  );
}
