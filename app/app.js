// SagBook: suspension dial log. Plain JS, no build step.
// tools/update.ps1 rewrites APP_VERSION on every publish.
const APP_VERSION = '2026.10.07-0111';
const PSI_PER_BAR = 14.5038;

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

/* ---------- utilities ---------- */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const trim = (n, dp = 2) => (n == null ? '' : String(+Number(n).toFixed(dp)));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString(undefined, opts)} ${time}`;
}
function fmtDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

let toastTimer;
function toast(msg, action) {
  $toast.innerHTML = esc(msg) + (action ? ` <a href="${action.href}">${esc(action.label)}</a>` : '');
  $toast.classList.toggle('has-action', !!action);
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), action ? 4000 : 2400);
}
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

/* ---------- dial types ---------- */

const TYPES = {
  clicks: { label: 'Clicks', unit: 'clicks', step: 1, min: 0, max: 16 },
  turns: { label: 'Turns', unit: 'turns', step: 0.25, min: 0, max: 4 },
  psi: { label: 'Pressure', unit: 'psi', step: 1, min: 0, max: 600 },
  bar: { label: 'Pressure', unit: 'bar', step: 0.1, min: 0, max: 40 },
  spacers: { label: 'Spacers', unit: 'spacers', step: 1, min: 0, max: 6 },
  custom: { label: 'Other', unit: '', step: 1, min: 0, max: 100 },
};
const TYPE_TABS = [['clicks', 'Clicks'], ['turns', 'Turns'], ['pressure', 'Pressure'], ['spacers', 'Spacers'], ['custom', 'Other']];
const PRESETS = [
  ['Rebound', 'clicks'], ['LSC', 'clicks'], ['HSC', 'clicks'], ['LSR', 'clicks'], ['HSR', 'clicks'],
  ['Air pressure', 'psi'], ['Volume spacers', 'spacers'], ['Preload', 'turns'],
  ['Sag', 'custom', { unit: '%', min: 0, max: 50, value: 25 }],
];
const TAGS = ['Dialled', 'Too harsh', 'Too soft', 'Bottoming out', 'Packing down', 'Kicking back', 'Wallowy', 'Lacks grip'];

// Damping adjusters get changed trailside, so they start on the Trailside page;
// pressure, spacers, preload and sag start on the Workshop page.
const defaultMain = (d) => d.type === 'clicks' || /reb|comp|lsc|hsc|lsr|hsr|lock|climb|threshold/i.test(d.name);

function newDial(name, type, o = {}) {
  const t = TYPES[type];
  return withMain({
    id: uid(), name, type,
    unit: o.unit ?? '',
    min: o.min ?? t.min, max: o.max ?? t.max, step: o.step ?? t.step,
    value: o.value ?? o.min ?? t.min,
    reverse: false,
    control: defaultControl(type),
  });
}
function withMain(d) { d.main = defaultMain(d); return d; }
const unitOf = (d) => (d.type === 'custom' ? d.unit || '' : TYPES[d.type].unit);
const typeTab = (d) => (d.type === 'psi' || d.type === 'bar' ? 'pressure' : d.type);
// Spacers and pressure feel more natural pushed up or down than turned.
const defaultControl = (type) => (type === 'spacers' || type === 'psi' || type === 'bar' ? 'slider' : 'dial');
const isSlider = (d) => d.control === 'slider';
const stepTotal = (d) => Math.max(1, Math.round((d.max - d.min) / d.step));
const sliderPct = (d, v) => (clamp(v, d.min, d.max) - d.min) / ((d.max - d.min) || 1);

// Turns read best as fractions: 1¼, 2⅜ …
const FRAC = { 0.25: '¼', 0.5: '½', 0.75: '¾', 0.125: '⅛', 0.375: '⅜', 0.625: '⅝', 0.875: '⅞' };
function fmt(d, v) {
  if (v == null) return '–';
  if (d.type === 'turns') {
    const w = Math.floor(v + 1e-9);
    const f = +(v - w).toFixed(4);
    if (!f) return String(w);
    if (FRAC[f]) return `${w || ''}${FRAC[f]}`;
    return trim(v, 3);
  }
  return trim(v, 2);
}
const fmtChange = (d, v) => (d ? fmt(d, v) : trim(v));

// How a dial maps onto rotation. Short ranges sit on one ring of ticks, one
// tick per step, so the knob's notch points at the current click. Long ranges
// (turns, pressure) spin freely: one revolution per turn, or 30 steps per rev.
function geom(d) {
  const steps = Math.max(1, Math.round((d.max - d.min) / d.step));
  if (d.type === 'turns') return { ring: false, steps, deg: 360 * d.step, marks: clamp(Math.round(1 / d.step), 4, 16) };
  if (steps <= 33) return { ring: true, steps, deg: Math.min(40, 330 / steps) };
  return { ring: false, steps, deg: 12, marks: 12 };
}
const dirOf = (d) => (d.reverse ? -1 : 1);
const angleFor = (d, v) => ((v - d.min) / d.step) * geom(d).deg * dirOf(d);
const stepIndex = (d, v) => Math.round((v - d.min) / d.step);

// Compression and rebound knobs look different, like on the real thing.
const knobStyle = (d) => ({ red: 'k-reb', blue: 'k-comp', gold: 'k-pre' }[dialColor(d)] || 'k-reb');

function dialColor(d) {
  const n = d.name.toLowerCase();
  if (/reb|lsr|hsr/.test(n)) return 'red';
  if (/comp|lsc|hsc|climb|lock|threshold|pedal/.test(n)) return 'blue';
  if (/pre ?load|spring|coil/.test(n)) return 'gold';
  if (d.type === 'psi' || d.type === 'bar') return 'steel';
  return 'orange';
}

/* ---------- storage (IndexedDB, mirrored to localStorage) ---------- */

const DB_NAME = 'sagbook', STORE = 'kv', KEY = 'state', LS_KEY = 'sagbook-state';
let dbPromise;
function db() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

function defaultState() {
  return {
    schema: 2,
    settings: { theme: 'auto', lastPage: null, lastBackup: null, selected: {}, section: {} },
    components: [],
    entries: [],
    pending: {},
  };
}

// Version 1 stored bikes with a fork/shock each; turn those into profiles.
function convertV1(old) {
  const s = defaultState();
  s.settings.theme = old.settings?.theme || 'auto';
  s.settings.lastBackup = old.settings?.lastBackup || null;
  const bar = old.settings?.pressureUnit === 'bar';
  for (const bike of old.bikes || []) {
    const bikeEntries = (old.entries || []).filter((e) => e.bikeId === bike.id).sort((a, b) => a.ts - b.ts);
    for (const part of ['fork', 'shock']) {
      const c = bike[part];
      if (!c) continue;
      const map = [];
      if (c.spring === 'coil') map.push([newDial('Spring rate', 'custom', { unit: 'lb', step: 25, min: 200, max: 800, value: 400 }), (su) => su.springRate]);
      else map.push([newDial('Air pressure', bar ? 'bar' : 'psi', { min: 0 }), (su) => (su.pressure == null ? null : bar ? +(su.pressure / PSI_PER_BAR).toFixed(1) : su.pressure)]);
      if (c.spring !== 'coil' && c.tokens) map.push([newDial('Volume spacers', 'spacers'), (su) => su.tokens]);
      for (const a of c.adjusters || []) map.push([newDial(a.label, 'clicks', { max: a.max ?? 16 }), (su) => su.adj?.[a.id]]);
      const comp = { id: uid(), name: c.name || (part === 'fork' ? 'Fork' : 'Shock'), kind: part, bike: bike.name || '', dials: map.map((m) => m[0]) };
      let prev = null;
      for (const e of bikeEntries) {
        if (!e[part]) continue;
        const snap = { ...prev };
        map.forEach(([d, get]) => { const v = get(e[part]); if (v != null) snap[d.id] = v; });
        const changes = prev ? comp.dials.filter((d) => snap[d.id] !== prev[d.id])
          .map((d) => ({ dialId: d.id, name: d.name, unit: unitOf(d), from: prev[d.id] ?? null, to: snap[d.id] ?? null })) : [];
        s.entries.push({ id: uid(), componentId: comp.id, ts: e.ts, start: !prev, changes, snapshot: snap, tags: [], note: [e.location, e.notes].filter(Boolean).join(' — ') });
        prev = snap;
      }
      for (const d of comp.dials) {
        if (prev?.[d.id] != null) d.value = prev[d.id];
        d.max = Math.max(d.max, d.value);
      }
      s.components.push(comp);
    }
  }
  return s;
}

function migrate(s) {
  if (!s.schema || s.schema < 2) s = convertV1(s);
  const d = defaultState();
  s.settings = { ...d.settings, ...s.settings };
  s.settings.selected ||= {};
  s.settings.section ||= {};
  delete s.settings.moreOpen;
  s.components ||= [];
  s.entries ||= [];
  s.pending ||= {};
  for (const c of s.components) {
    for (const dial of c.dials) {
      dial.reverse ??= false;
      dial.control ??= defaultControl(dial.type);
      if (dial.main === undefined) {
        // Dials from before the main/more split: place them, and lift the old 300 psi cap.
        withMain(dial);
        if (dial.type === 'psi' && dial.max === 300) dial.max = 600;
        if (dial.type === 'bar' && dial.max === 20) dial.max = 40;
      }
    }
  }
  for (const e of s.entries) e.tags ||= [];
  return s;
}

let state;
async function load() {
  let s = null;
  try { s = await idb('readonly', (st) => st.get(KEY)); } catch { /* fall back below */ }
  if (!s) { try { s = JSON.parse(localStorage.getItem(LS_KEY)); } catch { /* none */ } }
  state = migrate(s || defaultState());
}
let saveTimer;
async function save() {
  clearTimeout(saveTimer);
  const json = JSON.stringify(state);
  try { localStorage.setItem(LS_KEY, json); } catch { /* quota; IndexedDB is primary */ }
  try { await idb('readwrite', (st) => st.put(JSON.parse(json), KEY)); }
  catch (e) { toast('Save failed: ' + e.message); }
}
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); };

/* ---------- domain ---------- */

const compById = (id) => state.components.find((c) => c.id === id);
const entryById = (id) => state.entries.find((e) => e.id === id);
const entriesFor = (cid) => state.entries.filter((e) => e.componentId === cid).sort((a, b) => b.ts - a.ts);
const current = (comp, d) => state.pending[comp.id]?.[d.id] ?? d.value;
const pendingDials = (comp) => comp.dials.filter((d) => current(comp, d) !== d.value);
const KINDS = [['fork', 'Fork'], ['shock', 'Shock'], ['other', 'Other']];
const kindLabel = (k) => KINDS.find(([v]) => v === k)?.[1] || 'Other';
const SECTIONS = [
  ['main', 'Trailside', 'Quick changes on the trail'],
  ['more', 'Workshop', 'Pressure, spacers and slower jobs'],
];
const dialsIn = (comp, sec) => comp.dials.filter((d) => (sec === 'main') === !!d.main);
function activeSection(comp) {
  const want = state.settings.section[comp.id] || 'main';
  if (dialsIn(comp, want).length) return want;
  return want === 'main' ? 'more' : 'main';
}
function selectedDial(comp) {
  const sec = activeSection(comp);
  const list = dialsIn(comp, sec);
  return list.find((d) => d.id === state.settings.selected[`${comp.id}:${sec}`]) || list[0];
}

function setPending(comp, d, v) {
  const p = (state.pending[comp.id] ||= {});
  if (v === d.value) delete p[d.id]; else p[d.id] = v;
  if (!Object.keys(p).length) delete state.pending[comp.id];
}

/* ---------- icons ---------- */

const svg = (d, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1z"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  sliders: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  chevron: svg('<path d="M9 18l6-6-6-6"/>'),
  up: svg('<path d="M18 15l-6-6-6 6"/>', 20),
  down: svg('<path d="M6 9l6 6 6-6"/>', 20),
  undo: svg('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>', 18),
  cw: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 16),
  ccw: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', 16),
  x: svg('<path d="M18 6L6 18M6 6l12 12"/>', 20),
};

const header = (title, left = '', right = '<span class="icon-btn"></span>') =>
  `<header class="top">${left || '<span class="icon-btn"></span>'}<h1>${title}</h1>${right}</header>`;
const backBtn = (href = '#/') => `<a class="icon-btn" href="${href}" aria-label="Back">${ICON.back}</a>`;
const seg = (action, key, value, options, extra = '') => `<div class="seg">${options.map(([v, label]) =>
  `<button type="button" class="${String(v) === String(value) ? 'on' : ''}" data-action="${action}" data-key="${key}" data-value="${v}" ${extra}>${label}</button>`).join('')}</div>`;

/* ---------- install ---------- */

let installPrompt = null;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// Explains how to install from whichever browser the page was opened in.
function installSteps() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/i.test(ua)) return 'In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>.';
  if (/; wv\)|FBAN|FBAV|Instagram|GSA\//i.test(ua)) {
    return 'This page is open inside another app, which can\'t install apps. Tap <b>⋮</b> → <b>Open in Chrome</b>, then come back here.';
  }
  if (/SamsungBrowser/i.test(ua)) {
    return 'Open this page in <b>Chrome</b> instead of Samsung Internet. Chrome installs SagBook as a proper app, which quick launch needs.';
  }
  if (/Android/i.test(ua)) return 'Tap <b>⋮</b> (top right of Chrome) → <b>Add to Home screen</b> → <b>Install</b>.';
  return 'Click the <b>install icon</b> at the right end of the address bar in Chrome or Edge.';
}

function installCard() {
  if (isInstalled()) return '';
  return `<section class="card install">
    <div class="install-head"><img src="icons/icon-192.png" alt="" width="44" height="44">
      <div><h3>Install SagBook</h3><p class="muted">Home-screen icon, opens instantly, works offline.</p></div>
    </div>
    ${installPrompt
      ? '<button type="button" class="btn primary block" data-action="install">Install app</button>'
      : `<p class="steps">${installSteps()}</p>`}
  </section>`;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (state && !location.hash.startsWith('#/component') && !drag) rerenderKeepScroll();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('SagBook installed — open it from your home screen');
});

/* ---------- view: main (swipeable pages) ---------- */

function viewMain() {
  if (!state.components.length) {
    return `${header('SagBook', '', `<a class="icon-btn" href="#/settings" aria-label="Settings">${ICON.gear}</a>`)}
    ${installCard()}
    <main class="empty">
      <div class="empty-dial" aria-hidden="true"><div class="knob c-red"><span class="notch"></span></div></div>
      <h2>Add your suspension</h2>
      <div class="empty-actions">
        <a class="btn primary big" href="#/component/new?kind=fork">Fork</a>
        <a class="btn big" href="#/component/new?kind=shock">Shock</a>
      </div>
    </main>`;
  }
  const cur = state.components[pageIndex()];
  return `<header class="main-top">
    <nav class="tabs" id="tabs">${state.components.map((c, i) =>
      `<button type="button" class="tab" data-action="goto-page" data-index="${i}">${esc(c.name)}${pendingDials(c).length ? '<i class="dot"></i>' : ''}</button>`).join('')}</nav>
    <a class="icon-btn" id="hist-link" href="#/history/${cur.id}" aria-label="History">${ICON.clock}</a>
    <a class="icon-btn" href="#/settings" aria-label="Settings">${ICON.gear}</a>
  </header>
  <div class="pager" id="pager">${state.components.map(pageHtml).join('')}</div>`;
}

function pageHtml(comp) {
  const sel = selectedDial(comp);
  if (!sel) {
    return `<section class="page" data-comp="${comp.id}">
      <div class="no-dials"><a class="btn primary" href="#/component/${comp.id}">Add dials</a></div>
    </section>`;
  }
  const list = dialsIn(comp, activeSection(comp));
  return `<section class="page" data-comp="${comp.id}">
    ${sectionTabs(comp)}
    ${heroHtml(comp, sel)}
    ${list.length > 1 ? `<div class="tiles">${list.map((d) => tileHtml(comp, d, d === sel)).join('')}</div>` : ''}
    ${saveBar(comp)}
  </section>`;
}

function sectionTabs(comp) {
  const active = activeSection(comp);
  const avail = SECTIONS.filter(([sec]) => dialsIn(comp, sec).length);
  if (avail.length < 2) return '';
  return `<div class="sections">${avail.map(([sec, label]) => {
    const changed = dialsIn(comp, sec).some((d) => current(comp, d) !== d.value);
    return `<button type="button" class="${sec === active ? 'on' : ''}" data-action="section" data-sec-btn="${comp.id}|${sec}">${label}${changed ? '<i class="dot"></i>' : ''}</button>`;
  }).join('')}</div>`;
}

/* ----- the big dial ----- */

function ticksSvg(d, v) {
  const g = geom(d), dir = dirOf(d);
  const line = (deg, r1, r2, cls, attrs = '') => {
    const a = (deg - 90) * Math.PI / 180;
    const x = (r) => (100 + r * Math.cos(a)).toFixed(2);
    const y = (r) => (100 + r * Math.sin(a)).toFixed(2);
    return `<line x1="${x(r1)}" y1="${y(r1)}" x2="${x(r2)}" y2="${y(r2)}" class="${cls}" ${attrs}/>`;
  };
  let out = '';
  if (g.ring) {
    const idx = stepIndex(d, v);
    for (let i = 0; i <= g.steps; i++) {
      const major = i === 0 || i === g.steps || i % 5 === 0;
      out += line(i * g.deg * dir, major ? 82 : 87, 96, `tk${major ? ' mj' : ''}${i <= idx ? ' on' : ''}`, `data-i="${i}"`);
    }
  } else {
    for (let i = 0; i < g.marks; i++) out += line((360 / g.marks) * i, i === 0 ? 82 : 88, 96, `tk${i === 0 ? ' mj on' : ''}`);
  }
  return `<svg class="ticks" viewBox="0 0 200 200" aria-hidden="true">${out}</svg>`;
}

// "6 /16", "1½ /4 turns", "72 psi"
function readoutHtml(d, v) {
  if (d.type === 'clicks' || d.type === 'spacers') return `<b>${fmt(d, v)}</b><span>/${fmt(d, d.max)}</span>`;
  if (d.type === 'turns') return `<b>${fmt(d, v)}</b><span>/${fmt(d, d.max)} turns</span>`;
  return `<b>${fmt(d, v)}</b><span>${esc(unitOf(d))}</span>`;
}

// What turning a dial up or down does to the ride. Counting starts fully
// open, so a higher number always means more damping.
function effectOf(d) {
  const n = (d?.name || '').toLowerCase();
  if (/reb|lsr|hsr/.test(n)) return { up: 'slower', down: 'faster' };
  if (/comp|lsc|hsc|climb|lock|threshold|pedal/.test(n)) return { up: 'firmer', down: 'softer' };
  if (d?.type === 'psi' || d?.type === 'bar') return { up: 'firmer', down: 'softer' };
  if (d?.type === 'spacers') return { up: 'progressive', down: 'linear' };
  return { up: 'more', down: 'less' };
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// "+2 slower", "−¼ less"
function effectText(d, from, to) {
  if (from == null || to == null || from === to) return '';
  const fx = effectOf(d);
  const diff = to - from;
  const amount = d?.type ? fmt(d, Math.abs(diff)) : trim(Math.abs(diff));
  return `${diff > 0 ? '+' : '−'}${amount} ${diff > 0 ? fx.up : fx.down}`;
}

function deltaHtml(d, v) {
  if (v === d.value) return '';
  return `<span>${esc(effectText(d, d.value, v))}</span><button type="button" class="reset" data-action="reset-dial" aria-label="Reset ${esc(d.name)}">${ICON.undo}</button>`;
}

// The buttons under the knob say what each direction does and nudge one step.
function dirRow(d) {
  const fx = effectOf(d);
  if (isSlider(d)) {
    return `<div class="dir-row">
    <button type="button" class="dir" data-action="nudge" data-dir="-1">${ICON.down}<span>${esc(cap(fx.down))}</span></button>
    <button type="button" class="dir" data-action="nudge" data-dir="1"><span>${esc(cap(fx.up))}</span>${ICON.up}</button>
  </div>`;
  }
  const less = { dir: -1, label: cap(fx.down) }, more = { dir: 1, label: cap(fx.up) };
  const [ccw, cw] = d.reverse ? [more, less] : [less, more];
  return `<div class="dir-row">
    <button type="button" class="dir" data-action="nudge" data-dir="${ccw.dir}">${ICON.ccw}<span>${esc(ccw.label)}</span></button>
    <button type="button" class="dir" data-action="nudge" data-dir="${cw.dir}"><span>${esc(cw.label)}</span>${ICON.cw}</button>
  </div>`;
}

function heroHtml(comp, d) {
  const v = current(comp, d);
  return `<div class="hero ${v !== d.value ? 'changed' : ''}" data-hero="${comp.id}|${d.id}">
    <div class="readout">
      <span class="hero-name">${esc(d.name)}</span>
      <button type="button" class="value" data-action="type-value" aria-label="Type a value for ${esc(d.name)}">${readoutHtml(d, v)}</button>
      <div class="delta">${deltaHtml(d, v)}</div>
    </div>
    <div class="dial-slot">${isSlider(d) ? sliderHtml(d, v) : dialHtml(d, v)}</div>
    ${dirRow(d)}
  </div>`;
}

function dialHtml(d, v) {
  return `<div class="dial-big" role="slider" tabindex="0" aria-label="${esc(d.name)}" aria-valuemin="${d.min}" aria-valuemax="${d.max}" aria-valuenow="${v}">
    ${ticksSvg(d, v)}
    <div class="knob-wrap"><div class="knob ${knobStyle(d)} c-${dialColor(d)}" style="--rot:${angleFor(d, v).toFixed(2)}deg"><span class="notch"></span></div></div>
  </div>`;
}

const WAVE = 'M0 10 Q50 0 100 10 T200 10 T300 10 T400 10 V20 H0 Z';
const BUBBLES = [[18, 0, 7, 3.4], [38, 1.2, 5, 2.8], [55, 0.5, 9, 3.8], [70, 2, 6, 3], [82, 0.9, 4, 2.6], [28, 2.6, 6, 3.2], [62, 1.7, 5, 2.9]];

// Sliders: spacers stack up inside an air can; pressure fills a tank.
function sliderHtml(d, v) {
  const aria = `role="slider" tabindex="0" aria-orientation="vertical" aria-label="${esc(d.name)}" aria-valuemin="${d.min}" aria-valuemax="${d.max}" aria-valuenow="${v}"`;
  if (d.type === 'spacers') {
    const on = stepIndex(d, v);
    return `<div class="slider-ctl stack c-${dialColor(d)}" ${aria} style="--n:${stepTotal(d)}">
      <div class="can">
        <div class="can-cap"></div>
        <div class="tokens">${Array.from({ length: stepTotal(d) }, (_, i) => `<i class="token ${i < on ? 'on' : ''}"></i>`).join('')}</div>
        <div class="air"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      </div>
    </div>`;
  }
  return `<div class="slider-ctl tank" ${aria} style="--pct:${sliderPct(d, v).toFixed(3)}">
    <div class="tank-body">
      <div class="fill">
        <svg class="wave back" viewBox="0 0 400 20" preserveAspectRatio="none" aria-hidden="true"><path d="${WAVE}"/></svg>
        <svg class="wave" viewBox="0 0 400 20" preserveAspectRatio="none" aria-hidden="true"><path d="${WAVE}"/></svg>
        <div class="bubbles">${BUBBLES.map(([x, delay, size, t]) => `<span style="--x:${x}%;--d:${delay}s;--s:${size}px;--t:${t}s"></span>`).join('')}</div>
      </div>
      <div class="gauge-lines"></div>
      <div class="gloss"></div>
    </div>
  </div>`;
}

function tileHtml(comp, d, selected) {
  const v = current(comp, d);
  return `<button type="button" class="tile ${selected ? 'sel' : ''} ${v !== d.value ? 'changed' : ''}" data-action="select-dial" data-tile="${comp.id}|${d.id}">
    <span class="t-name"><i class="sw c-${dialColor(d)}"></i>${esc(d.name)}</span><b>${fmt(d, v)}</b>
  </button>`;
}

function saveBar(comp) {
  const n = pendingDials(comp).length;
  return `<div class="savebar ${n ? 'show' : ''}" data-savebar="${comp.id}">
    <button type="button" class="btn" data-action="undo" data-id="${comp.id}" aria-label="Undo all changes">${ICON.undo}</button>
    <button type="button" class="btn primary" data-action="save-now" data-id="${comp.id}">Save ${plural(n, 'change')}</button>
  </div>`;
}

// Live updates while spinning: touch only what changed so the drag survives.
function refreshDial(comp, d, residual = 0) {
  const v = current(comp, d);
  const hero = $app.querySelector(`[data-hero="${comp.id}|${d.id}"]`);
  if (hero) {
    hero.classList.toggle('changed', v !== d.value);
    hero.querySelector('.value').innerHTML = readoutHtml(d, v);
    hero.querySelector('.delta').innerHTML = deltaHtml(d, v);
    const idx = stepIndex(d, v);
    const ctl = hero.querySelector('.slider-ctl, .dial-big');
    ctl.setAttribute('aria-valuenow', v);
    if (isSlider(d)) {
      ctl.style.setProperty('--pct', sliderPct(d, v).toFixed(3));
      ctl.querySelectorAll('.token').forEach((t, i) => t.classList.toggle('on', i < idx));
    } else {
      hero.querySelector('.knob').style.setProperty('--rot', `${(angleFor(d, v) + residual).toFixed(2)}deg`);
      hero.querySelectorAll('.tk[data-i]').forEach((t) => t.classList.toggle('on', +t.dataset.i <= idx));
    }
  }
  const tile = $app.querySelector(`[data-tile="${comp.id}|${d.id}"]`);
  if (tile) {
    tile.classList.toggle('changed', v !== d.value);
    tile.querySelector('b').textContent = fmt(d, v);
  }
  refreshSaveBar(comp);
}

function refreshSaveBar(comp) {
  const n = pendingDials(comp).length;
  const bar = $app.querySelector(`[data-savebar="${comp.id}"]`);
  if (bar) {
    bar.classList.toggle('show', n > 0);
    bar.querySelector('.primary').textContent = `Save ${plural(n, 'change')}`;
  }
  for (const [sec] of SECTIONS) {
    const btn = $app.querySelector(`[data-sec-btn="${comp.id}|${sec}"]`);
    if (!btn) continue;
    const changed = dialsIn(comp, sec).some((d) => current(comp, d) !== d.value);
    const dot = btn.querySelector('.dot');
    if (changed && !dot) btn.insertAdjacentHTML('beforeend', '<i class="dot"></i>');
    if (!changed && dot) dot.remove();
  }
  const tab = $app.querySelectorAll('.tab')[state.components.indexOf(comp)];
  if (tab) {
    const dot = tab.querySelector('.dot');
    if (n && !dot) tab.insertAdjacentHTML('beforeend', '<i class="dot"></i>');
    if (!n && dot) dot.remove();
  }
}

// Size each knob to the space left on screen, so nothing ever scrolls.
const slotObserver = new ResizeObserver((entries) => {
  for (const { target } of entries) {
    const size = Math.max(110, Math.min(target.clientWidth, target.clientHeight, 340) - 6);
    target.firstElementChild?.style.setProperty('--size', `${size}px`);
  }
});
function fitDials() {
  slotObserver.disconnect();
  $app.querySelectorAll('.dial-slot').forEach((s) => slotObserver.observe(s));
}

function stepDial(comp, d, dir) {
  const v = current(comp, d);
  const nv = +clamp(v + dir * d.step, d.min, d.max).toFixed(4);
  if (nv === v) return false;
  setPending(comp, d, nv);
  buzz(nv === d.min || nv === d.max ? 18 : 7);
  saveSoon();
  return true;
}

function heroTarget(el) {
  const [cid, did] = el.closest('[data-hero]').dataset.hero.split('|');
  const comp = compById(cid);
  return [comp, comp.dials.find((x) => x.id === did)];
}

/* ----- spinning ----- */

let drag = null;
const angleAt = (e) => Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) * 180 / Math.PI;

document.addEventListener('pointerdown', (e) => {
  const lin = e.target.closest('.slider-ctl');
  if (lin) {
    const [comp, d] = heroTarget(lin);
    const h = lin.getBoundingClientRect().height;
    // Spacers click in one at a time; pressure moves a step every few pixels.
    const per = d.type === 'spacers' ? clamp((h * 0.8) / stepTotal(d), 22, 70) : clamp(h / stepTotal(d), 3, 40);
    drag = { linear: true, comp, d, lastY: e.clientY, acc: 0, per, id: e.pointerId, dial: lin, limitHit: false };
    try { lin.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    lin.classList.add('dragging');
    e.preventDefault();
    return;
  }
  const dial = e.target.closest('.dial-big');
  if (!dial) return;
  const [comp, d] = heroTarget(dial);
  const r = dial.getBoundingClientRect();
  drag = { comp, d, cx: r.left + r.width / 2, cy: r.top + r.height / 2, acc: 0, id: e.pointerId, dial, limitHit: false };
  drag.last = angleAt(e);
  try { dial.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  dial.classList.add('dragging');
  e.preventDefault();
});

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.linear) {
    const { comp, d } = drag;
    drag.acc += drag.lastY - e.clientY; // up = more
    drag.lastY = e.clientY;
    while (Math.abs(drag.acc) >= drag.per) {
      const dir = Math.sign(drag.acc);
      if (!stepDial(comp, d, dir)) {
        if (!drag.limitHit) { buzz(40); drag.limitHit = true; }
        drag.acc = 0;
        break;
      }
      drag.limitHit = false;
      drag.acc -= dir * drag.per;
    }
    refreshDial(comp, d);
    return;
  }
  if (Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 14) return; // too near the centre to read an angle
  const a = angleAt(e);
  let delta = a - drag.last;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  drag.last = a;
  const { comp, d } = drag;
  const deg = geom(d).deg;
  drag.acc += delta * dirOf(d);
  // Click over to the next detent half-way between them, like a real adjuster.
  while (Math.abs(drag.acc) > deg / 2) {
    const dir = Math.sign(drag.acc);
    if (!stepDial(comp, d, dir)) {
      if (!drag.limitHit) { buzz(40); drag.limitHit = true; }
      drag.acc = dir * Math.min(Math.abs(drag.acc), deg * 0.35); // resist past the end stop
      break;
    }
    drag.limitHit = false;
    drag.acc -= dir * deg;
  }
  refreshDial(comp, d, drag.acc * dirOf(d));
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { comp, d, dial } = drag;
  dial.classList.remove('dragging');
  drag = null;
  refreshDial(comp, d, 0); // settle into the detent
  save();
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSheet(); return; }
  const dial = e.target.closest?.('.dial-big, .slider-ctl');
  if (!dial) return;
  const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
  if (!dir) return;
  const [comp, d] = heroTarget(dial);
  if (stepDial(comp, d, dir)) refreshDial(comp, d);
  e.preventDefault();
});

/* ---------- pager ---------- */

function pageIndex() {
  const i = state.components.findIndex((c) => c.id === state.settings.lastPage);
  return i < 0 ? 0 : i;
}

function setupPager() {
  const pager = document.getElementById('pager');
  if (!pager) return;
  pager.scrollLeft = pageIndex() * pager.clientWidth;
  markTab(pageIndex());
  let t;
  pager.addEventListener('scroll', () => {
    const i = Math.round(pager.scrollLeft / pager.clientWidth);
    markTab(i);
    clearTimeout(t);
    t = setTimeout(() => {
      const id = state.components[i]?.id;
      if (id && id !== state.settings.lastPage) { state.settings.lastPage = id; saveSoon(); }
    }, 150);
  }, { passive: true });
}

function markTab(i) {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((t, j) => t.classList.toggle('on', i === j));
  const hist = document.getElementById('hist-link');
  if (hist && state.components[i]) hist.href = `#/history/${state.components[i].id}`;
  const tab = tabs[i], nav = document.getElementById('tabs');
  if (tab && nav) nav.scrollTo({ left: tab.offsetLeft - nav.clientWidth / 2 + tab.clientWidth / 2, behavior: 'smooth' });
}

