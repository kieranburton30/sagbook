# SagBook

A fast, offline phone app for tracking mountain-bike suspension dials. Each
fork and shock gets its own swipeable page of dials (rebound, compression, air
pressure, spacers, preload…). Spin a dial as you change it on the bike, then
tap Save to log the change.

Each page has two halves: **Trailside** (compression, rebound: quick
on-the-fly changes) and **Workshop** (pressure, volume spacers, preload:
slower jobs). Clockwise always means more damping (firmer compression,
slower rebound); anticlockwise means less.

**Setups** (the chip at the top left of each page, e.g. "Standard ▾") hold
separate values for different configurations such as a 160/170 flip chip.
Setups with the same name on the fork and shock switch together, and every
switch is logged in history.

Set up profiles under **Settings → Forks & shocks**: for each dial choose
clicks, turns, pressure, spacers or a custom unit, its min, max and current
position, and whether it lives on the Trailside or Workshop page.

**Live app:** https://kieranburton30.github.io/sagbook/

## Install on your phone (once)

1. Double-click **`Open SagBook.cmd`** on the PC and scan the QR code with
   your phone's camera (or open the link above in **Chrome** on the phone).
   If the link opens inside another app, use **⋮ → Open in Chrome** first.
2. Tap **Install app** on the orange card (or Chrome **⋮** → **Add to Home
   screen** → **Install**).
3. Open SagBook from the home-screen icon. It works offline from then on.

## Quick launch (double-press)

Galaxy S24: Settings → Advanced features → Side button → Double press → Open
app → SagBook.

## Updating the app from the PC

Double-click **`Update SagBook.cmd`** in this folder. It publishes the latest
code. About a minute later, the next time you open SagBook on your phone, it
refreshes itself. Your logged data is never touched by updates.

## Your data

Everything is stored on the phone itself (no account, no server). Use
**Settings → Save backup file** now and then and keep the file somewhere safe
(e.g. Google Drive). **Restore from backup file** brings it all back on a new
phone.

## Folder layout

```
app/                 the app itself (this is what gets published)
  index.html, app.js, app.css, sw.js, manifest.webmanifest, icons/
tools/update.ps1     publish script used by "Update SagBook.cmd"
tools/serve.mjs      local preview: node tools/serve.mjs → http://localhost:5174
.github/workflows/   GitHub Actions job that deploys app/ to GitHub Pages
PLAN.md              original project plan
```
