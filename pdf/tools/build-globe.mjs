/**
 * Regenerates pdf/globe.svg: the cover globe, as a flat SVG the PDF can print.
 *
 *   node pdf/tools/build-globe.mjs
 *
 * The site draws its globe with three.js over Natural Earth 110m TopoJSON, which
 * a PDF cannot carry. This projects the same dataset orthographically, with the
 * same Santiago-out corridor arcs, and writes a static SVG instead.
 *
 * Re-run only to change the orientation or the corridors below.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoOrthographic, geoPath, geoGraticule, geoInterpolate, geoDistance } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import world from 'world-atlas/countries-110m.json' with { type: 'json' };

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'globe.svg');

/* Framing ------------------------------------------------------------------ */
const SIZE = 620;
const C = SIZE / 2;
const R = 250;
const CENTER = { lat: 8, lon: -52 }; // Americas facing, Europe on the right limb

/* The corridors the site's globe animates, out of Santiago. */
const ORIGIN = { lat: -33.45, lon: -70.67, name: 'Santiago' };
const CORRIDORS = [
  { lat: 40.71, lon: -74.01, name: 'USA' },
  { lat: 19.43, lon: -99.13, name: 'Mexico' },
  { lat: -23.55, lon: -46.63, name: 'Brazil' },
  { lat: 4.71, lon: -74.07, name: 'Colombia' },
  { lat: 19.08, lon: 72.88, name: 'India' },
  { lat: 31.23, lon: 121.47, name: 'China' },
  { lat: 51.51, lon: -0.13, name: 'London' },
  { lat: 1.35, lon: 103.82, name: 'Singapore' },
  { lat: -34.6, lon: -58.38, name: 'Argentina' },
  { lat: -12.05, lon: -77.04, name: 'Peru' },
];

/* Palette — the deck's midnight-violet tokens. */
const INK = '#592e83';
const LAND = '#e5daf6';
const BORDER = '#cdb8ea';
const COAST = '#9a72cf';
const DOT = '#592e83';

const projection = geoOrthographic()
  .translate([C, C])
  .scale(R)
  .rotate([-CENTER.lon, -CENTER.lat])
  .precision(0.4);

const round = (d) => d.replace(/-?\d+\.\d+/g, (n) => (+n).toFixed(1));
const draw = geoPath(projection);
const p = (geo) => round(draw(geo) || '');

/* Land, interior borders, graticule ---------------------------------------- */
const land = feature(world, world.objects.land);
const borders = mesh(world, world.objects.countries, (a, b) => a !== b);
const graticule = geoGraticule().step([20, 20])();

/* Corridor arcs -------------------------------------------------------------
   Projected by hand rather than with geoPath: the arcs lift off the sphere the
   way the 3D ones do, and an altitude is something geoPath cannot express.     */
const rad = (d) => (d * Math.PI) / 180;
const lat0 = rad(CENTER.lat);
const lon0 = rad(CENTER.lon);

/** Orthographic projection of a lon/lat at `alt` times the sphere radius. */
function project([lon, lat], alt = 1) {
  const [φ, λ] = [rad(lat), rad(lon) - lon0];
  const cosc = Math.sin(lat0) * Math.sin(φ) + Math.cos(lat0) * Math.cos(φ) * Math.cos(λ);
  return {
    x: C + R * alt * Math.cos(φ) * Math.sin(λ),
    y: C - R * alt * (Math.cos(lat0) * Math.sin(φ) - Math.sin(lat0) * Math.cos(φ) * Math.cos(λ)),
    front: cosc >= 0,
  };
}

const originLL = [ORIGIN.lon, ORIGIN.lat];
const origin = project(originLL);

const arcs = [];
const dots = [];
for (const c of CORRIDORS) {
  const destLL = [c.lon, c.lat];
  const dest = project(destLL);
  if (!dest.front || !origin.front) continue; // over the horizon on this face

  const along = geoInterpolate(originLL, destLL);
  const lift = 0.05 + 0.2 * (geoDistance(originLL, destLL) / Math.PI);
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    pts.push(project(along(t), 1 + lift * Math.sin(Math.PI * t)));
  }
  arcs.push(
    `<path d="M${pts.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('L')}" fill="none" stroke="url(#sbArc)" stroke-width="1.7" stroke-linecap="round"/>`
  );
  dots.push(`<circle cx="${dest.x.toFixed(1)}" cy="${dest.y.toFixed(1)}" r="3.4" fill="${DOT}"/>`);
}

/* ---------------------------------------------------------------------------- */
const svg = `<svg class="pdf-globe" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cobertura global de Sugarblock">
  <defs>
    <radialGradient id="sbHalo" cx="50%" cy="50%" r="50%">
      <stop offset="62%" stop-color="${INK}" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="${INK}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sbArc" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="${INK}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#a03ce0" stop-opacity="0.6"/>
    </linearGradient>
  </defs>
  <circle cx="${C}" cy="${C}" r="${R + 44}" fill="url(#sbHalo)"/>
  <circle cx="${C}" cy="${C}" r="${R}" fill="#fcfaff"/>
  <path d="${p(graticule)}" fill="none" stroke="${INK}" stroke-opacity="0.1" stroke-width="0.8"/>
  <path d="${p(land)}" fill="${LAND}"/>
  <path d="${p(borders)}" fill="none" stroke="${BORDER}" stroke-width="0.8" stroke-linejoin="round"/>
  <path d="${p(land)}" fill="none" stroke="${COAST}" stroke-width="1" stroke-linejoin="round"/>
  <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${INK}" stroke-opacity="0.22" stroke-width="1"/>
  ${arcs.join('\n  ')}
  ${dots.join('\n  ')}
  <circle cx="${origin.x.toFixed(1)}" cy="${origin.y.toFixed(1)}" r="10" fill="${INK}" fill-opacity="0.16"/>
  <circle cx="${origin.x.toFixed(1)}" cy="${origin.y.toFixed(1)}" r="4.6" fill="${INK}"/>
</svg>
`;

fs.writeFileSync(OUT, svg);
console.log(`pdf/globe.svg — ${arcs.length} corridors on this face, ${(svg.length / 1024).toFixed(0)} KB`);
