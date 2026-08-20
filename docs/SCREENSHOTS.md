# Caprigo harness screenshots

Marketing assets for README, GitHub social preview, X/LinkedIn, and caprigoai.com.

## Quick regen (mock HUD)

Faithful static mock of the real TUI (`docs/hud-preview.html`), rendered with Playwright:

```bash
npm run screenshots
```

Or one scene:

```bash
node scripts/capture-harness-screenshots.cjs --scene web
node scripts/capture-harness-screenshots.cjs --list
```

### Generated files (`docs/assets/`)

| File | Use |
|------|-----|
| `hud-terminal.png` | README hero, GitHub repo social image |
| `hud-web-mission.png` | Web search / tool-loop demo |
| `hud-write-mission.png` | File write + browser preview |
| `hud-og.png` | Open Graph / X card (1200×630) |

Edit scenes in `docs/hud-preview.html`, then rerun `npm run screenshots`.

## Live terminal capture (real HUD)

For authentic terminal texture (recommended for X threads and demo video):

1. **Start LM Studio** — Local Server on, tool model loaded.
2. **Build + launch:**
   ```powershell
   .\launch-hud.ps1 -Rebuild
   ```
3. **Maximize** Windows Terminal (dark theme, Cascadia Mono 13–14px).
4. **Run a visible mission** — e.g. `open notepad and type hello from Caprigo`.
5. **Capture:**
   - `Win + Shift + S` → region screenshot, or
   - Windows Terminal → **Settings → Actions → "Copy text as HTML"** (optional), or
   - OBS / ShareX for video.

Save live captures alongside mocks:

```
docs/assets/live/
  hud-notepad-live.png
  hud-demo.mp4
```

## GitHub social preview

Repo **Settings → General → Social preview** → upload `docs/assets/hud-og.png` or `hud-terminal.png`.

## Website (caprigoai.com)

Use `hud-terminal.png` as hero; `hud-web-mission.png` and `hud-write-mission.png` for feature sections.

## Checklist before launch post

- [ ] `npm run screenshots` — all four PNGs fresh
- [ ] Optional: one **live** terminal screenshot for authenticity
- [ ] README hero matches current HUD layout
- [ ] SOCIAL_LAUNCH.md attach list updated if filenames change
