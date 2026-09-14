# Deck → PDF

Exports `index.html` (the deck at sales.sugarblock.io) as a 16:9 PDF, one page
per slide, plus annex tables that replace the interactive pricing chart.

```bash
npm install          # playwright, once
npm run pdf          # dist/Sugarblock-Deck-ES.pdf + -EN.pdf
npm run pdf:es       # Spanish only
npm run pdf:proof    # also writes dist/proof-<lang>/NN.png for eyeballing pages
```

## What the build does

`index.html` stays the single source of truth. The script opens it in Chromium
and, before printing:

- drops the splash screen, the nav bar and the WebGL globe;
- neutralises the scroll reveals and settles the count-up figures on their final
  values;
- pins every `<section class="slide">` to exactly 1280 × 720 px (= 960 × 540 pt,
  the standard 16:9 slide size);
- **replaces the two Chart.js canvases**, which cannot print. `Chart` is stubbed
  before the page runs, so the deck hands over its own chart configs. The
  pricing chart is re-rendered as a comparative table; the traction chart as a
  static SVG line chart drawn from the same numbers. Edit a rate or a quarter in
  `index.html` and the tables follow — nothing is duplicated here.

Corridor rails in the pricing table are read out of the deck's own coverage
grid, so they stay in step with it in both languages.

## Annexes

Three pages are appended after the closing slide:

| Annex | Contents | Source |
| ----- | -------- | ------ |
| A | Pricing per corridor, with savings in % and on a US$100,000 reference transfer | `initPricingChart` |
| B | Coverage and settlement rails, every corridor | the coverage grid |
| C | Quarterly volume, QoQ change and cumulative total | `initVolumeChart` |

Savings and cumulative figures are derived arithmetic, never hand-entered:
savings = (bank − Sugarblock) / bank, and Annex C's cumulative column adds up to
the US$533M the traction slide already claims.

## Page fit

The build measures every page and warns (and exits non-zero) when content
overflows its 720 px, so a copy change that breaks a slide is caught at build
time rather than in the PDF.

## Fonts

`fonts.css` carries Archivo inlined as base64, so the build runs offline and the
PDF embeds its own typeface. Regenerate with `npm run fonts` only if the brand
typeface changes.