/* ---------- bottom sheets ---------- */

function openSheet(html) {
  closeSheet(true);
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`;
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  return wrap;
}
function closeSheet(instant) {
  const wrap = document.querySelector('.sheet-wrap');
  if (!wrap) return;
  if (instant) { wrap.remove(); return; }
  wrap.classList.remove('open');
  setTimeout(() => wrap.remove(), 220);
}

async function saveNow(comp) {
  const changed = pendingDials(comp);
  if (!changed.length) return;
  const changes = changed.map((d) => ({ dialId: d.id, name: d.name, unit: unitOf(d), from: d.value, to: current(comp, d) }));
  for (const d of changed) d.value = current(comp, d);
  delete state.pending[comp.id];
  const entry = {
    id: uid(), componentId: comp.id, ts: Date.now(), changes, tags: [], note: '',
    snapshot: Object.fromEntries(comp.dials.map((d) => [d.id, d.value])),
  };
  state.entries.push(entry);
  await save();
  buzz(25);
  rerenderKeepScroll();
  toast('Saved', { label: 'Add note', href: `#/entry/${entry.id}` });
}

function openValueSheet(comp, d) {
  openSheet(`<h3>${esc(d.name)}</h3>
    <p class="muted sheet-sub">${fmt(d, d.min)} – ${fmt(d, d.max)} ${esc(unitOf(d))}</p>
    <input class="big-input" type="text" inputmode="decimal" value="${trim(current(comp, d), 4)}" data-value-input>
    <div class="sheet-actions">
      <button type="button" class="btn" data-action="close-sheet">Cancel</button>
      <button type="button" class="btn primary" data-action="set-value" data-target="${comp.id}|${d.id}">Set</button>
    </div>`);
  const input = document.querySelector('[data-value-input]');
  setTimeout(() => { input.focus(); input.select(); }, 230);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.querySelector('[data-action="set-value"]').click(); });
}

