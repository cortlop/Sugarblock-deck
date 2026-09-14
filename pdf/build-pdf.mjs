/**
 * Sugarblock deck -> PDF.
 *
 *   node pdf/build-pdf.mjs                  # dist/Sugarblock-Deck-ES.pdf
 *   node pdf/build-pdf.mjs --lang en        # dist/Sugarblock-Deck-EN.pdf
 *   node pdf/build-pdf.mjs --all            # both
 *   node pdf/build-pdf.mjs --png            # also write per-page PNGs (proofing)
 *
 * index.html stays the single source of truth. The script loads it in Chromium,
 * strips the parts that only make sense on screen (splash, nav, scroll reveals,
 * WebGL globe), and turns each <section class="slide"> into one 1280x720 page.
 *
 * The two Chart.js canvases cannot print, so Chart is stubbed before the page
 * runs: the deck hands over its own chart configs, and their data is re-rendered
 * as a comparative pricing table and a static SVG line chart. Change a rate in
 * index.html and the tables here follow.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_W = 1280;
const PAGE_H = 720;

const argv = process.argv.slice(2);
const wantPng = argv.includes('--png');
const langs = argv.includes('--all')
  ? ['es', 'en']
  : [(argv[argv.indexOf('--lang') + 1] || 'es').toLowerCase() === 'en' ? 'en' : 'es'];

/* --------------------------------------------------------------------------
   Copy for the pages the PDF adds (the deck's own copy comes from its i18n).
   -------------------------------------------------------------------------- */
const COPY = {
  es: {
    coverMeta: 'Deck de ventas · sugarblock.io',
    footerBrand: 'Sugarblock · sugarblock.io',
    // Pricing page
    pricingTableCorridor: 'Corredor',
    pricingTableRail: 'Riel',
    pricingTableCompare: 'Comparación',
    pricingTableSb: 'Sugarblock',
    pricingTableBank: 'Banco tradicional',
    pricingTableSave: 'Ahorro',
    pricingTableAvg: 'Promedio',
    // Annex divider
    annexDividerTag: 'Anexos',
    annexDividerTitle: 'Detalle comparativo.',
    annexDividerSub:
      'Las tablas siguientes reemplazan los gráficos interactivos del sitio. Mismos datos, formato imprimible.',
    // Annex A
    annexATag: 'Anexo A',
    annexATitle: 'Precios por corredor.',
    annexASub: 'Spread best case de Sugarblock frente al costo de un banco tradicional en el mismo corredor.',
    annexASavePct: 'Ahorro',
    annexASaveAbs: 'Ahorro s/ US$100.000',
    annexACostSb: 'Costo Sugarblock',
    annexACostBank: 'Costo banco',
    annexANote:
      'Ahorro = (costo banco − costo Sugarblock) / costo banco. Los montos en dólares son la aplicación directa de cada spread sobre una transferencia de referencia de US$100.000. Spreads best case; los montos altos acceden a las tarifas más bajas del rango.',
    // Annex B
    annexBTag: 'Anexo B',
    annexBTitle: 'Cobertura y rieles.',
    annexBSub: 'Rieles de liquidación por destino. Cobertura en +180 países vía SWIFT.',
    annexBCountry: 'Destino',
    annexBRail: 'Riel de liquidación',
    annexBNote: 'Los rieles instantáneos liquidan en minutos; SWIFT y WIRE, en el mismo día o al día hábil siguiente según horario de corte y zona horaria.',
    // Annex C
    annexCTag: 'Anexo C',
    annexCTitle: 'Tracción trimestral.',
    annexCSub: 'Volumen transado por trimestre desde Q1 2024.',
    annexCQuarter: 'Trimestre',
    annexCVolume: 'Volumen',
    annexCQoQ: 'Var. trimestral',
    annexCCum: 'Acumulado',
    annexCTotal: 'Total acumulado',
    annexCNote: 'Volumen transado en millones de USD. La variación trimestral compara cada trimestre con el inmediatamente anterior.',
  },
  en: {
    coverMeta: 'Sales deck · sugarblock.io',
    footerBrand: 'Sugarblock · sugarblock.io',
    pricingTableCorridor: 'Corridor',
    pricingTableRail: 'Rail',
    pricingTableCompare: 'Comparison',
    pricingTableSb: 'Sugarblock',
    pricingTableBank: 'Traditional bank',
    pricingTableSave: 'Savings',
    pricingTableAvg: 'Average',
    annexDividerTag: 'Appendix',
    annexDividerTitle: 'Comparison detail.',
    annexDividerSub:
      'The tables that follow replace the interactive charts on the site. Same data, print-ready format.',
    annexATag: 'Appendix A',
    annexATitle: 'Pricing by corridor.',
    annexASub: "Sugarblock's best-case spread against a traditional bank on the same corridor.",
    annexASavePct: 'Savings',
    annexASaveAbs: 'Saved on US$100,000',
    annexACostSb: 'Sugarblock cost',
    annexACostBank: 'Bank cost',
    annexANote:
      'Savings = (bank cost − Sugarblock cost) / bank cost. Dollar figures apply each spread directly to a US$100,000 reference transfer. Best-case spreads; high amounts reach the lower end of the range.',
    annexBTag: 'Appendix B',
    annexBTitle: 'Coverage and rails.',
    annexBSub: 'Settlement rails by destination. Coverage in 180+ countries via SWIFT.',
    annexBCountry: 'Destination',
    annexBRail: 'Settlement rail',
    annexBNote: 'Instant rails settle in minutes; SWIFT and WIRE settle same day or next business day depending on cut-off times and time zone.',
    annexCTag: 'Appendix C',
    annexCTitle: 'Quarterly traction.',
    annexCSub: 'Volume transacted per quarter since Q1 2024.',
    annexCQuarter: 'Quarter',
    annexCVolume: 'Volume',
    annexCQoQ: 'QoQ change',
    annexCCum: 'Cumulative',
    annexCTotal: 'Cumulative total',
    annexCNote: 'Volume transacted in millions of USD. QoQ change compares each quarter with the one immediately before it.',
  },
};

