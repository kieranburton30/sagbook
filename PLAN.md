# Suspension Log — Project Plan

A fast, simple phone app for logging mountain-bike suspension setup changes
(air pressure, volume spacers, compression, rebound, sag) across multiple bikes,
and seeing what you changed, when, and how it rode.

---

## 1. Goals

- **Instant.** Opens in under a second, works with no signal (trailheads, uplifts).
- **Low friction.** Logging a change after a run should take ~10 seconds:
  "copy last setup → tweak one value → save".
- **Multiple bikes**, each with its own fork and shock.
- **History.** See every setup change over time and what changed from the last one.
- **Easy to update.** New features pushed from the PC with no fuss.
- **Data is safe.** Backups you control; no account needed.

### Not goals (for v1)
- Accounts, cloud login, social features, Strava integration.
- Tuning advice or calculators (could come later).

---

## 2. Key questions answered

### How hard is it to make an Android app?

| Approach | Difficulty | Speed on phone | How updates reach the phone |
|---|---|---|---|
| **A. Progressive Web App (PWA)** — a website that installs to your home screen and works offline | **Easy** | Native-like for an app this simple | **Automatic.** Push from PC → phone picks it up next open |
| B. Native Android (Kotlin + Jetpack Compose) | Medium. Needs Android Studio (~10 GB), Gradle, signing keys | Fastest possible | Build APK → install on phone (USB, or auto via GitHub Releases + Obtainium) |
| C. PWA wrapped as an APK (Capacitor / TWA) | Medium | Same as A | Mostly automatic, plus occasional APK rebuild |

Native Android is very doable with Claude writing the code, but the toolchain
and the update/install loop are the annoying parts — not the code itself.

### How hard is it to keep updating it from the computer?

- **PWA:** trivial. Edit code on the PC → `git push` → GitHub Pages (or Netlify)
  redeploys → phone gets the new version the next time the app opens. No
  reinstalling, no USB, no Play Store.
- **Native:** possible but more steps every time (build → sign → install). Can be
  automated with GitHub Actions + the Obtainium app, but it's more moving parts.

### Recommendation

**Build it as a PWA (Option A).** It hits every requirement — offline, fast, home
screen icon, full-screen, no lag — and makes "update from the computer" free.
If you later want a real APK (e.g. for the Play Store), the same code can be
wrapped with Capacitor without a rewrite (Phase 5).

---

## 3. Tech stack (PWA)

- **Plain HTML + CSS + TypeScript, built with Vite.** No heavy framework →
  tiny bundle, near-instant load. (Preact is an option if the UI grows.)
- **IndexedDB** (via the small `idb` library) for on-device storage.
- **Service worker** (`vite-plugin-pwa`) for offline + auto-update.
- **`navigator.storage.persist()`** so Android doesn't evict the data.
- **Hosting:** GitHub Pages (free, deploys on push via GitHub Actions).
- **Backup:** JSON export/import (share to Google Drive / email), plus an
  optional Phase 4 sync to the PC.

---

## 4. Data model

```
Bike
  id, name ("Enduro bike"), notes, archived

Component            (each bike has 1–2: fork, shock)
  id, bikeId, type: "fork" | "shock"
  make, model ("RockShox Super Deluxe"), travel/stroke
  adjusters: which knobs this unit actually has, and their ranges
     e.g. { HSC: 0–4 clicks, LSC: 0–12, HSR: 0–8, LSR: 0–14 }
  springType: "air" | "coil"

SetupEntry           (one row per change — the core of the app)
  id, componentId, timestamp
  pressure (psi)  or  springRate (lb/in)
  volumeSpacers (tokens/bands count)
  HSC, LSC, HSR, LSR (clicks, counted from fully closed)
  sag (% or mm)
  notes, trail/location, rating (1–5 "how it felt")
  isBaseline (flag a known-good setup)
```

Clicks are always stored as "clicks from closed" so values are comparable.
Each component defines which adjusters exist, so a fork with only LSC + rebound
doesn't show HSC fields.