/* ---------- view: history ---------- */

function changeChips(e, comp) {
  if (e.start) return '<span class="chip-ch start">Starting setup</span>';
  if (!e.changes.length) return '<span class="muted">No dial changes</span>';
  return e.changes.map((c) => {
    const d = comp?.dials.find((x) => x.id === c.dialId);
    const up = c.to > c.from;
    return `<span class="chip-ch"><span>${esc(d?.name || c.name)}</span> ${fmtChange(d, c.from)} <i class="${up ? 'up' : 'down'}">→</i> <b>${fmtChange(d, c.to)}</b><em>${esc(effectText(d || { name: c.name }, c.from, c.to).replace(/^[+−]\S+ /, ''))}</em></span>`;
  }).join('');
}

function viewHistory(id) {
  const comp = compById(id);
  if (!comp) return viewMissing();
  const list = entriesFor(id);
  let lastDay = '';
  const items = list.map((e) => {
    const day = fmtDay(e.ts);
    const head = day !== lastDay ? `<li class="day">${esc(day)}</li>` : '';
    lastDay = day;
    return `${head}<li><a class="hist" href="#/entry/${e.id}">
      <time>${fmtTime(e.ts)}</time>
      <div class="hist-body">
        <div class="chgs">${changeChips(e, comp)}</div>
        ${e.tags?.length ? `<div class="tags">${e.tags.map((t) => `<span class="tag on small">${esc(t)}</span>`).join('')}</div>` : ''}
        ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
      </div>
    </a></li>`;
  }).join('');
  return `${header(esc(comp.name), backBtn())}
  <div class="sub">History</div>
  <main>${list.length ? `<ul class="timeline">${items}</ul>` : '<p class="muted pad">Nothing saved yet. Spin a dial and tap Save.</p>'}</main>`;
}

