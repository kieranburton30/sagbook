// SagBook: suspension setup log. Plain JS, no build step.
// tools/update.ps1 rewrites APP_VERSION on every publish.
const APP_VERSION = '2026.10.06-0020';
const PSI_PER_BAR = 14.5038;
const PARTS = [['fork', 'Fork'], ['shock', 'Shock']];

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
const trim = (n, dp) => (n == null ? '' : String(+Number(n).toFixed(dp)));

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString(undefined, opts)} ${time}`;
}
const toLocalInput = (ts) => new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
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
    schema: 1,
    settings: { pressureUnit: 'psi', sagUnit: '%', theme: 'auto', lastBikeId: null, lastBackup: null },
    bikes: [],
    entries: [],
  };
}
function migrate(s) {
  const d = defaultState();
  s.settings = { ...d.settings, ...s.settings };
  s.bikes ||= [];
  s.entries ||= [];
  s.schema = 1;
  return s;
}

let state;
async function load() {
  let s = null;
  try { s = await idb('readonly', (st) => st.get(KEY)); } catch { /* fall back below */ }
  if (!s) { try { s = JSON.parse(localStorage.getItem(LS_KEY)); } catch { /* none */ } }
  state = migrate(s || defaultState());
}
async function save() {
  const json = JSON.stringify(state);
  try { localStorage.setItem(LS_KEY, json); } catch { /* quota; IndexedDB is primary */ }
  try { await idb('readwrite', (st) => st.put(JSON.parse(json), KEY)); }
  catch (e) { toast('Save failed: ' + e.message); }
}

/* ---------- domain ---------- */

const bikeById = (id) => state.bikes.find((b) => b.id === id);
const entryById = (id) => state.entries.find((e) => e.id === id);
const entriesFor = (bikeId) => state.entries.filter((e) => e.bikeId === bikeId).sort((a, b) => b.ts - a.ts);
const latest = (bikeId) => entriesFor(bikeId)[0] || null;
const previousOf = (entry) => entriesFor(entry.bikeId).find((e) => e.ts < entry.ts) || null;
const pUnit = () => state.settings.pressureUnit;
const sUnit = () => state.settings.sagUnit;

function adjuster(label) { return { id: uid(), label, max: null }; }
function defaultComponent() {
  return {
    name: '', spring: 'air', travel: null, tokens: true, targetSag: null,
    adjusters: [adjuster('Rebound'), adjuster('LSC'), adjuster('HSC')],
  };
}

// The values shown for a component, in display order.
function fields(comp) {
  const f = [];
  if (comp.spring === 'coil') f.push({ key: 'springRate', label: 'Spring', unit: 'lb', step: 25 });
  else f.push({ key: 'pressure', label: 'Pressure', unit: pUnit(), step: pUnit() === 'bar' ? 0.1 : 1 });
  if (comp.spring !== 'coil' && comp.tokens) f.push({ key: 'tokens', label: 'Spacers', unit: '', step: 1 });
  for (const a of comp.adjusters) f.push({ key: 'adj:' + a.id, label: a.label, unit: 'clicks', max: num(a.max), step: 1 });
  f.push({ key: 'sag', label: 'Sag', unit: sUnit() === '%' ? '%' : 'mm', step: 1 });
  return f;
}

// Sag is stored as {v, u} in whatever unit it was entered; show it in the
// preferred unit when travel/stroke allows the conversion.
function sagText(sag, comp) {
  if (!sag || sag.v == null) return '';
  const want = sUnit();
  if (sag.u === want) return trim(sag.v, 1);
  if (comp?.travel) return trim(want === '%' ? (sag.v / comp.travel) * 100 : (sag.v * comp.travel) / 100, 1);
  return `${trim(sag.v, 1)} ${sag.u}`;
}

// A setup value as a display string in the current units ('' when unset).
function display(setup, key, comp) {
  if (!setup) return '';
  if (key === 'pressure') return setup.pressure == null ? '' : pUnit() === 'bar' ? trim(setup.pressure / PSI_PER_BAR, 2) : trim(setup.pressure, 1);
  if (key === 'sag') return sagText(setup.sag, comp);
  if (key.startsWith('adj:')) { const v = setup.adj?.[key.slice(4)]; return v == null ? '' : trim(v, 2); }
  return setup[key] == null ? '' : trim(setup[key], 2);
}
const unitFor = (f, text) => (f.unit === 'clicks' || /[a-z%]$/i.test(text) ? '' : f.unit);

function diffLines(prev, cur, bike) {
  const out = [];
  for (const [part, name] of PARTS) {
    const comp = bike[part];
    if (!comp) continue;
    for (const f of fields(comp)) {
      const a = display(prev?.[part], f.key, comp);
      const b = display(cur?.[part], f.key, comp);
      if (a !== b) out.push({ part: name, key: f.key, label: f.label, from: a || '–', to: b || '–', unit: unitFor(f, b) });
    }
  }
  return out;
}

/* ---------- icons ---------- */

const svg = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1z"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  chevron: svg('<path d="M9 18l6-6-6-6"/>'),
};

const header = (title, left = '', right = '<span class="icon-btn"></span>') =>
  `<header class="top">${left || '<span class="icon-btn"></span>'}<h1>${title}</h1>${right}</header>`;
const backBtn = (href = '#/') => `<a class="icon-btn" href="${href}" aria-label="Back">${ICON.back}</a>`;
const seg = (action, key, value, options) => `<div class="seg">${options.map(([v, label]) =>
  `<button type="button" class="${v === value ? 'on' : ''}" data-action="${action}" data-key="${key}" data-value="${v}">${label}</button>`).join('')}</div>`;

/* ---------- install ---------- */

let installPrompt = null;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isPhone = () => /Android|iPhone|iPad/i.test(navigator.userAgent);
const installHidden = () => { try { return localStorage.getItem('sagbook-hide-install') === '1'; } catch { return false; } };

// Explains how to install from whichever browser the page was opened in.
function installSteps() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/i.test(ua)) return 'In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>.';
  if (/; wv\)|FBAN|FBAV|Instagram|GSA\//i.test(ua)) {
    return 'This page is open inside another app, which can\'t install apps. Tap <b>⋮</b> → <b>Open in Chrome</b>, then come back to this card.';
  }
  if (/SamsungBrowser/i.test(ua)) {
    return 'Open this page in <b>Chrome</b> instead of Samsung Internet (copy the address into Chrome). Chrome installs SagBook as a proper app, which is needed for quick launch.';
  }
  if (/Android/i.test(ua)) return 'Tap <b>⋮</b> (top right of Chrome) → <b>Add to Home screen</b> → <b>Install</b>.';
  return 'Click the <b>install icon</b> at the right end of the address bar in Chrome or Edge.';
}

function installCard(compact) {
  if (isInstalled()) return '';
  if (compact && installHidden()) return '';
  return `<section class="card install">
    <div class="install-head"><img src="icons/icon-192.png" alt="" width="44" height="44">
      <div><h3>Install SagBook</h3><p class="muted">Home-screen icon, opens instantly, works offline.</p></div>
      ${compact ? '<button type="button" class="icon-btn subtle" data-action="hide-install" aria-label="Hide">✕</button>' : ''}
    </div>
    ${installPrompt
      ? '<button type="button" class="btn primary block" data-action="install">Install app</button>'
      : `<p class="steps">${installSteps()}</p>`}
    ${!isPhone() && !compact ? `<div class="qr"><img src="icons/qr.svg" alt="QR code for the SagBook link" width="160" height="160">
      <p class="muted">Scan with your phone's camera to open SagBook there.</p></div>` : ''}
  </section>`;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (!dirty && state) rerenderKeepScroll();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('SagBook installed — open it from your home screen');
  if (!dirty && state) rerenderKeepScroll();
});

/* ---------- view: home ---------- */

function viewHome() {
  if (!state.bikes.length) {
    return `${header('SagBook', '', `<a class="icon-btn" href="#/settings" aria-label="Settings">${ICON.gear}</a>`)}
    ${installCard(true)}
    <main class="empty">
      <h2>No bikes yet</h2>
      <p class="muted">Add a bike with its fork and shock, then log every setup change.</p>
      <a class="btn primary big" href="#/bike/new">Add a bike</a>
    </main>`;
  }
  const bike = bikeById(state.settings.lastBikeId) || state.bikes[0];
  const list = entriesFor(bike.id);
  const cur = list[0];
  const backupDue = list.length && (!state.settings.lastBackup || Date.now() - state.settings.lastBackup > 30 * 864e5);
  const chips = state.bikes.length > 1
    ? `<nav class="chips">${state.bikes.map((b) => `<button class="chip ${b.id === bike.id ? 'on' : ''}" data-action="pick-bike" data-id="${b.id}">${esc(b.name)}</button>`).join('')}</nav>`
    : '';
  return `${header('SagBook', '', `<a class="icon-btn" href="#/settings" aria-label="Settings">${ICON.gear}</a>`)}
  ${chips}
  <main>
    ${installCard(true)}
    <div class="bike-title"><h2>${esc(bike.name)}</h2><a class="link" href="#/bike/${bike.id}">${ICON.edit} Edit</a></div>
    ${PARTS.map(([part, label]) => (bike[part] ? setupCard(bike, part, label, cur?.[part]) : '')).join('')}
    ${!bike.fork && !bike.shock ? `<p class="muted pad">No fork or shock set up yet. <a class="link" href="#/bike/${bike.id}">Edit bike</a></p>` : ''}
    <h2 class="section">History</h2>
    ${list.length
      ? `<ul class="history">${list.map((e, i) => historyItem(e, list[i + 1], bike)).join('')}</ul>`
      : '<p class="muted pad">Nothing logged yet. Tap <b>Log change</b> to record your current setup.</p>'}
    ${backupDue ? '<a class="banner" href="#/settings">Back up your data — it only lives on this phone. Tap to back up.</a>' : ''}
  </main>
  <div class="dock"><a class="btn primary big block" href="#/log/${bike.id}">${ICON.plus} Log change</a></div>`;
}

function setupCard(bike, part, label, setup, changedKeys) {
  const comp = bike[part];
  const cells = fields(comp).map((f) => {
    const v = display(setup, f.key, comp);
    const unit = v ? unitFor(f, v) : '';
    let sub = '';
    if (f.max != null) sub = `of ${trim(f.max, 2)}`;
    if (f.key === 'sag' && comp.targetSag?.v != null) {
      const t = sagText(comp.targetSag, comp);
      sub = `target ${t}${unitFor(f, t) === '%' ? '%' : unitFor(f, t) ? ` ${unitFor(f, t)}` : ''}`;
    }
    return `<div class="cell ${changedKeys?.has(f.key) ? 'changed' : ''}">
      <span class="k">${esc(f.label)}</span>
      <span class="v">${v ? esc(v) : '–'}${unit ? `<small>${esc(unit)}</small>` : ''}</span>
      ${sub ? `<span class="s">${esc(sub)}</span>` : ''}
    </div>`;
  }).join('');
  return `<section class="card">
    <div class="card-head"><h3>${label}</h3><span class="muted">${esc(comp.name)}</span></div>
    <div class="grid">${cells}</div>
  </section>`;
}

function historyItem(e, prev, bike) {
  const d = diffLines(prev, e, bike);
  const body = !prev
    ? '<span class="muted">Starting setup</span>'
    : d.length
      ? d.map((x) => `<span class="chg"><i>${x.part}</i>${esc(x.label)} ${esc(x.from)} → <b>${esc(x.to)}</b>${x.unit ? ` ${esc(x.unit)}` : ''}</span>`).join('')
      : '<span class="muted">No setting changes</span>';
  const note = [e.location, e.notes].filter(Boolean).join(' — ');
  return `<li><a class="hist" href="#/entry/${e.id}">
    <div class="hist-top"><time>${fmtDate(e.ts)}</time>
      ${e.baseline ? '<span class="badge">Baseline</span>' : ''}
      ${e.rating ? `<span class="stars">${'★'.repeat(e.rating)}</span>` : ''}
    </div>
    <div class="chgs">${body}</div>
    ${note ? `<div class="note">${esc(note)}</div>` : ''}
  </a></li>`;
}

/* ---------- view: log / edit entry ---------- */

let form = null;
let dirty = false;

function startForm(bikeId, { editId, fromId } = {}) {
  const bike = bikeById(bikeId);
  if (!bike) return false;
  const editing = editId ? entryById(editId) : null;
  const restoring = fromId ? entryById(fromId) : null;
  const src = editing || restoring || latest(bikeId);
  const ref = editing ? previousOf(editing) : latest(bikeId);
  form = {
    bikeId, editId, fromId, src,
    vals: {}, init: {}, refVals: {},
    location: editing?.location || '',
    notes: editing?.notes || '',
    rating: editing?.rating || 0,
    baseline: editing?.baseline || false,
    ts: editing?.ts || Date.now(),
  };
  form.when = form.whenInit = toLocalInput(form.ts);
  for (const [part] of PARTS) {
    const comp = bike[part];
    if (!comp) continue;
    form.vals[part] = {}; form.init[part] = {}; form.refVals[part] = {};
    for (const f of fields(comp)) {
      form.vals[part][f.key] = form.init[part][f.key] = display(src?.[part], f.key, comp);
      form.refVals[part][f.key] = display(ref?.[part], f.key, comp);
    }
  }
  dirty = !!restoring;
  return true;
}

function viewLog() {
  const bike = bikeById(form.bikeId);
  const restoring = form.fromId ? entryById(form.fromId) : null;
  const stars = [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" class="star ${n <= form.rating ? 'on' : ''}" data-action="rate" data-value="${n}" aria-label="${n} stars">★</button>`).join('');
  return `${header(form.editId ? 'Edit entry' : 'Log change', backBtn(form.editId ? `#/entry/${form.editId}` : '#/'))}
  <div class="sub">${esc(bike.name)}${restoring ? ` · restoring ${esc(fmtDate(restoring.ts))}` : ''}</div>
  <main class="form">
    ${PARTS.map(([part, label]) => (bike[part] ? `<section class="card">
      <div class="card-head"><h3>${label}</h3><span class="muted">${esc(bike[part].name)}</span></div>
      ${fields(bike[part]).map((f) => stepperRow(part, f)).join('')}
    </section>` : '')).join('')}
    <section class="card">
      <label class="field"><span>Trail / location</span>
        <input data-meta="location" value="${esc(form.location)}" placeholder="e.g. Local black run" autocomplete="off"></label>
      <div class="field"><span>How did it feel?</span><div class="rating">${stars}</div></div>
      <label class="field"><span>Notes</span>
        <textarea data-meta="notes" rows="3" placeholder="e.g. Bottoming on drops, harsh over roots…">${esc(form.notes)}</textarea></label>
      <label class="check"><input type="checkbox" data-meta="baseline" ${form.baseline ? 'checked' : ''}> Mark as baseline (known-good setup)</label>
      <label class="field"><span>Date &amp; time</span>
        <input type="datetime-local" data-meta="when" value="${form.when}"></label>
    </section>
    ${form.editId ? '<button type="button" class="btn danger block" data-action="delete-entry">Delete entry</button>' : ''}
  </main>
  <div class="dock"><button type="button" class="btn primary big block" data-action="save-entry">Save</button></div>`;
}

function rowHint(part, f) {
  const v = form.vals[part][f.key];
  const was = form.refVals[part][f.key];
  if (v !== was) return { changed: true, text: `was ${was || '–'}` };
  return { changed: false, text: f.max != null ? `0–${trim(f.max, 2)}` : f.unit === 'clicks' ? 'clicks' : f.unit };
}

function stepperRow(part, f) {
  const hint = rowHint(part, f);
  return `<div class="row ${hint.changed ? 'changed' : ''}" data-row="${part}|${f.key}">
    <div class="row-label"><span>${esc(f.label)}</span><small>${esc(hint.text)}</small></div>
    <div class="stepper">
      <button type="button" class="step" data-action="step" data-dir="-1" aria-label="Decrease ${esc(f.label)}">−</button>
      <input inputmode="decimal" autocomplete="off" data-field="${part}|${f.key}" value="${esc(form.vals[part][f.key])}" placeholder="–" aria-label="${esc(f.label)}">
      <button type="button" class="step" data-action="step" data-dir="1" aria-label="Increase ${esc(f.label)}">+</button>
    </div>
  </div>`;
}

function fieldDef(part, key) {
  return fields(bikeById(form.bikeId)[part]).find((f) => f.key === key);
}

function refreshRow(part, key) {
  const row = $app.querySelector(`[data-row="${part}|${key}"]`);
  if (!row) return;
  const hint = rowHint(part, fieldDef(part, key));
  row.classList.toggle('changed', hint.changed);
  row.querySelector('small').textContent = hint.text;
}

function stepField(part, key, dir) {
  const f = fieldDef(part, key);
  let n = (num(form.vals[part][key]) ?? 0) + dir * f.step;
  n = Math.max(0, n);
  if (f.max != null) n = Math.min(f.max, n);
  form.vals[part][key] = trim(n, 2);
  $app.querySelector(`[data-field="${part}|${key}"]`).value = form.vals[part][key];
  dirty = true;
  refreshRow(part, key);
}

// Fields left untouched copy the source value exactly, so unit conversions
// never drift a stored number.
function formToSetup(part, comp) {
  const vals = form.vals[part], init = form.init[part], src = form.src?.[part] || null;
  const keep = (k) => src && vals[k] === init[k];
  const s = { adj: {} };
  for (const { key } of fields(comp)) {
    if (key.startsWith('adj:')) {
      const id = key.slice(4);
      s.adj[id] = keep(key) ? src.adj?.[id] ?? null : num(vals[key]);
    } else if (key === 'pressure') {
      const n = num(vals[key]);
      s.pressure = keep(key) ? src.pressure ?? null : n == null ? null : pUnit() === 'bar' ? n * PSI_PER_BAR : n;
    } else if (key === 'sag') {
      const n = num(vals[key]);
      s.sag = keep(key) ? src.sag ?? null : n == null ? null : { v: n, u: sUnit() };
    } else {
      s[key] = keep(key) ? src[key] ?? null : num(vals[key]);
    }
  }
  return s;
}

async function saveEntry() {
  const bike = bikeById(form.bikeId);
  const existing = form.editId ? entryById(form.editId) : null;
  const entry = existing || { id: uid(), bikeId: bike.id };
  for (const [part] of PARTS) entry[part] = bike[part] ? formToSetup(part, bike[part]) : null;
  // The picker only has minute precision, so keep the exact time unless it was changed.
  entry.ts = form.when === form.whenInit ? (existing ? form.ts : Date.now()) : new Date(form.when).getTime() || Date.now();
  entry.location = form.location.trim();
  entry.notes = form.notes.trim();
  entry.rating = form.rating || 0;
  entry.baseline = form.baseline;
  if (!existing) state.entries.push(entry);
  state.settings.lastBikeId = bike.id;
  await save();
  dirty = false;
  toast('Saved');
  if (pendingReload) { location.replace('#/'); location.reload(); return; }
  location.hash = existing ? `#/entry/${entry.id}` : '#/';
}