---

## 5. Screens

1. **Home / Bike picker** — big cards for each bike, last-used bike opens by
   default. Shows current fork + shock setup at a glance.
2. **Bike view** — two panels (Fork, Shock) showing the current values large and
   readable. Big **"Log change"** button on each.
3. **Log change** — pre-filled with the current setup. +/- steppers for clicks and
   psi (big thumb-friendly buttons, works with gloves-off, one hand). Changed
   fields highlighted. Optional notes/rating. Save.
4. **History** — timeline of entries, each showing only what changed
   (e.g. `Shock: 185 → 180 psi, LSR 8 → 6`). Tap to view full setup or
   "Restore this setup".
5. **Bike/component settings** — add/edit bikes, components, adjuster ranges.
6. **Backup** — export/import JSON, last backup date.

Design: dark theme by default (readable outside), large type, no animations
that cost time.

---

## 6. Build phases

### Phase 0 — Setup (~30 min)
- Create Vite + TypeScript project in this folder, init git, GitHub repo.
- GitHub Actions workflow to deploy to GitHub Pages on push.
- Confirm a "hello world" installs to the phone home screen.

### Phase 1 — MVP (~1 evening)
- Bikes + components CRUD.
- Log change screen with steppers, pre-filled from last entry.
- Current setup display per bike.
- IndexedDB storage + persistent storage request.
- Offline service worker, manifest, app icon.

### Phase 2 — History & usability
- History timeline with diffs vs previous entry.
- "Restore this setup" and "Mark as baseline".
- Notes, trail, rating.
- Remember last-used bike.

### Phase 3 — Data safety
- Export/import JSON (Android share sheet).
- Reminder banner if no backup in 30 days.

### Phase 4 — PC sync (optional)
Pick one if wanted:
- **Simple:** export JSON → it lands in Google Drive → view on PC.
- **Better:** small free backend (e.g. Supabase or a Cloudflare Worker + KV)
  so the phone syncs automatically and a desktop view shows charts.
- Desktop page: charts of pressure/clicks over time per component.

### Phase 5 — Native wrapper (optional)
- Wrap with Capacitor → APK, if a "real" app or Play Store listing is wanted.
  Play Store has a one-off $25 developer fee.

---

## 7. Update workflow (day to day)

```
On PC:  edit code (with Claude) → test locally (npm run dev, open on phone via LAN)
        → git push
GitHub: Actions builds + deploys to Pages (~1 min)
Phone:  open app → service worker sees new version → "Update available, tap to
        reload" toast → done. Data is untouched.
```

Data lives on the phone in IndexedDB and survives every update. Schema changes
are handled with versioned IndexedDB migrations.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Phone clears browser storage | `storage.persist()`, installed PWAs are rarely evicted, plus JSON backups |
| Losing / replacing the phone | Export backup; Phase 4 sync |
| Update breaks data | Versioned DB migrations; auto-export before migrating |
| App feels sluggish | No framework, tiny bundle, everything local — no network calls |

---

## 9. Decisions (made 2026-10-05)

1. **PWA**, plain HTML/CSS/JS with no build step (even simpler than the Vite
   setup in section 3; nothing to install, nothing to break).
2. **Name: SagBook.** Repo `kieranburton30/sagbook`, hosted on GitHub Pages
   at https://kieranburton30.github.io/sagbook/.
3. Bikes, forks/shocks and their adjusters are set up **inside the app**.
4. psi/bar, sag %/mm and theme are **in-app settings**.
5. **JSON backup file for now**; PC sync (Phase 4) can be added later.
6. Updating from the PC is one double-click: `Update SagBook.cmd`.

---

## 10. Folder layout

```
Suspension Log/
  PLAN.md            ← this file
  src/               ← app code
  public/            ← icons, manifest
  .github/workflows/ ← deploy to GitHub Pages
  outputs/           ← any generated deliverables
  tmp/               ← scratch files (cleaned up)
```