/* --------------------------------------------------------------------------
   Page-side transform. Runs inside Chromium with the captured chart configs.
   -------------------------------------------------------------------------- */
function transform({ charts, copy, lang }) {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  // The deck writes its figures en-US style in both languages ("0.33%", "39,200
  // empresas") — the tables follow that so they match the copy above them.
  const nf = (n, d = 0) =>
    n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n, d = 2) => `${nf(n, d)}%`;

  /* -- screen-only chrome ------------------------------------------------- */
  ['#splash-screen', 'nav', '#globeCanvas'].forEach((s) => $(s)?.remove());

  /* -- counters land on their final value --------------------------------- */
  $$('.countup').forEach((n) => {
    const target = parseFloat(n.dataset.target);
    if (Number.isNaN(target)) return;
    const decimals = parseInt(n.dataset.decimals || '0', 10);
    n.textContent = `${n.dataset.prefix || ''}${nf(target, decimals)}${n.dataset.suffix || ''}`;
  });

  /* -- cover: static stand-in for the WebGL globe -------------------------- */
  const hero = $('#hero');
  if (hero) {
    const R = 250;
    const CX = 310;
    const CY = 310;
    const lat0 = -5;
    const lon0 = -62;
    const rad = (d) => (d * Math.PI) / 180;
    const project = (lat, lon) => {
      const [p, l, p0, dl] = [rad(lat), rad(lon), rad(lat0), rad(lon - lon0)];
      const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl);
      return {
        x: CX + R * Math.cos(p) * Math.sin(dl),
        y: CY - R * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl)),
        visible: cosc >= 0,
      };
    };
    const polyline = (pts, attrs) =>
      pts.length < 2 ? '' : `<path d="M${pts.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('L')}" ${attrs}/>`;

    // Meridians and parallels, matching the site's wireframe sphere.
    let wire = '';
    const wireAttrs = 'fill="none" stroke="#592e83" stroke-width="1" stroke-opacity="0.16"';
    for (let lon = -180; lon < 180; lon += 20) {
      const pts = [];
      for (let lat = -90; lat <= 90; lat += 4) {
        const q = project(lat, lon);
        if (q.visible) pts.push(q);
        else if (pts.length) { wire += polyline(pts, wireAttrs); pts.length = 0; }
      }
      wire += polyline(pts, wireAttrs);
    }
    for (let lat = -80; lat <= 80; lat += 20) {
      const pts = [];
      for (let lon = -180; lon <= 180; lon += 4) {
        const q = project(lat, lon);
        if (q.visible) pts.push(q);
        else if (pts.length) { wire += polyline(pts, wireAttrs); pts.length = 0; }
      }
      wire += polyline(pts, wireAttrs);
    }

    // Corridor arcs out of Santiago — the same destinations the site animates.
    const origin = { lat: -33.45, lon: -70.67 };
    const dests = [
      { lat: 40.71, lon: -74.01 }, { lat: 19.43, lon: -99.13 }, { lat: -23.55, lon: -46.63 },
      { lat: 4.71, lon: -74.07 }, { lat: 19.08, lon: 72.88 }, { lat: 31.23, lon: 121.47 },
      { lat: 51.51, lon: -0.13 }, { lat: 1.35, lon: 103.82 }, { lat: -34.6, lon: -58.38 },
      { lat: -12.05, lon: -77.04 },
    ];
    const o = project(origin.lat, origin.lon);
    let arcs = '';
    let dots = '';
    dests.forEach((d) => {
      const q = project(d.lat, d.lon);
      if (!q.visible) return;
      // Bulge the control point away from the globe centre, as the 3D arcs do.
      const mx = (o.x + q.x) / 2;
      const my = (o.y + q.y) / 2;
      const len = Math.hypot(mx - CX, my - CY) || 1;
      const lift = 1 + Math.min(0.42, Math.hypot(q.x - o.x, q.y - o.y) / (R * 3.2));
      const cx = CX + ((mx - CX) / len) * len * lift;
      const cy = CY + ((my - CY) / len) * len * lift;
      arcs += `<path d="M${o.x.toFixed(1)} ${o.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}" fill="none" stroke="url(#sbArc)" stroke-width="1.6" stroke-linecap="round"/>`;
      dots += `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="3.2" fill="#9984d4"/>`;
    });

    const globe = el('div');
    globe.innerHTML = `
<svg class="pdf-globe" viewBox="0 0 620 620" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="sbGlow" cx="50%" cy="50%" r="50%">
      <stop offset="55%" stop-color="#592e83" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#592e83" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sbArc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#592e83" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#be2eff" stop-opacity="0.35"/>
    </linearGradient>
  </defs>
  <circle cx="${CX}" cy="${CY}" r="${R + 46}" fill="url(#sbGlow)"/>
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="#faf8fd" stroke="#592e83" stroke-opacity="0.18" stroke-width="1"/>
  ${wire}
  ${arcs}
  ${dots}
  <circle cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="9" fill="#592e83" fill-opacity="0.18"/>
  <circle cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="4.2" fill="#592e83"/>
</svg>`;
    hero.insertBefore(globe.firstElementChild, hero.firstChild);
    hero.appendChild(el('div', 'pdf-cover-meta', copy.coverMeta));
  }

  /* -- pricing: the interactive chart becomes a comparative table ---------- */
  const pricing = charts.find((c) => c.id === 'pricingChart');

  // Rails come from the deck's own coverage grid, so they stay in step with it
  // (and with whichever language is being rendered).
  const railByCorridor = {};
  $$('.corridor').forEach((c) => {
    const country = c.querySelector('.country')?.textContent.trim();
    const rail = c.querySelector('.rail')?.textContent.trim();
    if (country && rail) railByCorridor[country] = rail;
  });
  // The chart's catch-all bar has no card of its own.
  const globalRail = railByCorridor[lang === 'es' ? '+180 países' : '+180 countries'] || 'SWIFT · Global';
  railByCorridor['Intl. SWIFT'] = globalRail;
  // The deck labels this corridor "Europa" on its Spanish cards and "Europe" on
  // its English ones; the chart label stays Spanish, so bridge the two.
  if (railByCorridor.Europe && !railByCorridor.Europa) railByCorridor.Europa = railByCorridor.Europe;

  let rows = [];
  if (pricing) {
    const labels = pricing.config.data.labels;
    const sb = pricing.config.data.datasets[0].data;
    const bank = pricing.config.data.datasets[1].data;
    const displayName = (n) => (lang === 'en' && n === 'Europa' ? 'Europe' : n);
    rows = labels.map((name, i) => ({
      name: displayName(name),
      rail: railByCorridor[name] || '—',
      sb: sb[i],
      bank: bank[i],
      save: (bank[i] - sb[i]) / bank[i],
    }));
  }

  const maxRate = rows.length ? Math.max(...rows.map((r) => r.bank)) : 1;
  const bars = (r) => `
    <div class="cmp-bars">
      <div class="cmp-bar" style="width:${((r.sb / maxRate) * 100).toFixed(1)}%"></div>
      <div class="cmp-bar is-bank" style="width:${((r.bank / maxRate) * 100).toFixed(1)}%"></div>
    </div>`;

  const pricingCanvas = $('#pricingChart');
  if (pricingCanvas && rows.length) {
    const slide = pricingCanvas.closest('.slide');
    slide.classList.add('slide--pricing');
    const avgSb = rows.reduce((a, r) => a + r.sb, 0) / rows.length;
    const avgBank = rows.reduce((a, r) => a + r.bank, 0) / rows.length;

    const wrap = el('div', 'pdf-table-wrap');
    wrap.innerHTML = `
<table class="pdf-table">
  <thead>
    <tr>
      <th>${copy.pricingTableCorridor}</th>
      <th>${copy.pricingTableRail}</th>
      <th>${copy.pricingTableCompare}</th>
      <th class="num">${copy.pricingTableSb}</th>
      <th class="num">${copy.pricingTableBank}</th>
      <th class="num">${copy.pricingTableSave}</th>
    </tr>
  </thead>
  <tbody>
    ${rows
      .map(
        (r) => `<tr>
      <td class="col-name">${r.name}</td>
      <td class="col-rail">${r.rail}</td>
      <td>${bars(r)}</td>
      <td class="num v-sb">${pct(r.sb)}</td>
      <td class="num v-bank">${pct(r.bank)}</td>
      <td class="num v-save">−${nf(r.save * 100, 0)}%</td>
    </tr>`
      )
      .join('')}
  </tbody>
  <tfoot>
    <tr>
      <td>${copy.pricingTableAvg}</td>
      <td></td>
      <td></td>
      <td class="num">${pct(avgSb)}</td>
      <td class="num">${pct(avgBank)}</td>
      <td class="num">−${nf(((avgBank - avgSb) / avgBank) * 100, 0)}%</td>
    </tr>
  </tfoot>
</table>`;
    pricingCanvas.parentElement.replaceWith(wrap);
  }

  /* -- traction: the Chart.js line becomes inline SVG ---------------------- */
  const volume = charts.find((c) => c.id === 'volumeChart');
  const volCanvas = $('#volumeChart');
  let volLabels = [];
  let volData = [];
  if (volume && volCanvas) {
    volLabels = volume.config.data.labels;
    volData = volume.config.data.datasets[0].data;

    const box = volCanvas.parentElement.getBoundingClientRect();
    const W = Math.round(box.width) || 1120;
    const H = Math.max(190, Math.round(box.height) || 240);
    const pad = { l: 54, r: 44, t: 12, b: 26 };
    const cw = W - pad.l - pad.r;
    const ch = H - pad.t - pad.b;
    const yMax = 100;
    const X = (i) => pad.l + (cw * i) / (volData.length - 1);
    const Y = (v) => pad.t + ch - (ch * v) / yMax;
    const pts = volData.map((v, i) => ({ x: X(i), y: Y(v) }));

    // Chart.js splineCurve (tension 0.4) so the curve matches the site.
    const T = 0.4;
    const cps = pts.map((p, i) => {
      const prev = pts[i - 1] || p;
      const next = pts[i + 1] || p;
      const d01 = Math.hypot(p.x - prev.x, p.y - prev.y);
      const d12 = Math.hypot(next.x - p.x, next.y - p.y);
      const s01 = d01 + d12 === 0 ? 0 : (T * d01) / (d01 + d12);
      const s12 = d01 + d12 === 0 ? 0 : (T * d12) / (d01 + d12);
      return {
        prev: { x: p.x - s01 * (next.x - prev.x), y: p.y - s01 * (next.y - prev.y) },
        next: { x: p.x + s12 * (next.x - prev.x), y: p.y + s12 * (next.y - prev.y) },
      };
    });
    let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` C${cps[i - 1].next.x.toFixed(1)} ${cps[i - 1].next.y.toFixed(1)}, ${cps[i].prev.x.toFixed(1)} ${cps[i].prev.y.toFixed(1)}, ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
    }

    let grid = '';
    let yTicks = '';
    for (let v = 0; v <= yMax; v += 25) {
      const y = Y(v).toFixed(1);
      grid += `<line x1="${pad.l}" y1="${y}" x2="${(W - pad.r).toFixed(1)}" y2="${y}" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>`;
      yTicks += `<text x="${pad.l - 10}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="#6f6a82">$${v}M</text>`;
    }
    const xTicks = volLabels
      .map(
        (l, i) =>
          `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#6f6a82">${l}</text>`
      )
      .join('');

    const svg = el('div');
    svg.innerHTML = `
<svg class="pdf-linechart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" role="img">
  <defs>
    <linearGradient id="sbArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#592e83" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#592e83" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  ${grid}
  <path d="${d} L${pts[pts.length - 1].x.toFixed(1)} ${(pad.t + ch).toFixed(1)} L${pts[0].x.toFixed(1)} ${(pad.t + ch).toFixed(1)} Z" fill="url(#sbArea)"/>
  <path d="${d}" fill="none" stroke="#592e83" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  ${pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#592e83" stroke="#fff" stroke-width="2"/>`).join('')}
  ${yTicks}${xTicks}
