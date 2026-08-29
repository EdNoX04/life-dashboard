// PLAYER ONE — study guide shell.
//
// One template, three subjects, and it has to survive the major exam too: for
// that paper Neel gets more modules and more material, and the only thing that
// should change is the data file. So everything subject-specific lives in
// data/*.mjs and NOTHING about modules, topics or counts is hard-coded here.
//
// Two deliberate non-features:
//
//   No checkboxes. The previous version had a tick next to every topic, which
//   turned a reference document into a to-do list — you end up managing the
//   list instead of reading it, and an unticked box reads as failure the night
//   before an exam. Progress is not the point; recall is.
//
//   No network. These files are opened offline, on a phone, in a corridor,
//   ten minutes before the paper. Every byte is inline: no CDN, no font
//   fetch, no analytics. If it needs the internet it doesn't work when it
//   matters.

export const CSS = `
:root{
  --bg:#06080f; --bg-2:#0a0e1a; --panel:#0d1220; --panel-2:#111830;
  --ink:#e2e9f4; --ink-2:#97a8c2; --ink-3:#5f6f8c;
  --line:#1c2540; --line-2:#2a3760;
  --cyan:#00e5ff; --green:#31d67a; --pink:#ff3d7f; --yellow:#ffd23f;
  --purple:#9d7bff; --orange:#ff9f45; --red:#ff5c5c;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --body:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif;
  --rd:10px;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--bg);color:var(--ink);
  font-family:var(--body);font-size:16px;line-height:1.65;
  /* The CRT wash. Subtle enough to read 8000 words through — the old version
     ran the scanlines at full strength and became genuinely tiring. */
  background-image:
    radial-gradient(1200px 600px at 70% -10%,rgba(0,229,255,.06),transparent 60%),
    radial-gradient(900px 500px at 10% 110%,rgba(157,123,255,.05),transparent 60%);
  background-attachment:fixed;
}
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;z-index:100;
  background:repeating-linear-gradient(to bottom,rgba(0,0,0,.16) 0 1px,transparent 1px 3px);
  opacity:.5;
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

/* ---------- header ---------- */
.top{
  position:sticky;top:0;z-index:40;background:rgba(6,8,15,.94);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--line);
}
.top-in{max-width:1400px;margin:0 auto;padding:10px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.brand{display:flex;flex-direction:column;gap:1px;min-width:0;margin-right:auto}
.brand b{
  font-family:var(--mono);font-size:13px;letter-spacing:.18em;color:var(--cyan);
  text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52vw;
}
.brand span{font-family:var(--mono);font-size:11px;color:var(--ink-3);letter-spacing:.08em}
.cd{
  font-family:var(--mono);font-size:12px;padding:6px 12px;border-radius:999px;
  border:1px solid var(--line-2);background:var(--panel);white-space:nowrap;
}
.cd b{color:var(--yellow)}
.cd.soon b{color:var(--pink)}
.cd.done b{color:var(--ink-3)}
.search{
  flex:1 1 200px;max-width:340px;min-width:150px;
  background:var(--panel);border:1px solid var(--line-2);border-radius:999px;
  padding:7px 14px;color:var(--ink);font-family:var(--mono);font-size:13px;
}
.search:focus{outline:none;border-color:var(--cyan);box-shadow:0 0 0 3px rgba(0,229,255,.12)}
.search::placeholder{color:var(--ink-3)}
.modes{display:flex;border:1px solid var(--line-2);border-radius:999px;overflow:hidden;background:var(--panel)}
.modes button{
  background:none;border:0;color:var(--ink-3);font-family:var(--mono);font-size:11px;
  letter-spacing:.1em;padding:7px 13px;cursor:pointer;text-transform:uppercase;
}
.modes button[aria-pressed="true"]{background:var(--cyan);color:#04121a;font-weight:700}

/* ---------- layout ---------- */
.wrap{max-width:1400px;margin:0 auto;padding:0 20px;display:grid;grid-template-columns:250px 1fr;gap:36px;align-items:start}
.toc{position:sticky;top:64px;max-height:calc(100vh - 80px);overflow-y:auto;padding:22px 0 40px;font-family:var(--mono);font-size:12px}
.toc::-webkit-scrollbar{width:6px}
.toc::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:3px}
.toc h4{margin:20px 0 7px;font-size:10px;letter-spacing:.18em;color:var(--ink-3);text-transform:uppercase;font-weight:600}
.toc h4:first-child{margin-top:0}
.toc a{
  display:block;padding:5px 10px;color:var(--ink-2);text-decoration:none;
  border-left:2px solid transparent;border-radius:0 5px 5px 0;line-height:1.4;
}
.toc a:hover{color:var(--ink);background:var(--panel)}
.toc a.on{color:var(--cyan);border-left-color:var(--cyan);background:var(--panel)}
main{padding:26px 0 100px;min-width:0}

/* ---------- section + card ---------- */
.mod{
  font-family:var(--mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;
  color:var(--purple);margin:44px 0 4px;padding-top:14px;border-top:1px solid var(--line);
}
.mod:first-child{margin-top:0;border-top:0;padding-top:0}
h2{font-size:26px;line-height:1.25;margin:6px 0 22px;letter-spacing:-.01em;scroll-margin-top:74px}
.card{
  background:var(--panel);border:1px solid var(--line);border-radius:var(--rd);
  padding:22px 24px;margin:0 0 20px;scroll-margin-top:74px;
}
.card>h3{
  margin:0 0 14px;font-size:19px;letter-spacing:-.01em;display:flex;
  gap:10px;align-items:baseline;flex-wrap:wrap;
}
.card>h3 .n{font-family:var(--mono);font-size:12px;color:var(--cyan);flex:none}
.card p{margin:0 0 12px}
.card p:last-child,.card ul:last-child,.card table:last-child{margin-bottom:0}
.card ul,.card ol{margin:0 0 12px;padding-left:20px}
.card li{margin:0 0 5px}
.card li::marker{color:var(--ink-3)}
b,strong{color:#fff;font-weight:650}
code{
  font-family:var(--mono);font-size:.87em;background:var(--panel-2);
  padding:1px 5px;border-radius:4px;color:var(--cyan);
}
a{color:var(--cyan)}

/* ---------- tags ---------- */
.tag{
  font-family:var(--mono);font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;
  padding:3px 8px;border-radius:999px;border:1px solid;flex:none;position:relative;top:-1px;
}
.t-hi{color:var(--yellow);border-color:rgba(255,210,63,.4);background:rgba(255,210,63,.08)}
.t-add{color:var(--orange);border-color:rgba(255,159,69,.4);background:rgba(255,159,69,.08)}
.t-past{color:var(--pink);border-color:rgba(255,61,127,.4);background:rgba(255,61,127,.08)}

/* ---------- the four callouts ---------- */
.def,.edge,.trap,.ask{
  border-radius:8px;padding:13px 16px;margin:0 0 14px;border-left:3px solid;
  background:var(--panel-2);
}
.def{border-color:var(--cyan)}
.edge{border-color:var(--yellow)}
.trap{border-color:var(--red)}
.ask{border-color:var(--pink)}
.def>b:first-child,.edge>b:first-child,.trap>b:first-child,.ask>b:first-child{
  display:block;font-family:var(--mono);font-size:10px;letter-spacing:.16em;
  text-transform:uppercase;margin-bottom:6px;font-weight:600;
}
.def>b:first-child{color:var(--cyan)}
.edge>b:first-child{color:var(--yellow)}
.trap>b:first-child{color:var(--red)}
.ask>b:first-child{color:var(--pink)}
.def{font-size:16.5px}
.ask ol,.ask ul{margin-bottom:0}

/* ---------- tables ---------- */
.tw{overflow-x:auto;margin:0 0 14px;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:14px;min-width:460px}
th,td{padding:9px 13px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{
  background:var(--panel-2);font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink-2);font-weight:600;white-space:nowrap;
}
tr:last-child td{border-bottom:0}
td b{color:var(--cyan);font-weight:600}

/* ---------- code ---------- */
pre{
  background:#05070d;border:1px solid var(--line);border-left:3px solid var(--green);
  border-radius:8px;padding:14px 16px;overflow-x:auto;margin:0 0 14px;
  font-family:var(--mono);font-size:13px;line-height:1.55;color:#c8d6ea;
}
pre code{background:none;padding:0;color:inherit;font-size:inherit}
.cm{color:var(--ink-3)}
.kw{color:var(--pink)}
.st{color:var(--green)}
.fn{color:var(--yellow)}

/* ---------- diagrams ---------- */
figure{margin:0 0 14px;border:1px solid var(--line);border-radius:8px;padding:16px;background:#05070d}
figure svg{display:block;width:100%;height:auto}
figcaption{
  font-family:var(--mono);font-size:11px;color:var(--ink-3);
  margin-top:10px;text-align:center;line-height:1.5;
}
.svg-l{font-family:ui-monospace,monospace;font-size:10px;fill:var(--ink-2)}
.svg-t{font-family:ui-monospace,monospace;font-size:11px;fill:var(--ink);font-weight:600}
.svg-b{fill:#0d1220;stroke:var(--line-2)}

/* ---------- cram mode ---------- */
body[data-mode="cram"] .card > *:not(h3):not(.def):not(.edge):not(.tw):not(.cram){display:none}
body[data-mode="cram"] .card.no-cram{display:none}
.hit{display:none}
body[data-filter="1"] .card{display:none}
body[data-filter="1"] .card.hit{display:block}
body[data-filter="1"] .mod,body[data-filter="1"] h2{display:none}
.empty{display:none;font-family:var(--mono);color:var(--ink-3);padding:40px 0;text-align:center}
body[data-filter="1"] .empty.show{display:block}

/* ---------- misc ---------- */
.lede{color:var(--ink-2);font-size:15px;margin:0 0 22px;max-width:66ch}
.kbd{
  font-family:var(--mono);font-size:11px;border:1px solid var(--line-2);
  border-bottom-width:2px;border-radius:4px;padding:1px 5px;color:var(--ink-2);
}
hr{border:0;border-top:1px solid var(--line);margin:26px 0}

@media (max-width:900px){
  .wrap{grid-template-columns:1fr;gap:0}
  .toc{position:static;max-height:none;padding:16px 0;border-bottom:1px solid var(--line);
       columns:2;column-gap:20px}
  .toc h4{break-after:avoid}
  .toc a{break-inside:avoid}
  .brand b{max-width:100%}
  main{padding-top:18px}
  .card{padding:18px 16px}
  body{font-size:15.5px}
}
@media print{
  body::before,.top,.toc,.modes,.search{display:none!important}
  body{background:#fff;color:#000;font-size:10.5pt}
  .wrap{display:block;max-width:none;padding:0}
  .card{border:1px solid #bbb;background:#fff;break-inside:avoid;page-break-inside:avoid;margin-bottom:10px;padding:10px}
  .def,.edge,.trap,.ask{background:#f4f4f4;border-left:3px solid #666}
  pre,figure{background:#fafafa;border:1px solid #ccc}
  th{background:#eee;color:#000}
  h2{page-break-after:avoid}
  a{color:#000;text-decoration:none}
  .svg-l,.svg-t{fill:#000}
}
`;

