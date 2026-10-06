// SagBook: suspension dial log. Plain JS, no build step.
// tools/update.ps1 rewrites APP_VERSION on every publish.
const APP_VERSION = '2026.10.06-2211';
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

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString(undefined, opts)} ${time}`;
}

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
}
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

/* ---------- dial types ---------- */

const TYPES = {
  clicks: { label: 'Clicks', unit: 'clicks', step: 1, min: 0, max: 16 },
  turns: { label: 'Turns', unit: 'turns', step: 0.25, min: 0, max: 4 },
  psi: { label: 'Pressure (psi)', unit: 'psi', step: 1, min: 0, max: 300 },
  bar: { label: 'Pressure (bar)', unit: 'bar', step: 0.1, min: 0, max: 20 },
  spacers: { label: 'Spacers / tokens', unit: 'spacers', step: 1, min: 0, max: 6 },
  custom: { label: 'Other', unit: '', step: 1, min: 0, max: 100 },
};
const PRESETS = [
  ['Rebound', 'clicks'], ['LSC', 'clicks'], ['HSC', 'clicks'], ['LSR', 'clicks'], ['HSR', 'clicks'],
  ['Air pressure', 'psi'], ['Volume spacers', 'spacers'], ['Preload', 'turns'],
  ['Sag', 'custom', { unit: '%', min: 0, max: 50, value: 25 }],
];

function newDial(name, type, o = {}) {
  const t = TYPES[type];
  return {
    id: uid(), name, type,
    unit: o.unit ?? '',
    min: o.min ?? t.min, max: o.max ?? t.max, step: o.step ?? t.step,
    value: o.value ?? o.min ?? t.min,
  };
}
const unitOf = (d) => (d.type === 'custom' ? d.unit || '' : TYPES[d.type].unit);
const fmt = (d, v) => trim(v, 2);
const stepCount = (d) => Math.max(1, Math.round((d.max - d.min) / d.step));
// Finger rotation per step: a short dial spans about 270° of travel like a real
// adjuster; long ranges (pressure) get a finer, fixed feel.
const degPerStep = (d) => clamp(270 / stepCount(d), 8, 36);

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
    settings: { theme: 'auto', lastPage: null, lastBackup: null },
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
      else map.push([newDial('Air pressure', bar ? 'bar' : 'psi'), (su) => (su.pressure == null ? null : bar ? +(su.pressure / PSI_PER_BAR).toFixed(1) : su.pressure)]);
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
        s.entries.push({ id: uid(), componentId: comp.id, ts: e.ts, start: !prev, changes, snapshot: snap, note: [e.location, e.notes].filter(Boolean).join(' — ') });
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
  s.components ||= [];
  s.entries ||= [];
  s.pending ||= {};
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
const pendingCount = (comp) => comp.dials.filter((d) => current(comp, d) !== d.value).length;
const KINDS = [['fork', 'Fork'], ['shock', 'Shock'], ['other', 'Other']];
const kindLabel = (k) => KINDS.find(([v]) => v === k)?.[1] || 'Other';

function setPending(comp, d, v) {
  const p = (state.pending[comp.id] ||= {});
  if (v === d.value) delete p[d.id]; else p[d.id] = v;
  if (!Object.keys(p).length) delete state.pending[comp.id];
}

/* ---------- icons ---------- */

const svg = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1z"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  chevron: svg('<path d="M9 18l6-6-6-6"/>'),
  up: svg('<path d="M18 15l-6-6-6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
};

const header = (title, left = '', right = '<span class="icon-btn"></span>') =>
  `<header class="top">${left || '<span class="icon-btn"></span>'}<h1>${title}</h1>${right}</header>`;
const backBtn = (href = '#/') => `<a class="icon-btn" href="${href}" aria-label="Back">${ICON.back}</a>`;
const gearBtn = `<a class="icon-btn" href="#/settings" aria-label="Settings">${ICON.gear}</a>`;
const seg = (action, key, value, options) => `<div class="seg">${options.map(([v, label]) =>
  `<button type="button" class="${v === value ? 'on' : ''}" data-action="${action}" data-key="${key}" data-value="${v}">${label}</button>`).join('')}</div>`;

/* ---------- install ---------- */

let installPrompt = null;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isPhone = () => /Android|iPhone|iPad/i.test(navigator.userAgent);

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
    ${!isPhone() ? `<div class="qr"><img src="icons/qr.svg" alt="QR code for the SagBook link" width="160" height="160">
      <p class="muted">Scan with your phone's camera to open SagBook there.</p></div>` : ''}
  </section>`;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (state && !location.hash.startsWith('#/component')) rerenderKeepScroll();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('SagBook installed — open it from your home screen');
});

/* ---------- view: dials (main) ---------- */

const GAUGE = 'M18.89 81.11 A44 44 0 1 1 81.11 81.11'; // 270° arc, gap at the bottom

function viewMain() {
  if (!state.components.length) {
    return `${header('SagBook', '', gearBtn)}
    ${installCard()}
    <main class="empty">
      <h2>Set up your suspension</h2>
      <p class="muted">Add your fork and shock, tell SagBook which dials they have and where they're set. Then just spin the dials as you change them.</p>
      <a class="btn primary big" href="#/component/new?kind=fork">Add fork</a>
      <a class="btn big" href="#/component/new?kind=shock">Add shock</a>
    </main>`;
  }
  return `${header('SagBook', '', gearBtn)}
  <nav class="tabs" id="tabs">${state.components.map((c, i) =>
    `<button type="button" class="tab" data-action="goto-page" data-index="${i}">${esc(c.name)}${pendingCount(c) ? '<i class="dot"></i>' : ''}</button>`).join('')}</nav>
  <div class="pager" id="pager">${state.components.map(pageHtml).join('')}</div>`;
}

function pageHtml(comp) {
  const list = entriesFor(comp.id);
  return `<section class="page" data-comp="${comp.id}">
    <div class="page-head">
      <div><h2>${esc(comp.name)}</h2><span class="muted">${esc([kindLabel(comp.kind), comp.bike].filter(Boolean).join(' · '))}</span></div>
      <a class="link" href="#/component/${comp.id}">${ICON.edit} Setup</a>
    </div>
    ${comp.dials.length
      ? `<div class="dials">${comp.dials.map((d) => dialCard(comp, d)).join('')}</div>`
      : `<p class="muted pad">No dials yet. <a class="link" href="#/component/${comp.id}">Add dials</a></p>`}
    <h3 class="section">History</h3>
    ${list.length ? `<ul class="history">${list.map(historyItem).join('')}</ul>` : '<p class="muted pad">Changes you save appear here.</p>'}
    ${saveBar(comp)}
  </section>`;
}

function dialState(comp, d) {
  const v = current(comp, d);
  const pct = (clamp(v, d.min, d.max) - d.min) / ((d.max - d.min) || 1);
  return { v, pct, changed: v !== d.value };
}

function dialCard(comp, d) {
  const { v, pct, changed } = dialState(comp, d);
  return `<div class="dial ${changed ? 'changed' : ''}" data-dial="${comp.id}|${d.id}">
    <div class="dial-name">${esc(d.name)}</div>
    <button type="button" class="dial-value" data-action="type-value" aria-label="Type a value for ${esc(d.name)}"><b>${fmt(d, v)}</b><small>${esc(unitOf(d))}</small></button>
    <div class="dial-was">${changed ? `was ${fmt(d, d.value)}` : `${fmt(d, d.min)}–${fmt(d, d.max)}`}</div>
    <div class="knob-wrap">
      <svg class="gauge" viewBox="0 0 100 100" aria-hidden="true">
        <path d="${GAUGE}" pathLength="100" class="track"/>
        <path d="${GAUGE}" pathLength="100" class="fill" stroke-dasharray="${(pct * 100).toFixed(2)} 100"/>
      </svg>
      <div class="knob" role="slider" tabindex="0" aria-label="${esc(d.name)}" aria-valuemin="${d.min}" aria-valuemax="${d.max}" aria-valuenow="${v}"
        style="--rot:${(-135 + pct * 270).toFixed(1)}deg"><span class="pointer"></span></div>
    </div>
    <div class="dial-steps">
      <button type="button" data-action="nudge" data-dir="-1" aria-label="Decrease ${esc(d.name)}">−</button>
      <button type="button" data-action="nudge" data-dir="1" aria-label="Increase ${esc(d.name)}">+</button>
    </div>
  </div>`;
}

function saveBar(comp) {
  const n = pendingCount(comp);
  return `<div class="savebar ${n ? 'show' : ''}" data-savebar="${comp.id}">
    <input class="note-input" data-note="${comp.id}" placeholder="Note (optional) — e.g. harsh on roots" autocomplete="off">
    <div class="savebar-row">
      <span class="count">${n} change${n === 1 ? '' : 's'}</span>
      <button type="button" class="btn" data-action="undo" data-id="${comp.id}">Undo</button>
      <button type="button" class="btn primary" data-action="save-changes" data-id="${comp.id}">Save</button>
    </div>
  </div>`;
}

function historyItem(e) {
  const comp = compById(e.componentId);
  const body = e.start
    ? '<span class="muted">Starting setup</span>'
    : e.changes.length
      ? e.changes.map((c) => {
        const name = comp?.dials.find((d) => d.id === c.dialId)?.name || c.name;
        return `<span class="chg">${esc(name)} ${esc(trim(c.from) || '–')} → <b>${esc(trim(c.to) || '–')}</b>${c.unit ? ` <small>${esc(c.unit)}</small>` : ''}</span>`;
      }).join('')
      : '<span class="muted">No dial changes</span>';
  return `<li><a class="hist" href="#/entry/${e.id}">
    <time>${fmtDate(e.ts)}</time>
    <div class="chgs">${body}</div>
    ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
  </a></li>`;
}

// Update one dial in place (re-rendering would break an active drag).
function refreshDial(comp, d) {
  const card = $app.querySelector(`[data-dial="${comp.id}|${d.id}"]`);
  if (!card) return;
  const { v, pct, changed } = dialState(comp, d);
  card.classList.toggle('changed', changed);
  card.querySelector('.dial-value b').textContent = fmt(d, v);
  card.querySelector('.dial-was').textContent = changed ? `was ${fmt(d, d.value)}` : `${fmt(d, d.min)}–${fmt(d, d.max)}`;
  card.querySelector('.fill').setAttribute('stroke-dasharray', `${(pct * 100).toFixed(2)} 100`);
  const knob = card.querySelector('.knob');
  knob.style.setProperty('--rot', `${(-135 + pct * 270).toFixed(1)}deg`);
  knob.setAttribute('aria-valuenow', v);
  refreshSaveBar(comp);
}

function refreshSaveBar(comp) {
  const bar = $app.querySelector(`[data-savebar="${comp.id}"]`);
  const n = pendingCount(comp);
  if (bar) {
    bar.classList.toggle('show', n > 0);
    bar.querySelector('.count').textContent = `${n} change${n === 1 ? '' : 's'}`;
  }
  const i = state.components.indexOf(comp);
  const tab = $app.querySelectorAll('.tab')[i];
  if (tab) {
    const dot = tab.querySelector('.dot');
    if (n && !dot) tab.insertAdjacentHTML('beforeend', '<i class="dot"></i>');
    if (!n && dot) dot.remove();
  }
}

function stepDial(comp, d, dir) {
  const v = current(comp, d);
  const nv = +clamp(v + dir * d.step, d.min, d.max).toFixed(4);
  if (nv === v) { buzz(30); return false; }
  setPending(comp, d, nv);
  buzz(6);
  refreshDial(comp, d);
  saveSoon();
  return true;
}

async function saveChanges(comp) {
  const changed = comp.dials.filter((d) => current(comp, d) !== d.value);
  if (!changed.length) return;
  const changes = changed.map((d) => ({ dialId: d.id, name: d.name, unit: unitOf(d), from: d.value, to: current(comp, d) }));
  for (const d of changed) d.value = current(comp, d);
  delete state.pending[comp.id];
  const note = $app.querySelector(`[data-note="${comp.id}"]`)?.value.trim() || '';
  state.entries.push({
    id: uid(), componentId: comp.id, ts: Date.now(), changes, note,
    snapshot: Object.fromEntries(comp.dials.map((d) => [d.id, d.value])),
  });
  await save();
  buzz(20);
  toast('Saved');
  rerenderKeepScroll();
}

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
  tabs[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ---------- knob dragging ---------- */

let drag = null;
const angleOf = (e) => Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) * 180 / Math.PI;

document.addEventListener('pointerdown', (e) => {
  const knob = e.target.closest('.knob');
  if (!knob) return;
  const [cid, did] = knob.closest('.dial').dataset.dial.split('|');
  const comp = compById(cid);
  const r = knob.getBoundingClientRect();
  drag = { comp, d: comp.dials.find((x) => x.id === did), cx: r.left + r.width / 2, cy: r.top + r.height / 2, acc: 0, id: e.pointerId, knob };
  drag.last = angleOf(e);
  try { knob.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  knob.classList.add('active');
  e.preventDefault();
});

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 10) return; // too close to the centre to read an angle
  const a = angleOf(e);
  let delta = a - drag.last;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  drag.last = a;
  drag.acc += delta;
  const per = degPerStep(drag.d);
  while (Math.abs(drag.acc) >= per) {
    const dir = Math.sign(drag.acc);
    drag.acc -= dir * per;
    if (!stepDial(drag.comp, drag.d, dir)) { drag.acc = 0; break; }
  }
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  drag.knob.classList.remove('active');
  drag = null;
  save();
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

document.addEventListener('keydown', (e) => {
  const knob = e.target.closest?.('.knob');
  if (!knob) return;
  const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
  if (!dir) return;
  const [cid, did] = knob.closest('.dial').dataset.dial.split('|');
  const comp = compById(cid);
  stepDial(comp, comp.dials.find((x) => x.id === did), dir);
  e.preventDefault();
});

/* ---------- view: entry ---------- */

function viewEntry(id) {
  const e = entryById(id);
  if (!e) return viewMissing();
  const comp = compById(e.componentId);
  const name = (dialId, fallback) => comp?.dials.find((d) => d.id === dialId)?.name || fallback;
  const changedIds = new Set(e.changes.map((c) => c.dialId));
  return `${header(fmtDate(e.ts), backBtn())}
  <div class="sub">${esc(comp?.name || 'Deleted profile')}</div>
  <main>
    <section class="card">
      <h3>${e.start ? 'Starting setup' : 'Changes'}</h3>
      ${e.start ? '<p class="muted">How everything was set when this profile was created.</p>'
        : e.changes.map((c) => `<p class="chg big">${esc(name(c.dialId, c.name))} ${esc(trim(c.from) || '–')} → <b>${esc(trim(c.to) || '–')}</b> <small>${esc(c.unit)}</small></p>`).join('') || '<p class="muted">No dial changes</p>'}
    </section>
    ${comp ? `<section class="card">
      <h3>All dials after this change</h3>
      <div class="snap">${comp.dials.filter((d) => e.snapshot?.[d.id] != null).map((d) =>
        `<div class="${changedIds.has(d.id) ? 'changed' : ''}"><span>${esc(d.name)}</span><b>${fmt(d, e.snapshot[d.id])} <small>${esc(unitOf(d))}</small></b></div>`).join('')}</div>
    </section>` : ''}
    <section class="card">
      <label class="field"><span>Note</span>
        <textarea data-entry-note="${e.id}" rows="3" placeholder="How did it feel? Where were you riding?">${esc(e.note)}</textarea></label>
    </section>
    ${comp ? `<button type="button" class="btn block" data-action="restore" data-id="${e.id}">Set dials back to this</button>` : ''}
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
  return `${header(draft._new ? `New ${kindLabel(draft.kind).toLowerCase()}` : 'Setup', backBtn(draft._new ? '#/' : '#/'))}
  <main class="form">
    <section class="card">
      <label class="field"><span>Name</span>
        <input data-bind="name" value="${esc(draft.name)}" placeholder="${draft.kind === 'shock' ? 'e.g. Fox Float X2' : 'e.g. RockShox Lyrik'}" autocomplete="off"></label>
      <div class="field"><span>Type</span>${seg('draft-set', 'kind', draft.kind, KINDS)}</div>
      <label class="field"><span>Bike <em class="muted">(optional)</em></span>
        <input data-bind="bike" value="${esc(draft.bike)}" placeholder="e.g. Enduro bike" autocomplete="off"></label>
    </section>
    <h3 class="section">Dials</h3>
    ${draft.dials.map((d, i) => dialEditor(d, i)).join('') || '<p class="muted pad">Add the dials this one has:</p>'}
    <div class="chips wrap">
      ${PRESETS.filter(([n]) => !used.has(n)).map(([n], i) =>
        `<button type="button" class="chip" data-action="add-dial" data-preset="${PRESETS.findIndex(([p]) => p === n)}">+ ${esc(n)}</button>`).join('')}
      <button type="button" class="chip" data-action="add-dial" data-preset="-1">+ Custom dial</button>
    </div>
    ${draft._new ? '' : '<button type="button" class="btn danger block" data-action="delete-component">Delete this profile</button>'}
  </main>
  <div class="dock"><button type="button" class="btn primary big block" data-action="save-component">Save</button></div>`;
}