</svg>`;
    volCanvas.replaceWith(svg.firstElementChild);
  }

  /* -- annex pages --------------------------------------------------------- */
  const annexPage = (tag, title, sub, bodyHtml, note) => {
    const s = el('section', 'slide slide-light annex');
    s.innerHTML = `
      <div class="annex-tag">${tag}</div>
      <h2>${title}</h2>
      <p class="subtitle">${sub}</p>
      ${bodyHtml}
      ${note ? `<p class="pdf-table-note">${note}</p>` : ''}`;
    return s;
  };

  const lastSlide = $$('.slide').pop();
  const added = [];

  // Divider
  const divider = el('section', 'slide slide-dark annex-divider');
  const mark = $('.cta-logo')?.cloneNode(true);
  divider.innerHTML = `
    <div class="eyebrow">${copy.annexDividerTag}</div>
    <h2>${copy.annexDividerTitle}</h2>
    <p class="subtitle">${copy.annexDividerSub}</p>`;
  if (mark) {
    mark.classList.add('annex-mark');
    divider.insertBefore(mark, divider.firstChild);
  }
  added.push(divider);

  // Annex A — pricing detail with derived savings
  if (rows.length) {
    const ref = 100000;
    const body = `
<div class="pdf-table-wrap">
<table class="pdf-table">
  <thead>
    <tr>
      <th>${copy.pricingTableCorridor}</th>
      <th>${copy.pricingTableRail}</th>
      <th class="num">${copy.pricingTableSb}</th>
      <th class="num">${copy.pricingTableBank}</th>
      <th class="num">${copy.annexACostSb}</th>
      <th class="num">${copy.annexACostBank}</th>
      <th class="num">${copy.annexASavePct}</th>
      <th class="num">${copy.annexASaveAbs}</th>
    </tr>
  </thead>
  <tbody>
    ${rows
      .map(
        (r) => `<tr>
      <td class="col-name">${r.name}</td>
      <td class="col-rail">${r.rail}</td>
      <td class="num v-sb">${pct(r.sb)}</td>
      <td class="num v-bank">${pct(r.bank)}</td>
      <td class="num">US$${nf((ref * r.sb) / 100, 0)}</td>
      <td class="num">US$${nf((ref * r.bank) / 100, 0)}</td>
      <td class="num v-save">−${nf(r.save * 100, 0)}%</td>
      <td class="num v-save">US$${nf((ref * (r.bank - r.sb)) / 100, 0)}</td>
    </tr>`
      )
      .join('')}
  </tbody>