/* ---------- view: entry detail ---------- */

function viewEntry(id) {
  const e = entryById(id);
  if (!e) return viewMissing();
  const bike = bikeById(e.bikeId);
  const prev = previousOf(e);
  const d = diffLines(prev, e, bike);
  const changed = (part) => new Set(prev ? d.filter((x) => x.part.toLowerCase() === part).map((x) => x.key) : []);
  return `${header(fmtDate(e.ts), backBtn(), `<a class="icon-btn" href="#/edit/${e.id}" aria-label="Edit">${ICON.edit}</a>`)}
  <div class="sub">${esc(bike.name)}${e.baseline ? ' · <span class="badge">Baseline</span>' : ''}${e.rating ? ` · <span class="stars">${'★'.repeat(e.rating)}</span>` : ''}</div>
  <main>
    ${e.location || e.notes ? `<section class="card notes">${e.location ? `<p><b>${esc(e.location)}</b></p>` : ''}${e.notes ? `<p>${esc(e.notes)}</p>` : ''}</section>` : ''}
    ${prev ? `<p class="muted pad">${d.length ? `${d.length} change${d.length > 1 ? 's' : ''} from ${esc(fmtDate(prev.ts))} (highlighted)` : 'No setting changes from the previous entry'}</p>` : '<p class="muted pad">Starting setup</p>'}
    ${PARTS.map(([part, label]) => (bike[part] ? setupCard(bike, part, label, e[part], changed(part)) : '')).join('')}
    <div class="actions">
      <a class="btn block" href="#/log/${bike.id}?from=${e.id}">Restore this setup</a>
      <button type="button" class="btn block" data-action="toggle-baseline" data-id="${e.id}">${e.baseline ? 'Remove baseline mark' : 'Mark as baseline'}</button>
    </div>
  </main>`;
}