function dialEditor(d, i) {
  const b = (k) => `dials.${i}.${k}`;
  const isClicks = d.type === 'clicks';
  return `<section class="card dial-edit">
    <div class="dial-edit-head">
      <input data-bind="${b('name')}" value="${esc(d.name)}" placeholder="Dial name" autocomplete="off" aria-label="Dial name">
      <button type="button" class="icon-btn subtle" data-action="move-dial" data-index="${i}" data-dir="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
      <button type="button" class="icon-btn subtle" data-action="move-dial" data-index="${i}" data-dir="1" aria-label="Move down" ${i === draft.dials.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
      <button type="button" class="icon-btn subtle" data-action="del-dial" data-index="${i}" aria-label="Remove ${esc(d.name)}">✕</button>
    </div>
    <div class="field"><span>Measured in</span>
      <select data-bind="${b('type')}" data-type="type">${Object.entries(TYPES).map(([k, t]) =>
        `<option value="${k}" ${k === d.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
    ${d.type === 'custom' ? `<label class="field"><span>Unit</span><input data-bind="${b('unit')}" value="${esc(d.unit)}" placeholder="e.g. %, mm, lb" autocomplete="off"></label>` : ''}
    <div class="three">
      <label class="field"><span>Min</span><input inputmode="decimal" data-bind="${b('min')}" data-type="num" value="${esc(trim(d.min))}"></label>
      <label class="field"><span>${isClicks ? 'Total clicks' : 'Max'}</span><input inputmode="decimal" data-bind="${b('max')}" data-type="num" value="${esc(trim(d.max))}"></label>
      <label class="field"><span>Current</span><input inputmode="decimal" data-bind="${b('value')}" data-type="num" value="${esc(trim(d.value))}"></label>
    </div>
    ${isClicks ? '<p class="muted small">Count clicks from fully open (lowest), so 0 = fully open.</p>'
      : `<label class="field narrow"><span>Each step</span><input inputmode="decimal" data-bind="${b('step')}" data-type="num" value="${esc(trim(d.step, 3))}"></label>`}
  </section>`;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
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
    d.step = d.type === 'clicks' ? 1 : d.step > 0 ? d.step : t.step;
    if (d.max <= d.min) { toast(`${d.name}: max must be above min`); return; }
    d.value = clamp(d.value ?? d.min, d.min, d.max);
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
    state.entries.push({ id: uid(), componentId: comp.id, ts: Date.now(), start: true, changes: [], note: '',
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
      <h3>Forks &amp; shocks</h3>
      ${state.components.map((c) => `<a class="list-item" href="#/component/${c.id}">
        <span><b>${esc(c.name)}</b><small>${esc([kindLabel(c.kind), c.bike, `${c.dials.length} dial${c.dials.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '))}</small></span>${ICON.chevron}</a>`).join('')}
      <div class="two">
        <a class="btn block" href="#/component/new?kind=fork">${ICON.plus} Fork</a>
        <a class="btn block" href="#/component/new?kind=shock">${ICON.plus} Shock</a>
      </div>
    </section>
    <section class="card">
      <h3>Quick launch (Galaxy)</h3>
      <p class="muted">Double-press the side button to open SagBook:</p>
      <p>Settings → Advanced features → Side button → <b>Double press</b> → turn on → <b>Open app</b> → <b>SagBook</b>.</p>
    </section>
    <section class="card">
      <h3>Appearance</h3>
      <div class="field"><span>Theme</span>${seg('setting', 'theme', s.theme, [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']])}</div>
    </section>
    <section class="card">
      <h3>Backup</h3>
      <p class="muted">Your data is stored only on this phone. Save a backup file now and then (e.g. to Google Drive) so a new phone can restore it.</p>
      <p class="muted">Last backup: ${s.lastBackup ? esc(fmtDate(s.lastBackup)) : 'never'}</p>
      <button type="button" class="btn block" data-action="export">Save backup file</button>
      <label class="btn block">Restore from backup file<input type="file" accept=".json,application/json" data-action="import" hidden></label>
      <p class="muted small" id="persist"></p>
    </section>
    <section class="card">
      <h3>About</h3>
      <p class="muted">SagBook version ${esc(APP_VERSION)}</p>
      <button type="button" class="btn block" data-action="check-update">Check for updates</button>
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
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0f1115' : '#f4f5f7';
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
  else if (view === 'entry') html = viewEntry(id);
  else if (view === 'settings') html = viewSettings();
  else html = viewMain();
  const main = !view || !['component', 'entry', 'settings'].includes(view);
  $app.classList.toggle('main-view', main && state.components.length > 0);
  $app.innerHTML = html;
  if (main) setupPager();
  if (view === 'settings') showPersistStatus();
}

let currentHash = location.hash;
window.addEventListener('hashchange', () => {
  if (dirty && !confirm('Discard unsaved changes?')) {
    history.pushState(null, '', currentHash || '#/');
    return;
  }
  dirty = false;
  draft = null;
  currentHash = location.hash;
  render();
  scrollTo(0, 0);
});

// Re-render the current screen, keeping the page and scroll position.
function rerenderKeepScroll() {
  const y = scrollY;
  const pageScroll = document.querySelector(`.page[data-comp="${state.settings.lastPage}"]`)?.scrollTop;
  const active = document.querySelector('.tab.on');
  if (active) state.settings.lastPage = state.components[[...document.querySelectorAll('.tab')].indexOf(active)]?.id ?? state.settings.lastPage;
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
  const dialOf = () => {
    const [cid, did] = el.closest('.dial').dataset.dial.split('|');
    const comp = compById(cid);
    return [comp, comp.dials.find((x) => x.id === did)];
  };
  if (action === 'goto-page') {
    const pager = document.getElementById('pager');
    pager.scrollTo({ left: +el.dataset.index * pager.clientWidth, behavior: 'smooth' });
  } else if (action === 'nudge') {
    const [comp, d] = dialOf();
    stepDial(comp, d, +el.dataset.dir);
  } else if (action === 'type-value') {
    const [comp, d] = dialOf();
    const input = prompt(`${d.name} (${fmt(d, d.min)}–${fmt(d, d.max)} ${unitOf(d)})`, fmt(d, current(comp, d)));
    const n = num(input);
    if (n == null) return;
    setPending(comp, d, +clamp(n, d.min, d.max).toFixed(4));
    refreshDial(comp, d);
    save();
  } else if (action === 'undo') {
    const comp = compById(el.dataset.id);
    delete state.pending[comp.id];
    await save();
    rerenderKeepScroll();
  } else if (action === 'save-changes') {
    saveChanges(compById(el.dataset.id));
  } else if (action === 'restore') {
    const e = entryById(el.dataset.id);
    const comp = compById(e.componentId);
    for (const d of comp.dials) if (e.snapshot?.[d.id] != null) setPending(comp, d, clamp(e.snapshot[d.id], d.min, d.max));
    state.settings.lastPage = comp.id;
    await save();
    toast(pendingCount(comp) ? 'Dials set back — set them on the bike, then Save' : 'Already set like this');
    location.hash = '#/';
  } else if (action === 'delete-entry') {
    if (!confirm('Delete this entry?')) return;
    state.entries = state.entries.filter((e) => e.id !== el.dataset.id);
    await save();
    toast('Entry deleted');
    location.hash = '#/';
  } else if (action === 'draft-set') {
    setPath(draft, el.dataset.key, el.dataset.value);
    dirty = true;
    rerenderKeepScroll();
  } else if (action === 'add-dial') {
    const preset = PRESETS[+el.dataset.preset];
    const d = preset ? newDial(preset[0], preset[1], preset[2]) : newDial('', 'clicks');
    if (d.type === 'psi') d.value = draft.kind === 'shock' ? 180 : 80;
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
    const e = entryById(t.dataset.entryNote);
    e.note = t.value;
    saveSoon();
  } else if (t.dataset.bind && draft) {
    const type = t.dataset.type;
    let v = t.value;
    if (type === 'num') v = num(v);
    setPath(draft, t.dataset.bind, v);
    dirty = true;
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.action === 'import' && t.files[0]) importData(t.files[0]);
  // Switching what a dial is measured in resets its range to sensible defaults.
  if (t.dataset.type === 'type' && draft) {
    const d = draft.dials[+t.dataset.bind.split('.')[1]];
    const def = TYPES[d.type];
    Object.assign(d, { min: def.min, max: def.max, step: def.step, value: clamp(d.value ?? def.min, def.min, def.max) });
    rerenderKeepScroll();
  }
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
    // Dial moves are already saved; only an open setup form can lose work.
    if (reloading || dirty) return;
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