</table>
</div>`;
    added.push(annexPage(copy.annexATag, copy.annexATitle, copy.annexASub, body, copy.annexANote));
  }

  // Annex B — coverage and rails, straight from the corridor grid
  const corridors = $$('.corridor').map((c) => ({
    flag: c.querySelector('.flag')?.textContent.trim() || '',
    country: c.querySelector('.country')?.textContent.trim() || '',
    rail: c.querySelector('.rail')?.textContent.trim() || '',
  }));
  if (corridors.length) {
    const half = Math.ceil(corridors.length / 2);
    const col = (list) => `
<table class="pdf-table">
  <thead><tr><th>${copy.annexBCountry}</th><th>${copy.annexBRail}</th></tr></thead>
  <tbody>
    ${list
      .map(
        (c) =>
          `<tr><td class="col-name">${c.flag} ${c.country}</td><td class="col-rail">${c.rail}</td></tr>`
      )
      .join('')}
  </tbody>
</table>`;
    const body = `<div class="pdf-table-wrap pdf-two-col">${col(corridors.slice(0, half))}${col(corridors.slice(half))}</div>`;
    added.push(annexPage(copy.annexBTag, copy.annexBTitle, copy.annexBSub, body, copy.annexBNote));
  }

  // Annex C — quarterly traction
  if (volData.length) {
    let cum = 0;
    const trRows = volData.map((v, i) => {
      cum += v;
      const qoq = i === 0 ? null : (v - volData[i - 1]) / volData[i - 1];
      return { q: volLabels[i], v, qoq, cum };
    });
    const body = `