/* ---------- view: entry ---------- */

function viewEntry(id) {
  const e = entryById(id);
  if (!e) return viewMissing();
  const comp = compById(e.componentId);
  const changedIds = new Set(e.changes.map((c) => c.dialId));
  return `${header(fmtDate(e.ts), backBtn(comp ? `#/history/${comp.id}` : '#/'))}
  <div class="sub">${esc(comp?.name || 'Deleted profile')}</div>
  <main>
    <section class="card">
      <h3>${e.start ? 'Starting setup' : 'Changes'}</h3>
      ${e.start ? '<p class="muted">How everything was set when this profile was created.</p>' : `<div class="chgs">${changeChips(e, comp)}</div>`}
    </section>
    ${comp ? `<section class="card">
      <h3>All dials at this point</h3>
      <div class="snap">${comp.dials.filter((d) => e.snapshot?.[d.id] != null).map((d) =>
        `<div class="${changedIds.has(d.id) ? 'changed' : ''}"><span><i class="sw c-${dialColor(d)}"></i>${esc(d.name)}</span><b>${fmt(d, e.snapshot[d.id])} <small>${esc(unitOf(d))}</small></b></div>`).join('')}</div>
    </section>` : ''}
    <section class="card">
      <div class="field"><span>Feel</span>
        <div class="tag-row">${TAGS.map((t) => `<button type="button" class="tag ${e.tags?.includes(t) ? 'on' : ''}" data-action="entry-tag" data-id="${e.id}">${esc(t)}</button>`).join('')}</div></div>
      <label class="field"><span>Note</span>
        <textarea data-entry-note="${e.id}" rows="3" placeholder="How did it feel? Where were you riding?">${esc(e.note)}</textarea></label>
    </section>
    ${comp ? `<button type="button" class="btn block" data-action="restore" data-id="${e.id}">${ICON.undo} Set dials back to this</button>` : ''}
    <button type="button" class="btn danger block" data-action="delete-entry" data-id="${e.id}">Delete entry</button>
  </main>`;
}

/* ---------- view: profile setup ---------- */

let draft = null;
let dirty = false;

function startDraft(id, params) {
  if (id === 'new') {
    const kind = params.get('kind') || 'fork';
    draft = { id: uid(), name: '', kind, bike: '', dials: [], _new: true };
    return true;
  }
  const comp = compById(id);
  if (!comp) return false;
  draft = structuredClone(comp);
  return true;
}

function viewComponent() {
  const used = new Set(draft.dials.map((d) => d.name));
  return `${header(draft._new ? `New ${kindLabel(draft.kind).toLowerCase()}` : esc(draft.name || 'Setup'), backBtn())}
  <main class="form">
    <section class="card">
      <input class="name-input" data-bind="name" value="${esc(draft.name)}" placeholder="${draft.kind === 'shock' ? 'Shock name, e.g. Float X2' : 'Fork name, e.g. Lyrik'}" autocomplete="off" aria-label="Name">
      ${seg('draft-set', 'kind', draft.kind, KINDS)}
    </section>
    ${draft.dials.map((d, i) => dialEditor(d, i)).join('')}
    <div class="chips wrap">
      ${PRESETS.map(([n], i) => (used.has(n) ? '' : `<button type="button" class="chip" data-action="add-dial" data-preset="${i}">+ ${esc(n)}</button>`)).join('')}
      <button type="button" class="chip" data-action="add-dial" data-preset="-1">+ Other</button>
    </div>
    ${draft._new ? '' : '<button type="button" class="btn danger block" data-action="delete-component">Delete</button>'}
  </main>
  <div class="dock"><button type="button" class="btn primary big block" data-action="save-component">Save</button></div>`;
}

function numField(i, key, label, value, dp = 3) {
  return `<label class="field"><span>${label}</span><input inputmode="decimal" data-bind="dials.${i}.${key}" data-type="num" value="${esc(trim(value, dp))}"></label>`;
}

function dialEditor(d, i) {
  const t = typeTab(d);
  const attrs = `data-index="${i}"`;
  let options = '';
  if (t === 'pressure') options += `<div class="field"><span>Unit</span>${seg('dial-set', 'type', d.type, [['psi', 'psi'], ['bar', 'bar']], attrs)}</div>`;
  if (t === 'turns') options += `<div class="field"><span>Snap</span>${seg('dial-set', 'step', d.step, [[0.25, '¼'], [0.125, '⅛'], [0.0625, '1/16']], attrs)}</div>`;
  if (t === 'custom') {
    options += `<div class="two"><label class="field"><span>Unit</span><input data-bind="dials.${i}.unit" value="${esc(d.unit)}" placeholder="%, mm…" autocomplete="off"></label>${numField(i, 'step', 'Step', d.step)}</div>`;
  }
  options += `<div class="field"><span>Control</span>${seg('dial-set', 'control', d.control, [['dial', 'Dial'], ['slider', 'Slider']], attrs)}</div>`;
  if (!isSlider(d)) options += `<div class="field"><span>Clockwise</span>${seg('dial-set', 'reverse', d.reverse, [[false, 'Increases'], [true, 'Decreases']], attrs)}</div>`;
  return `<section class="card dial-edit">
    <div class="dial-edit-head">
      <i class="sw big c-${dialColor(d)}"></i>
      <input data-bind="dials.${i}.name" value="${esc(d.name)}" placeholder="Dial name" autocomplete="off" aria-label="Dial name">
      <button type="button" class="icon-btn subtle" data-action="del-dial" data-index="${i}" aria-label="Remove ${esc(d.name)}">${ICON.x}</button>
    </div>
    ${seg('dial-set', 'main', d.main, [[true, 'Trailside'], [false, 'Workshop']], attrs)}
    ${seg('dial-set', 'tab', t, TYPE_TABS, attrs)}
    <div class="three">${numField(i, 'min', 'Min', d.min)}${numField(i, 'max', 'Max', d.max)}${numField(i, 'value', 'Now', d.value)}</div>
    <details class="options"><summary>Options</summary>${options}</details>
  </section>`;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
}

function setDialType(d, type) {
  const def = TYPES[type];
  Object.assign(d, { type, min: def.min, max: def.max, step: def.step, control: defaultControl(type) });
  d.value = clamp(d.value ?? def.min, def.min, def.max);
  if (type === 'psi' || type === 'bar') {
    // Start near a typical pressure rather than the bottom of a 0–600 psi range.
    const psi = draft?.kind === 'shock' ? 180 : 80;
    d.value = type === 'bar' ? +(psi / PSI_PER_BAR).toFixed(1) : psi;
  }
}

async function saveComponent() {
  const name = draft.name.trim();
  if (!name) { toast('Give it a name'); $app.querySelector('[data-bind="name"]').focus(); return; }
  for (const d of draft.dials) {
    d.name = d.name.trim();
    if (!d.name) { toast('Every dial needs a name'); return; }
    const t = TYPES[d.type];
    d.min = d.min ?? t.min;
    d.max = d.max ?? t.max;
    d.step = d.type === 'clicks' || d.type === 'spacers' ? 1 : d.step > 0 ? d.step : t.step;
    if (d.max <= d.min) { toast(`${d.name}: the top value must be above the bottom one`); return; }
    const v = clamp(d.value ?? d.min, d.min, d.max);
    d.value = +(d.min + Math.round((v - d.min) / d.step) * d.step).toFixed(4);
  }
  const { _new, ...comp } = draft;
  comp.name = name;
  comp.bike = comp.bike.trim();
  const i = state.components.findIndex((c) => c.id === comp.id);
  if (i >= 0) state.components[i] = comp; else state.components.push(comp);
  // Drop or clamp pending dial moves that no longer fit the setup.
  const p = state.pending[comp.id];
  if (p) {
    for (const id of Object.keys(p)) {
      const d = comp.dials.find((x) => x.id === id);
      if (!d) delete p[id]; else setPending(comp, d, clamp(p[id], d.min, d.max));
    }
  }
  if (_new) {
    state.entries.push({ id: uid(), componentId: comp.id, ts: Date.now(), start: true, changes: [], tags: [], note: '',
      snapshot: Object.fromEntries(comp.dials.map((d) => [d.id, d.value])) });
  }
  state.settings.lastPage = comp.id;
  await save();
  dirty = false;
  toast('Saved');
  location.hash = '#/';
}

/* ---------- view: settings ---------- */

function viewSettings() {
  const s = state.settings;
  return `${header('Settings', backBtn())}
  <main>
    ${installCard()}
    <section class="card">
      ${state.components.map((c) => `<a class="list-item" href="#/component/${c.id}">
        <span><b>${esc(c.name)}</b><small>${esc(kindLabel(c.kind))}</small></span>${ICON.chevron}</a>`).join('')}
      <div class="two">
        <a class="btn block" href="#/component/new?kind=fork">${ICON.plus} Fork</a>
        <a class="btn block" href="#/component/new?kind=shock">${ICON.plus} Shock</a>
      </div>
    </section>
    <section class="card share">
      <img src="icons/qr.svg" alt="QR code to get SagBook" width="132" height="132">
      <div>
        <h3>Share SagBook</h3>
        <p class="muted small">Friends scan this to install. Everyone gets updates automatically, and keeps their own data.</p>
        <button type="button" class="btn" data-action="share">Share link</button>
      </div>
    </section>
    <section class="card">
      <div class="field"><span>Theme</span>${seg('setting', 'theme', s.theme, [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']])}</div>
    </section>
    <section class="card">
      <div class="two">
        <button type="button" class="btn" data-action="export">Back up</button>
        <label class="btn">Restore<input type="file" accept=".json,application/json" data-action="import" hidden></label>
      </div>
      <p class="muted small center">Last backup: ${s.lastBackup ? esc(fmtDate(s.lastBackup)) : 'never'}</p>
    </section>
    <section class="card">
      <p class="muted small">Quick launch: Settings → Advanced features → Side button → Double press → Open app → SagBook</p>
      <button type="button" class="btn block" data-action="check-update">Check for updates</button>
      <p class="muted small center">Version ${esc(APP_VERSION)}</p>
    </section>
  </main>`;
}

async function exportData() {
  const name = `sagbook-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  state.settings.lastBackup = Date.now();
  await save();
  toast(`Saved ${name} to Downloads`);
  rerenderKeepScroll();
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.entries) || !(Array.isArray(data.components) || Array.isArray(data.bikes))) throw new Error('Not a SagBook backup');
    const next = migrate(data);
    if (!confirm(`Replace everything on this phone with this backup (${next.components.length} forks/shocks, ${next.entries.length} entries)?`)) return;
    state = next;
    await save();
    applyTheme();
    toast('Backup restored');
    location.hash = '#/';
  } catch (e) {
    toast('Could not restore: ' + e.message);
  }
}

