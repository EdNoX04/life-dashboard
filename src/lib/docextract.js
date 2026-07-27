// Pull plain text out of a syllabus file the user uploads.
//
// Everything runs in the browser — the file never leaves the device, and there's no
// schema change: the extracted text lands in the same `syllabus` column that the
// notes generator already reads.

const SCRIPTS = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
};

const loaded = new Map();
function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res;
    s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}

// Collapse the ragged whitespace PDFs love to emit, but keep paragraph breaks.
function tidy(t) {
  return String(t || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fromPdf(file) {
  await loadScript(SCRIPTS.pdf);
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('PDF reader unavailable');
  lib.GlobalWorkerOptions.workerSrc = SCRIPTS.pdfWorker;
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // group items into lines by their vertical position so lists stay readable
    let lastY = null, line = [], out = [];
    for (const it of content.items) {
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { out.push(line.join(' ')); line = []; }
      line.push(it.str);
      lastY = y;
    }
    if (line.length) out.push(line.join(' '));
    pages.push(out.join('\n'));
  }
  return tidy(pages.join('\n\n'));
}

async function fromDocx(file) {
  await loadScript(SCRIPTS.mammoth);
  if (!window.mammoth) throw new Error('Word reader unavailable');
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await window.mammoth.extractRawText({ arrayBuffer });
  return tidy(value);
}

export const ACCEPT = '.pdf,.docx,.txt,.md,.rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

export async function extractText(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return fromPdf(file);
  if (name.endsWith('.docx')) return fromDocx(file);
  if (name.endsWith('.doc')) throw new Error('Old .doc files aren’t readable here — save it as .docx or PDF and try again.');
  if (/\.(txt|md|csv|rtf)$/.test(name) || (file.type || '').startsWith('text/')) return tidy(await file.text());
  throw new Error('Unsupported file — upload a PDF, .docx, or plain text.');
}
