# custom-scrollbar.js

A tiny, dependency-free **overlay scrollbar** you can drop into any website. It
hides the native scrollbar and draws a thin outlined track with a centered pill
thumb over every scrollable area — auto-detected, so there is nothing to wire up
per page. RTL/LTR aware, draggable, click-to-page, auto-hides when not needed.

## Install (2 steps)

1. Copy `custom-scrollbar.js` into your project.
2. Load it once, anywhere on the page:

```html
<script src="/path/custom-scrollbar.js" defer></script>
```

That's it. Every element whose computed `overflow-y` is `auto`/`scroll` gets the
custom bar automatically (now and for anything added later).

## Theming (pure CSS — no JS)

Colors read from CSS variables, so you can restyle without touching the file:

```css
:root {
  --csb-color: #bcbec0;  /* thumb + track outline */
  --csb-hover: #a7a9ac;  /* thumb on hover / drag  */
}
```

## Configuration (sizes & behavior)

Set `window.CustomScrollbarConfig` **before** the `<script>` tag:

```html
<script>
  window.CustomScrollbarConfig = {
    color: "#bcbec0",
    trackWidth: 8,
    offset: 5,
    padY: 10
  };
</script>
<script src="/path/custom-scrollbar.js" defer></script>
```

| Option        | Default    | Meaning |
|---------------|-----------:|---------|
| `color`       | `#bcbec0`  | Thumb + track outline color (or set `--csb-color`) |
| `hoverColor`  | `#a7a9ac`  | Thumb color on hover/drag (or set `--csb-hover`) |
| `trackWidth`  | `8`        | Overlay/track width (px) |
| `thumbWidth`  | `3`        | Thumb width (px) |
| `trackBorder` | `1`        | Track outline thickness (px) |
| `trackRadius` | `4`        | Track corner radius (px) |
| `thumbRadius` | `3`        | Thumb corner radius (px) |
| `offset`      | `5`        | Distance from the container edge (px) — **left in RTL, right in LTR** |
| `padY`        | `10`       | Empty margin at top & bottom of the track (px) |
| `thumbGap`    | `2`        | Gap between the thumb and each track end (px) |
| `minThumb`    | `24`       | Minimum thumb length (px) |
| `zIndex`      | `2000`     | Overlay stacking |
| `exclude`     | `[]`       | Extra CSS selectors to skip, e.g. `[".dropdown-popup"]` |

## JavaScript API

```js
CustomScrollbar.refresh();   // re-scan + reposition after big DOM changes
CustomScrollbar.attach(el);  // force-attach to a specific element
CustomScrollbar.config;      // the resolved config object
```

## How it works

- Each scroll container gets a `position:fixed` overlay (`.csb` → `.csb-track` +
  `.csb-thumb`) positioned over its scrollbar gutter; the native scrollbar is
  hidden via a `.has-csb` class.
- Position/size update on the element's `scroll`, a per-element `ResizeObserver`
  (also catches show/hide) and `MutationObserver` (content changes), plus a
  page-level `childList` observer that picks up newly-added containers.
- Updates are throttled with `requestAnimationFrame`.

## Notes / limits

- **Vertical** scrollbars only (the common case). Horizontal is not drawn.
- Skips `<textarea>`, `<input>`, `<select>`, and SVG nodes by default; add more
  via `exclude`.
- The overlay is `position:fixed`; it repositions on scroll/resize. In a
  background browser tab `requestAnimationFrame` pauses, so it updates when the
  tab is visible (fine for users).
- **CSP:** loading it as an external file needs `script-src 'self'`. It injects
  one `<style>`, which needs `style-src 'self' 'unsafe-inline'` (or add that
  style's hash/nonce). No network requests, no other assets.