/* ---------- view: bike editor ---------- */

let draft = null;
const PRESETS = ['Rebound', 'LSR', 'HSR', 'LSC', 'HSC', 'Lockout', 'Preload'];

function startDraft(id) {
  if (id === 'new') {
    draft = { id: uid(), name: '', fork: defaultComponent(), shock: defaultComponent(), _new: true, _stash: {} };
    return true;
  }
  const bike = bikeById(id);
  if (!bike) return false;
  draft = { ...structuredClone(bike), _stash: {} };
  return true;
}

function viewBike() {
  const parts = PARTS.map(([part, label]) => {
    const c = draft[part];
    const p = part;
    const body = !c ? '' : `
      <label class="field"><span>Make &amp; model</span>
        <input data-bind="${p}.name" value="${esc(c.name)}" placeholder="${part === 'fork' ? 'e.g. RockShox Lyrik Ultimate' : 'e.g. Fox Float X2'}" autocomplete="off"></label>
      <div class="field"><span>Spring</span>${seg('draft-set', `${p}.spring`, c.spring, [['air', 'Air'], ['coil', 'Coil']])}</div>
      <div class="two">
        <label class="field"><span>${part === 'fork' ? 'Travel' : 'Stroke'} (mm)</span>
          <input inputmode="decimal" data-bind="${p}.travel" data-type="num" value="${esc(c.travel ?? '')}" placeholder="${part === 'fork' ? '160' : '62.5'}"></label>
        <label class="field"><span>Target sag (${sUnit()})</span>
          <input inputmode="decimal" data-bind="${p}.targetSag" data-type="sag" value="${esc(sagText(c.targetSag, c))}" placeholder="${sUnit() === '%' ? (part === 'fork' ? '20' : '30') : ''}"></label>
      </div>
      ${c.spring === 'air' ? `<label class="check"><input type="checkbox" data-bind="${p}.tokens" data-type="bool" ${c.tokens ? 'checked' : ''}> Track volume spacers / tokens</label>` : ''}
      <div class="field"><span>Adjusters <em class="muted">(clicks counted from fully closed)</em></span>
        ${c.adjusters.map((a, i) => `<div class="adj">
          <input data-bind="${p}.adjusters.${i}.label" value="${esc(a.label)}" placeholder="Name" autocomplete="off">
          <input inputmode="numeric" data-bind="${p}.adjusters.${i}.max" data-type="num" value="${esc(a.max ?? '')}" placeholder="Max">
          <button type="button" class="icon-btn subtle" data-action="del-adj" data-part="${p}" data-index="${i}" aria-label="Remove ${esc(a.label)}">✕</button>
        </div>`).join('')}
        <div class="chips wrap">
          ${PRESETS.filter((n) => !c.adjusters.some((a) => a.label === n)).map((n) =>
            `<button type="button" class="chip" data-action="add-adj" data-part="${p}" data-label="${n}">+ ${n}</button>`).join('')}
          <button type="button" class="chip" data-action="add-adj" data-part="${p}" data-label="">+ Custom</button>
        </div>
      </div>`;
    return `<section class="card">
      <label class="card-head toggle"><h3>${label}</h3>
        <input type="checkbox" class="switch" data-action="toggle-part" data-part="${p}" ${c ? 'checked' : ''} aria-label="Has ${label.toLowerCase()}"></label>
      ${body}
    </section>`;
  }).join('');
  return `${header(draft._new ? 'New bike' : 'Edit bike', backBtn(draft._new ? '#/settings' : '#/'))}
  <main class="form">
    <section class="card">
      <label class="field"><span>Bike name</span>
        <input data-bind="name" value="${esc(draft.name)}" placeholder="e.g. Enduro bike" autocomplete="off"></label>
    </section>
    ${parts}
    ${draft._new ? '' : '<button type="button" class="btn danger block" data-action="delete-bike">Delete bike</button>'}
  </main>
  <div class="dock"><button type="button" class="btn primary big block" data-action="save-bike">Save bike</button></div>`;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
}

