# Flipbook libraries

Served from here, not a CDN: the site's CSP allows scripts from 'self' only.

| File | Library | Version | License |
|---|---|---|---|
| `pdf.min.js`, `pdf.worker.min.js` | PDF.js (Mozilla) | 3.11.174 | Apache-2.0 (`LICENSE-pdfjs`) |
| `page-flip.browser.js` | page-flip (StPageFlip) | 2.0.7 | MIT (`LICENSE-page-flip`) |
| `qrcode.min.js` | qrcodejs (davidshimjs) | 1.0.0 | MIT |

PDF.js is always opened with `isEvalSupported: false`, so its eval path stays off under the CSP.