export const JS = `
(function(){
  var body=document.body;

  // ---- countdown. The exam datetime is baked in at build time; if the page is
  // opened after the paper it says so rather than counting up into nonsense.
  var el=document.getElementById('cd');
  if(el){
    var when=new Date(el.dataset.when);
    (function tick(){
      var ms=when-new Date();
      if(ms<=0){el.className='cd done';el.innerHTML='paper written \\u2014 <b>good luck</b>';return;}
      var m=Math.floor(ms/60000),h=Math.floor(m/60),d=Math.floor(h/24);
      el.className='cd'+(h<24?' soon':'');
      el.innerHTML=(d>0?d+'d ':'')+(h%24)+'h '+(m%60)+'m <b>to go</b>';
      setTimeout(tick,30000);
    })();
  }

  // ---- scrollspy. IntersectionObserver rather than a scroll handler so a long
  // page does not run layout maths on every frame.
  var links={};
  [].forEach.call(document.querySelectorAll('.toc a'),function(a){
    links[a.getAttribute('href').slice(1)]=a;
  });
  var seen=[];
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){
      var i=seen.indexOf(e.target.id);
      if(e.isIntersecting&&i<0)seen.push(e.target.id);
      if(!e.isIntersecting&&i>=0)seen.splice(i,1);
    });
    var id=seen[0];
    if(!id)return;
    for(var k in links)links[k].classList.toggle('on',k===id);
    var on=links[id];
    if(on&&on.offsetParent&&window.innerWidth>900){
      var t=on.parentNode,r=on.getBoundingClientRect(),b=t.getBoundingClientRect();
      if(r.top<b.top||r.bottom>b.bottom)on.scrollIntoView({block:'nearest'});
    }
  },{rootMargin:'-70px 0px -75% 0px'});
  [].forEach.call(document.querySelectorAll('.card,h2[id]'),function(n){if(n.id)io.observe(n)});

  // ---- search. Plain substring over textContent, cached once. Good enough for
  // a few hundred cards and it works with no network and no library.
  var cards=[].slice.call(document.querySelectorAll('.card'));
  cards.forEach(function(c){c._t=(c.textContent||'').toLowerCase()});
  var box=document.getElementById('q'),empty=document.querySelector('.empty');
  function run(){
    var q=box.value.trim().toLowerCase();
    if(!q){body.dataset.filter='0';empty.classList.remove('show');return;}
    body.dataset.filter='1';
    var n=0;
    cards.forEach(function(c){
      var hit=c._t.indexOf(q)>=0;
      c.classList.toggle('hit',hit);
      if(hit)n++;
    });
    empty.classList.toggle('show',n===0);
    empty.textContent='nothing matches \\u201c'+box.value+'\\u201d';
  }
  if(box)box.addEventListener('input',run);

  // ---- full / cram
  [].forEach.call(document.querySelectorAll('.modes button'),function(b){
    b.addEventListener('click',function(){
      body.dataset.mode=b.dataset.mode;
      [].forEach.call(document.querySelectorAll('.modes button'),function(o){
        o.setAttribute('aria-pressed',String(o===b));
      });
    });
  });

  // ---- keys: / focuses search, Esc clears it
  document.addEventListener('keydown',function(e){
    if(e.key==='/'&&document.activeElement!==box){e.preventDefault();box.focus();box.select();}
    if(e.key==='Escape'&&document.activeElement===box){box.value='';run();box.blur();}
  });
})();
`;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Build one subject page.
 *
 * `sections` is a flat list, each carrying the module it belongs to. Flat
 * rather than nested because the table of contents, the search index and the
 * scrollspy all want a flat list, and nesting it here would mean flattening it
 * again three times below.
 */