function viewMissing() {
  return `${header('Not found', backBtn())}<main><p class="muted pad">That item no longer exists.</p></main>`;
}

/* ---------- theme ---------- */

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0d0f13' : '#f2f3f6';
}

/* ---------- router ---------- */

function parseHash() {
  const [path, query] = (location.hash.slice(1) || '/').split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

function render() {
  const { parts: [view, id], params } = parseHash();
  let html;
  if (view === 'component') html = draft && (draft.id === id || (id === 'new' && draft._new)) ? viewComponent() : startDraft(id, params) ? viewComponent() : viewMissing();
  else if (view === 'history') html = viewHistory(id);
  else if (view === 'entry') html = viewEntry(id);
  else if (view === 'settings') html = viewSettings();
  else html = viewMain();
  const main = !['component', 'history', 'entry', 'settings'].includes(view);
  $app.classList.toggle('main-view', main && state.components.length > 0);
  $app.innerHTML = html;
  if (main) { setupPager(); fitDials(); }
  if (view === 'settings') showPersistStatus();
}

let currentHash = location.hash;
window.addEventListener('hashchange', () => {
  if (dirty && !confirm('Discard unsaved changes?')) {
    history.pushState(null, '', currentHash || '#/');
    return;
  }
  closeSheet(true);
  dirty = false;
  draft = null;
  currentHash = location.hash;
  render();
  scrollTo(0, 0);
});

// Re-render the current screen, keeping the page and scroll position.
function rerenderKeepScroll() {
  const y = scrollY;
  const pager = document.getElementById('pager');
  if (pager) state.settings.lastPage = state.components[Math.round(pager.scrollLeft / pager.clientWidth)]?.id ?? state.settings.lastPage;
  const pageScroll = document.querySelector(`.page[data-comp="${state.settings.lastPage}"]`)?.scrollTop;
  render();
  scrollTo(0, y);
  const page = document.querySelector(`.page[data-comp="${state.settings.lastPage}"]`);
  if (page && pageScroll) page.scrollTop = pageScroll;
}

/* ---------- events ---------- */

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.dataset.action === 'import') return;
  const { action } = el.dataset;
  if (action === 'goto-page') {
    const pager = document.getElementById('pager');
    pager.scrollTo({ left: +el.dataset.index * pager.clientWidth, behavior: 'smooth' });
  } else if (action === 'select-dial') {
    const [cid, did] = el.dataset.tile.split('|');
    const comp = compById(cid);
    state.settings.selected[`${cid}:${activeSection(comp)}`] = did;
    const hero = $app.querySelector(`.page[data-comp="${cid}"] .hero`);
    hero.outerHTML = heroHtml(comp, comp.dials.find((d) => d.id === did));
    fitDials();
    $app.querySelectorAll(`.page[data-comp="${cid}"] .tile`).forEach((t) => t.classList.toggle('sel', t.dataset.tile === el.dataset.tile));
    buzz(5);
    saveSoon();
  } else if (action === 'section') {
    const [cid, sec] = el.dataset.secBtn.split('|');
    state.settings.section[cid] = sec;
    const page = $app.querySelector(`.page[data-comp="${cid}"]`);
    page.outerHTML = pageHtml(compById(cid));
    fitDials();
    buzz(5);
    saveSoon();
  } else if (action === 'nudge') {
    const [comp, d] = heroTarget(el);
    if (stepDial(comp, d, +el.dataset.dir)) refreshDial(comp, d);
    else buzz(40);
  } else if (action === 'reset-dial') {
    const [comp, d] = heroTarget(el);
    setPending(comp, d, d.value);
    refreshDial(comp, d);
    save();
  } else if (action === 'type-value') {
    const [comp, d] = heroTarget(el);
    openValueSheet(comp, d);
  } else if (action === 'set-value') {
    const [cid, did] = el.dataset.target.split('|');
    const comp = compById(cid), d = comp.dials.find((x) => x.id === did);
    const n = num(document.querySelector('[data-value-input]').value);
    if (n == null) { toast('Enter a number'); return; }
    const snapped = +(d.min + Math.round((clamp(n, d.min, d.max) - d.min) / d.step) * d.step).toFixed(4);
    setPending(comp, d, snapped);
    closeSheet();
    refreshDial(comp, d);
    save();
  } else if (action === 'undo') {
    delete state.pending[el.dataset.id];
    await save();
    rerenderKeepScroll();
  } else if (action === 'save-now') {
    saveNow(compById(el.dataset.id));
  } else if (action === 'close-sheet') {
    closeSheet();
  } else if (action === 'entry-tag') {
    const e = entryById(el.dataset.id);
    const t = el.textContent;
    e.tags = e.tags.includes(t) ? e.tags.filter((x) => x !== t) : [...e.tags, t];
    el.classList.toggle('on');
    saveSoon();
  } else if (action === 'restore') {
    const e = entryById(el.dataset.id);
    const comp = compById(e.componentId);
    for (const d of comp.dials) if (e.snapshot?.[d.id] != null) setPending(comp, d, clamp(e.snapshot[d.id], d.min, d.max));
    state.settings.lastPage = comp.id;
    await save();
    toast(pendingDials(comp).length ? 'Dials set back — set them on the bike, then Save' : 'Already set like this');
    location.hash = '#/';
  } else if (action === 'delete-entry') {
    if (!confirm('Delete this entry?')) return;
    const e = entryById(el.dataset.id);
    state.entries = state.entries.filter((x) => x.id !== e.id);
    await save();
    toast('Entry deleted');
    location.hash = compById(e.componentId) ? `#/history/${e.componentId}` : '#/';
  } else if (action === 'draft-set') {
    setPath(draft, el.dataset.key, el.dataset.value);
    dirty = true;
    rerenderKeepScroll();
  } else if (action === 'dial-set') {
    const d = draft.dials[+el.dataset.index];
    const { key, value } = el.dataset;
    if (key === 'tab') setDialType(d, value === 'pressure' ? 'psi' : value);
    else if (key === 'type') setDialType(d, value);
    else if (key === 'step') d.step = +value;
    else if (key === 'reverse') d.reverse = value === 'true';
    else if (key === 'control') d.control = value;
    else if (key === 'main') d.main = value === 'true';
    dirty = true;
    rerenderKeepScroll();
  } else if (action === 'add-dial') {
    const preset = PRESETS[+el.dataset.preset];
    const d = preset ? newDial(preset[0], preset[1], preset[2]) : newDial('', 'clicks');
    if (d.type === 'psi') d.value = draft.kind === 'shock' ? 180 : 80;
    if (d.type === 'clicks') d.value = Math.round(d.max / 2);
    draft.dials.push(d);
    dirty = true;
    rerenderKeepScroll();
    if (!preset) [...$app.querySelectorAll('.dial-edit-head input')].at(-1)?.focus();
  } else if (action === 'del-dial') {
    draft.dials.splice(+el.dataset.index, 1);
    dirty = true;
    rerenderKeepScroll();
  } else if (action === 'move-dial') {
    const i = +el.dataset.index, j = i + +el.dataset.dir;
    [draft.dials[i], draft.dials[j]] = [draft.dials[j], draft.dials[i]];
    dirty = true;
    rerenderKeepScroll();
  } else if (action === 'save-component') {
    saveComponent();
  } else if (action === 'delete-component') {
    const n = state.entries.filter((e) => e.componentId === draft.id).length;
    if (!confirm(`Delete ${draft.name || 'this profile'} and its ${n} history entr${n === 1 ? 'y' : 'ies'}? This can't be undone.`)) return;
    state.components = state.components.filter((c) => c.id !== draft.id);
    state.entries = state.entries.filter((e) => e.componentId !== draft.id);
    delete state.pending[draft.id];
    await save();
    dirty = false;
    toast('Deleted');
    location.hash = '#/';
  } else if (action === 'setting') {
    state.settings[el.dataset.key] = el.dataset.value;
    await save();
    applyTheme();
    rerenderKeepScroll();
  } else if (action === 'export') {
    exportData();
  } else if (action === 'share') {
    const url = 'https://kieranburton30.github.io/sagbook/';
    try {
      if (navigator.share) await navigator.share({ title: 'SagBook', text: 'Suspension setup log', url });
      else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    } catch { /* share cancelled */ }
  } else if (action === 'check-update') {
    checkForUpdate();
  } else if (action === 'install') {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    rerenderKeepScroll();
  }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.entryNote) {
    entryById(t.dataset.entryNote).note = t.value;
    saveSoon();
  } else if (t.dataset.bind && draft) {
    let v = t.value;
    if (t.dataset.type === 'num') v = num(v);
    setPath(draft, t.dataset.bind, v);
    dirty = true;
    // Keep the colour swatch in step with the dial name.
    const m = t.dataset.bind.match(/^dials\.(\d+)\.name$/);
    if (m) t.previousElementSibling.className = `sw big c-${dialColor(draft.dials[+m[1]])}`;
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.action === 'import' && t.files[0]) importData(t.files[0]);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state) save();
});