async function saveBike() {
  const name = draft.name.trim();
  if (!name) { toast('Give the bike a name'); $app.querySelector('[data-bind="name"]').focus(); return; }
  const { _new, _stash, ...bike } = draft;
  bike.name = name;
  for (const [part] of PARTS) {
    if (!bike[part]) continue;
    bike[part].name = bike[part].name.trim();
    bike[part].adjusters = bike[part].adjusters
      .map((a) => ({ ...a, label: a.label.trim() }))
      .filter((a) => a.label);
  }
  const i = state.bikes.findIndex((b) => b.id === bike.id);
  if (i >= 0) state.bikes[i] = bike; else state.bikes.push(bike);
  state.settings.lastBikeId = bike.id;
  await save();
  dirty = false;
  toast('Bike saved');
  location.hash = '#/';
}

/* ---------- view: settings ---------- */

function viewSettings() {
  const s = state.settings;
  return `${header('Settings', backBtn())}
  <main>
    ${installCard(false)}
    <section class="card">
      <h3>Quick launch</h3>
      <p class="muted">Open SagBook from anywhere with a double-press, no hunting for the icon. Install the app first, then:</p>
      <ul class="tips">
        <li><b>Samsung:</b> Settings → Advanced features → Side button → <b>Double press</b> → Open app → <b>SagBook</b>.</li>
        <li><b>Pixel:</b> Settings → System → Gestures → <b>Quick Tap</b> → Open app → <b>SagBook</b>, then double-tap the back of the phone.</li>
        <li><b>Any phone:</b> long-press the SagBook icon → drag <b>Log change</b> onto your home screen for a one-tap shortcut.</li>
      </ul>
    </section>
    <section class="card">
      <h3>Units</h3>
      <div class="field"><span>Air pressure</span>${seg('setting', 'pressureUnit', s.pressureUnit, [['psi', 'psi'], ['bar', 'bar']])}</div>
      <div class="field"><span>Sag</span>${seg('setting', 'sagUnit', s.sagUnit, [['%', '%'], ['mm', 'mm']])}</div>
      <div class="field"><span>Theme</span>${seg('setting', 'theme', s.theme, [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']])}</div>
    </section>
    <section class="card">
      <h3>Bikes</h3>
      ${state.bikes.map((b) => `<a class="list-item" href="#/bike/${b.id}">
        <span><b>${esc(b.name)}</b><small>${esc([b.fork?.name, b.shock?.name].filter(Boolean).join(' · ') || 'No components')}</small></span>${ICON.chevron}</a>`).join('')}
      <a class="btn block" href="#/bike/new">${ICON.plus} Add bike</a>
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
  render();
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.bikes) || !Array.isArray(data.entries)) throw new Error('Not a SagBook backup');
    if (!confirm(`Replace everything on this phone with this backup (${data.bikes.length} bikes, ${data.entries.length} entries)?`)) return;
    state = migrate(data);
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
  // "#/log" on its own (the home-screen shortcut) logs for the last-used bike.
  if (view === 'log' && !id) {
    const bike = bikeById(state.settings.lastBikeId) || state.bikes[0];
    location.replace(bike ? `#/log/${bike.id}` : '#/');
    return;
  }
  let html;
  if (view === 'log') html = form && form.bikeId === id && !form.editId ? viewLog() : startForm(id, { fromId: params.get('from') }) ? viewLog() : viewMissing();
  else if (view === 'edit') html = form && form.editId === id ? viewLog() : (entryById(id) && startForm(entryById(id).bikeId, { editId: id })) ? viewLog() : viewMissing();
  else if (view === 'entry') html = viewEntry(id);
  else if (view === 'bike') html = draft && (draft.id === id || (id === 'new' && draft._new)) ? viewBike() : startDraft(id) ? viewBike() : viewMissing();
  else if (view === 'settings') html = viewSettings();
  else html = viewHome();
  $app.innerHTML = html;
  if (view === 'settings') showPersistStatus();
}