export function render(s) {
  const mods = [];
  for (const sec of s.sections) {
    const last = mods[mods.length - 1];
    if (!last || last.name !== sec.module) mods.push({ name: sec.module, secs: [sec] });
    else last.secs.push(sec);
  }

  const toc = mods.map(m => `
      <h4>${esc(m.name)}</h4>
      ${m.secs.map(sec => `<a href="#${sec.id}">${esc(sec.title)}</a>`).join('\n      ')}`).join('\n');

  const main = mods.map(m => `
      <div class="mod">${esc(m.name)}</div>
      ${m.secs.map(sec => `<h2 id="${sec.id}">${esc(sec.title)}</h2>\n${sec.html}`).join('\n')}`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.code)} — ${esc(s.title)}</title>
<meta name="description" content="${esc(s.blurb)}">
<style>${CSS}</style>
</head>
<body data-mode="full" data-filter="0">

<header class="top"><div class="top-in">
  <div class="brand">
    <b>${esc(s.code)} · ${esc(s.title)}</b>
    <span>${esc(s.examLabel)} · minor exam · modules 1–2</span>
  </div>
  <div class="cd" id="cd" data-when="${s.examISO}">&nbsp;</div>
  <input class="search" id="q" type="search" placeholder="/ to search…" aria-label="Search this guide">
  <div class="modes">
    <button data-mode="full" aria-pressed="true">Full</button>
    <button data-mode="cram" aria-pressed="false">Cram</button>
  </div>
</div></header>

<div class="wrap">
  <nav class="toc">${toc}
  </nav>
  <main>
    <p class="lede">${s.lede}</p>
${main}
    <div class="empty"></div>
  </main>
</div>

<script>${JS}</script>
</body>
</html>`;
}