<div class="pdf-table-wrap">
<table class="pdf-table">
  <thead>
    <tr>
      <th>${copy.annexCQuarter}</th>
      <th class="num">${copy.annexCVolume}</th>
      <th class="num">${copy.annexCQoQ}</th>
      <th class="num">${copy.annexCCum}</th>
    </tr>
  </thead>
  <tbody>
    ${trRows
      .map(
        (r) => `<tr>
      <td class="col-name">${r.q}</td>
      <td class="num v-sb">US$${nf(r.v, 1)}M</td>
      <td class="num" style="color:${r.qoq == null ? '#b3a7c4' : r.qoq >= 0 ? '#2f7d54' : '#b4485f'}">${
          r.qoq == null ? '—' : `${r.qoq >= 0 ? '+' : '−'}${nf(Math.abs(r.qoq) * 100, 1)}%`
        }</td>
      <td class="num">US$${nf(r.cum, 1)}M</td>
    </tr>`
      )
      .join('')}
  </tbody>
  <tfoot>
    <tr>
      <td>${copy.annexCTotal}</td>
      <td class="num"></td>
      <td class="num"></td>
      <td class="num">US$${nf(cum, 0)}M</td>
    </tr>
  </tfoot>
</table>
</div>`;
    added.push(annexPage(copy.annexCTag, copy.annexCTitle, copy.annexCSub, body, copy.annexCNote));
  }

  let anchor = lastSlide;
  added.forEach((s) => {
    anchor.parentElement.insertBefore(s, anchor.nextSibling);
    anchor = s;
  });

  /* -- footers ------------------------------------------------------------- */
  const slides = $$('.slide');
  slides.forEach((s, i) => {
    if (i === 0) return;
    const f = el('div', 'pdf-footer');
    f.innerHTML = `<span>${copy.footerBrand}</span><span class="pdf-page-no">${i + 1} / ${slides.length}</span>`;
    s.appendChild(f);
  });

  /* -- report anything that does not fit its page -------------------------- */
  return slides.map((s, i) => ({
    page: i + 1,
    id: s.id || s.className.split(' ').slice(-1)[0],
    overflow: Math.max(0, s.scrollHeight - s.clientHeight),
  }));
}

/* -------------------------------------------------------------------------- */

async function build(browser, lang) {
  const copy = COPY[lang];
  const ctx = await browser.newContext({
    viewport: { width: PAGE_W, height: PAGE_H },
    deviceScaleFactor: 2,
    locale: lang === 'es' ? 'es-CL' : 'en-US',
  });
  const page = await ctx.newPage();

  // The deck's CDN bundles are not needed on paper; blocking them keeps the
  // build offline and deterministic. Chart is stubbed so the deck still hands
  // over its chart configs.
  await page.route(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/, (r) => r.abort());
  await page.addInitScript(() => {
    window.__charts = [];
    window.Chart = function (canvas, config) {
      window.__charts.push({ id: canvas && canvas.id, config });
      return { data: config.data, update() {}, destroy() {}, resize() {} };
    };
    window.Chart.defaults = { font: {}, color: '' };
  });

  await page.goto(`file://${path.join(ROOT, 'index.html')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  await page.addStyleTag({ path: path.join(ROOT, 'pdf', 'fonts.css') });
  await page.addStyleTag({ path: path.join(ROOT, 'pdf', 'print.css') });
  await page.evaluate(() => document.fonts.ready);

  const charts = await page.evaluate((l) => {
    window.SBi18n?.applyLang(l);
    window.initPricingChart?.();
    window.initVolumeChart?.();
    return window.__charts.map((c) => ({
      id: c.id,
      config: { data: { labels: c.config.data.labels, datasets: c.config.data.datasets.map((d) => ({ label: d.label, data: d.data })) } },
    }));
  }, lang);

  const report = await page.evaluate(transform, { charts, copy, lang });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);

  const out = path.join(ROOT, 'dist', `Sugarblock-Deck-${lang.toUpperCase()}.pdf`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.pdf({
    path: out,
    width: `${PAGE_W}px`,
    height: `${PAGE_H}px`,
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });

  if (wantPng) {
    const dir = path.join(ROOT, 'dist', `proof-${lang}`);
    fs.mkdirSync(dir, { recursive: true });
    const handles = await page.$$('.slide');
    for (let i = 0; i < handles.length; i++) {
      await handles[i].screenshot({ path: path.join(dir, `${String(i + 1).padStart(2, '0')}.png`) });
    }
  }

  const bad = report.filter((r) => r.overflow > 2);
  console.log(`${path.relative(ROOT, out)} — ${report.length} pages, ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB`);
  if (bad.length) {
    console.warn('  content overflows its page:');
    bad.forEach((r) => console.warn(`    p${r.page} (${r.id}) +${r.overflow}px`));
  }

  await ctx.close();
  return bad.length;
}

const browser = await chromium.launch();
let problems = 0;
for (const lang of langs) problems += await build(browser, lang);
await browser.close();
process.exit(problems ? 1 : 0);