let currentHash = location.hash;
window.addEventListener('hashchange', () => {
  if (dirty && !confirm('Discard unsaved changes?')) {
    history.pushState(null, '', currentHash || '#/');
    return;
  }
  dirty = false;
  form = null;
  draft = null;
  currentHash = location.hash;
  render();
  scrollTo(0, 0);
});

/* ---------- events ---------- */

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.dataset.action === 'import' || el.dataset.action === 'toggle-part') return;
  const { action } = el.dataset;
  if (action === 'pick-bike') {
    state.settings.lastBikeId = el.dataset.id;
    render();
    save();
  } else if (action === 'step') {
    const [part, key] = el.closest('.row').dataset.row.split('|');
    stepField(part, key, +el.dataset.dir);
  } else if (action === 'rate') {
    const n = +el.dataset.value;
    form.rating = form.rating === n ? 0 : n;
    dirty = true;
    $app.querySelectorAll('.star').forEach((s) => s.classList.toggle('on', +s.dataset.value <= form.rating));
  } else if (action === 'save-entry') {
    saveEntry();
  } else if (action === 'delete-entry') {
    if (!confirm('Delete this entry?')) return;
    state.entries = state.entries.filter((e) => e.id !== form.editId);
    await save();
    dirty = false;
    toast('Entry deleted');
    location.hash = '#/';
  } else if (action === 'toggle-baseline') {
    const e = entryById(el.dataset.id);
    e.baseline = !e.baseline;
    await save();
    render();
  } else if (action === 'draft-set') {
    setPath(draft, el.dataset.key, el.dataset.value);
    dirty = true;
    rerenderKeepScroll();
  } else if (action === 'add-adj') {
    draft[el.dataset.part].adjusters.push(adjuster(el.dataset.label));
    dirty = true;
    rerenderKeepScroll();
    if (!el.dataset.label) [...$app.querySelectorAll(`[data-bind^="${el.dataset.part}.adjusters."][data-bind$=".label"]`)].at(-1)?.focus();
  } else if (action === 'del-adj') {
    draft[el.dataset.part].adjusters.splice(+el.dataset.index, 1);
    dirty = true;
    rerenderKeepScroll();
  } else if (action === 'save-bike') {
    saveBike();
  } else if (action === 'delete-bike') {
    const n = state.entries.filter((e) => e.bikeId === draft.id).length;
    if (!confirm(`Delete ${draft.name || 'this bike'} and its ${n} logged entr${n === 1 ? 'y' : 'ies'}? This can't be undone.`)) return;
    state.bikes = state.bikes.filter((b) => b.id !== draft.id);
    state.entries = state.entries.filter((e) => e.bikeId !== draft.id);
    if (state.settings.lastBikeId === draft.id) state.settings.lastBikeId = null;
    await save();
    dirty = false;
    toast('Bike deleted');
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
  } else if (action === 'hide-install') {
    try { localStorage.setItem('sagbook-hide-install', '1'); } catch { /* ignore */ }
    toast('Install instructions are still in Settings');
    rerenderKeepScroll();
  }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.field) {
    const [part, key] = t.dataset.field.split('|');
    form.vals[part][key] = t.value.trim();
    dirty = true;
    refreshRow(part, key);
  } else if (t.dataset.meta) {
    form[t.dataset.meta] = t.type === 'checkbox' ? t.checked : t.value;
    dirty = true;
  } else if (t.dataset.bind && draft) {
    const type = t.dataset.type;
    let v = t.value;
    if (type === 'num') v = num(v);
    else if (type === 'bool') v = t.checked;
    else if (type === 'sag') v = num(v) == null ? null : { v: num(v), u: sUnit() };
    setPath(draft, t.dataset.bind, v);
    dirty = true;
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.action === 'import' && t.files[0]) importData(t.files[0]);
  if (t.dataset.action === 'toggle-part') {
    const p = t.dataset.part;
    if (t.checked) draft[p] = draft._stash[p] || defaultComponent();
    else { draft._stash[p] = draft[p]; draft[p] = null; }
    dirty = true;
    rerenderKeepScroll();
  }
});

// Tapping a number selects it, so typing replaces the value.
document.addEventListener('focusin', (ev) => {
  if (ev.target.dataset?.field) ev.target.select();
});

function rerenderKeepScroll() {
  const y = scrollY;
  render();
  scrollTo(0, y);
}

/* ---------- persistence + updates ---------- */

async function showPersistStatus() {
  const el = document.getElementById('persist');
  if (!el || !navigator.storage?.persisted) return;
  const ok = await navigator.storage.persisted();
  el.textContent = ok ? 'Storage is protected from automatic clearing.' : 'Tip: install SagBook to your home screen so Android keeps its data safe.';
}

let swReg = null;
let pendingReload = false;

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
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (reloading) return;
    if (dirty) { pendingReload = true; toast('Update ready — it applies after you save'); return; }
    reloading = true;
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
  if (sessionStorage.getItem('sagbook-updated')) {
    sessionStorage.removeItem('sagbook-updated');
    toast(`Updated to ${APP_VERSION}`);
  }
  navigator.storage?.persist?.().catch(() => {});
  registerSW().catch(() => {});
})();