/* ---------- persistence + updates ---------- */

async function showPersistStatus() {
  const el = document.getElementById('persist');
  if (!el || !navigator.storage?.persisted) return;
  const ok = await navigator.storage.persisted();
  el.textContent = ok ? 'Storage is protected from automatic clearing.' : 'Tip: install SagBook to your home screen so Android keeps its data safe.';
}

let swReg = null;

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // Skip on the local dev server so edits show up immediately.
  if (['localhost', '127.0.0.1'].includes(location.hostname) && !new URLSearchParams(location.search).has('sw')) return;
  // The first controller after a fresh install isn't an update.
  let hadController = !!navigator.serviceWorker.controller;
  swReg = await navigator.serviceWorker.register('sw.js');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') swReg.update().catch(() => {});
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!hadController) { hadController = true; return; }
    // Dial moves are already saved; only an open setup form or sheet can lose work.
    if (reloading || dirty || drag || document.querySelector('.sheet-wrap')) return;
    reloading = true;
    await save();
    sessionStorage.setItem('sagbook-updated', '1');
    location.reload();
  });
}

async function checkForUpdate() {
  if (!swReg) { toast('Updates are automatic once installed from the web'); return; }
  toast('Checking…');
  try {
    await swReg.update();
    if (!swReg.installing && !swReg.waiting) toast(`Up to date (${APP_VERSION})`);
  } catch {
    toast('Offline — try again with signal');
  }
}

/* ---------- start ---------- */

(async () => {
  await load();
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  render();
  addEventListener('resize', () => {
    const pager = document.getElementById('pager');
    if (pager) pager.scrollLeft = pageIndex() * pager.clientWidth;
  });
  if (sessionStorage.getItem('sagbook-updated')) {
    sessionStorage.removeItem('sagbook-updated');
    toast(`Updated to ${APP_VERSION}`);
  }
  navigator.storage?.persist?.().catch(() => {});
  registerSW().catch(() => {});
})();
