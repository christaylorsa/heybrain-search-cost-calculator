/* Draws the branded results image on a canvas (preview + PNG download).
   Brand: statement gradient #123FB8 → #1F58DB with soft sky blobs, dashed grid with mono coordinates,
   pixel halftone, white lockup, Inter + JetBrains Mono. Assets come from brand-assets.js as data URIs. */
(function () {
  'use strict';

  const C = {
    deepFrom: '#123FB8', deepTo: '#1F58DB', royal: '#226BFD', sky: '#46A5F9', soft: '#7BC0F7',
    light: '#AED9FC', ice: '#D7F6FF', white: '#FFFFFF',
  };
  const INTER = '"Inter", system-ui, sans-serif';
  const MONO = '"JetBrains Mono", ui-monospace, monospace';

  const FORMATS = {
    square: { w: 1080, h: 1080 },
    landscape: { w: 1200, h: 630 },
  };

  // ---------- Asset + font readiness ----------
  const A = window.HB_ASSETS;
  const wordmark = new Image();
  const logoPaths = A.logoPaths.map((d) => new Path2D(d));
  const imgReady = new Promise((res) => {
    wordmark.onload = () => res();
    wordmark.onerror = () => res();
    wordmark.src = A.wordmarkWhite;
  });
  const fontsReady = (document.fonts && document.fonts.load)
    ? Promise.race([
        Promise.all([
          document.fonts.load(`400 40px ${INTER}`),
          document.fonts.load(`500 40px ${INTER}`),
          document.fonts.load(`600 40px ${INTER}`),
          document.fonts.load(`500 20px ${MONO}`),
        ]).catch(() => {}),
        new Promise((res) => setTimeout(res, 4000)), // never hang if the font CDN is unreachable
      ])
    : Promise.resolve();
  const ready = Promise.all([imgReady, fontsReady]);

  // ---------- Helpers ----------
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const hasSpacing = (() => {
    try { return 'letterSpacing' in document.createElement('canvas').getContext('2d'); } catch (e) { return false; }
  })();

  function font(ctx, weight, size, family = INTER, trackEm = 0) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (hasSpacing) ctx.letterSpacing = `${(trackEm * size).toFixed(2)}px`;
  }
  function textWidth(ctx, s) { return ctx.measureText(s).width; }

  // Mono labels need tracking; fall back to per-character drawing where letterSpacing is unsupported.
  function drawTracked(ctx, s, x, y, size, color, align = 'left', track = 0.14) {
    font(ctx, 500, size, MONO, track);
    ctx.fillStyle = color;
    if (hasSpacing) {
      const w = textWidth(ctx, s) - track * size; // trailing space added after the last glyph
      ctx.textAlign = 'left';
      ctx.fillText(s, align === 'right' ? x - w : x, y);
      return w;
    }
    const gap = track * size;
    const widths = [...s].map((ch) => textWidth(ctx, ch));
    const total = widths.reduce((a, b) => a + b, 0) + gap * (s.length - 1);
    let cx = align === 'right' ? x - total : x;
    ctx.textAlign = 'left';
    [...s].forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += widths[i] + gap; });
    return total;
  }

  function wrap(ctx, text, maxW) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    words.forEach((w) => {
      const t = line ? line + ' ' + w : w;
      if (textWidth(ctx, t) > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }

  // Rich text: segments [{t, weight}] wrapped as words across lines.
  function layoutRich(ctx, segs, size, maxW) {
    const words = [];
    segs.forEach((s) => s.t.split(' ').forEach((w, i, arr) => { if (w) words.push({ w, weight: s.weight, space: true }); }));
    const lines = [[]];
    let x = 0;
    const space = (() => { font(ctx, 400, size); return textWidth(ctx, ' '); })();
    words.forEach((wd) => {
      font(ctx, wd.weight, size, INTER, -0.01);
      const ww = textWidth(ctx, wd.w);
      const cur = lines[lines.length - 1];
      if (cur.length && x + space + ww > maxW) { lines.push([]); x = 0; }
      const line = lines[lines.length - 1];
      if (line.length) x += space;
      line.push({ ...wd, x, ww });
      x += ww;
    });
    return lines;
  }
  function drawRich(ctx, lines, x, y, size, lh, color) {
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      line.forEach((wd) => {
        font(ctx, wd.weight, size, INTER, -0.01);
        ctx.fillText(wd.w, x + wd.x, y + i * lh);
      });
    });
  }

  function fitSize(ctx, s, weight, max, min, maxW, track) {
    let size = max;
    font(ctx, weight, size, INTER, track);
    while (textWidth(ctx, s) > maxW && size > min) { size -= 2; font(ctx, weight, size, INTER, track); }
    return size;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else {
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
  }
  function panel(ctx, x, y, w, h, r, fill, stroke) {
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  // ---------- Brand pieces ----------
  function background(ctx, W, H) {
    const lin = ctx.createLinearGradient(W * 0.33, 0, W * 0.67, H); // ~160deg
    lin.addColorStop(0, C.deepFrom); lin.addColorStop(1, C.deepTo);
    ctx.fillStyle = lin; ctx.fillRect(0, 0, W, H);
    const blobs = [
      { c: C.sky, a: 0.5, x: 0.10, y: 0.06, rx: 0.58, ry: 0.38 },
      { c: C.light, a: 0.3, x: 0.9, y: 0.16, rx: 0.42, ry: 0.32 },
      { c: C.royal, a: 0.55, x: 0.72, y: 0.72, rx: 0.62, ry: 0.42 },
      { c: C.soft, a: 0.26, x: 0.18, y: 0.96, rx: 0.56, ry: 0.3 },
    ];
    blobs.forEach((b) => {
      ctx.save();
      ctx.translate(b.x * W, b.y * H);
      ctx.scale(b.rx * W, b.ry * H);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, rgba(b.c, b.a)); g.addColorStop(0.4, rgba(b.c, b.a * 0.45)); g.addColorStop(1, rgba(b.c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    });
  }

  function halftone(ctx, W, H) {
    const step = 15, size = 5.2, R = Math.min(W, H) * 0.62;
    ctx.fillStyle = C.white;
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        const d = Math.hypot(W - x, H - y) / R;
        if (d >= 1) continue;
        const hash = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
        const a = 0.17 * Math.pow(1 - d, 1.6) * (0.55 + 0.45 * Math.abs(hash));
        if (a < 0.008) continue;
        ctx.globalAlpha = a;
        roundRect(ctx, x - size / 2, y - size / 2, size, size, 1.4);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function grid(ctx, W, H, xs, ys, coordSize, lowerCoord = true) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 9]);
    xs.forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); });
    ys.forEach((y) => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); });
    ctx.restore();
    drawTracked(ctx, '112', xs[1] - 8, ys[0] - 10, coordSize, 'rgba(255,255,255,0.42)', 'right', 0.04);
    if (lowerCoord) drawTracked(ctx, '064', xs[0] + 8, ys[1] + coordSize + 8, coordSize, 'rgba(255,255,255,0.42)', 'left', 0.04);
  }

  // Lockup geometry from the brand kit: 657 x 152 units, icon offset -3.04, wordmark at 187,12 (470 x 136).
  function lockup(ctx, x, y, h) {
    const k = h / 152;
    const size = 158.1 * k;
    const s = size / 260;
    ctx.save();
    ctx.translate(x - 3.04 * k + size / 2, y - 3.04 * k + size / 2);
    ctx.scale(s, s);
    ctx.fillStyle = C.white;
    logoPaths.forEach((p) => ctx.fill(p, 'evenodd'));
    ctx.restore();
    if (wordmark.complete && wordmark.naturalWidth) ctx.drawImage(wordmark, x + 187 * k, y + 12 * k, 470 * k, 136 * k);
    return 657 * k;
  }

  // ---------- Content blocks ----------
  const COPY = {
    label: 'ESTIMATED ANNUAL TIME COST',
    tag: 'SEARCH COST ESTIMATE',
    sub: 'Team time spent searching for answers each year.',
    subZero: 'No search time entered yet.',
    hoursLabel: 'Team hours a year spent searching.',
    daysLabel: 'Equivalent 8-hour working days, as combined person-days.',
    note: 'Estimates the value of employee time, not a direct cash expense or guaranteed saving.',
    site: 'heybrain.io',
  };

  function statPanel(ctx, x, y, w, value, label, o) {
    const pad = o.pad;
    const vSize = fitSize(ctx, value, 600, o.value, 20, w - pad * 2, -0.03);
    font(ctx, 400, o.label);
    const lines = wrap(ctx, label, w - pad * 2);
    const h = pad + o.value * 0.78 + o.gap + lines.length * o.lh + pad * 0.7;
    return {
      h,
      draw(hh = h) {
        panel(ctx, x, y, w, hh, o.r, 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.20)');
        font(ctx, 600, vSize, INTER, -0.03);
        ctx.fillStyle = C.white; ctx.textAlign = 'left';
        ctx.fillText(value, x + pad, y + pad + o.value * 0.74);
        font(ctx, 400, o.label);
        ctx.fillStyle = 'rgba(255,255,255,0.86)';
        lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + o.value * 0.78 + o.gap + o.label * 0.8 + i * o.lh));
      },
    };
  }

  function scenarioBlock(ctx, x, w, d, o) {
    if (d.zero || !d.reduction) return null;
    const tag = `HYPOTHETICAL · ${d.reduction}% LESS SEARCH TIME`;
    const segs = [
      { t: d.recHours, weight: 600 }, { t: 'hours recovered, worth', weight: 400 },
      { t: d.recValue, weight: 600 }, { t: 'in employee time.', weight: 400 },
    ];
    const lines = layoutRich(ctx, segs, o.text, w - o.pad * 2);
    const h = o.pad + o.tag + o.gap + lines.length * o.lh + o.pad * 0.6;
    return {
      h,
      draw(y) {
        panel(ctx, x, y, w, h, o.r, 'rgba(15,26,51,0.24)', null);
        drawTracked(ctx, tag, x + o.pad, y + o.pad + o.tag * 0.8, o.tag, C.ice);
        drawRich(ctx, lines, x + o.pad, y + o.pad + o.tag + o.gap + o.text * 0.8, o.text, o.lh, C.white);
      },
    };
  }

  // ---------- Layouts ----------
  function drawSquare(ctx, W, H, d) {
    const P = 88, CW = W - P * 2;
    background(ctx, W, H);
    halftone(ctx, W, H);
    const gTop = 156, gBot = H - 152;
    grid(ctx, W, H, [56, W - 56], [gTop, gBot], 15);

    lockup(ctx, P, 74, 44);
    drawTracked(ctx, COPY.tag, W - P, 74 + 30, 18, rgba(C.ice, 0.9), 'right');

    // Measure the main column, then centre it between the header and the basis line.
    const bigMax = 156;
    const bigSize = fitSize(ctx, d.cost, 600, bigMax, 40, CW, -0.04);
    font(ctx, 400, 32, INTER, -0.01);
    const subLines = wrap(ctx, d.zero ? COPY.subZero : COPY.sub, CW);
    const statW = (CW - 20) / 2;
    const so = { pad: 26, value: 58, label: 23, lh: 30, gap: 14, r: 20 };
    const s1 = statPanel(ctx, P, 0, statW, d.hours, COPY.hoursLabel, so);
    const s2 = statPanel(ctx, P + statW + 20, 0, statW, d.days, COPY.daysLabel, so);
    const statH = Math.max(s1.h, s2.h);
    const sc = scenarioBlock(ctx, P, CW, d, { pad: 26, tag: 17, text: 29, lh: 38, gap: 14, r: 20 });

    const blocks = 22 + 30 + bigSize * 0.76 + 34 + subLines.length * 42 + 36 + statH + (sc ? 20 + sc.h : 0);
    const top = gTop + 28, bottom = gBot - 74;
    let y = top + Math.max(0, (bottom - top - blocks) / 2);

    drawTracked(ctx, COPY.label, P, y + 18, 21, C.ice);
    y += 22 + 30;
    font(ctx, 600, bigSize, INTER, -0.04);
    ctx.fillStyle = C.white; ctx.textAlign = 'left';
    ctx.fillText(d.cost, P - bigSize * 0.04, y + bigSize * 0.74);
    y += bigSize * 0.76 + 34;
    font(ctx, 400, 32, INTER, -0.01);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    subLines.forEach((l, i) => ctx.fillText(l, P, y + 26 + i * 42));
    y += subLines.length * 42 + 36;
    // statPanel captured y=0, so translate for drawing
    ctx.save(); ctx.translate(0, y); s1.draw(statH); s2.draw(statH); ctx.restore();
    y += statH;
    if (sc) { y += 20; sc.draw(y); }

    // Basis line sits just above the lower grid line.
    drawTracked(ctx, d.basis.join(' · ').toUpperCase(), P, gBot - 30, 16, 'rgba(255,255,255,0.74)', 'left', 0.08);

    // Footer
    font(ctx, 400, 20, INTER, -0.005);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    const noteLines = wrap(ctx, COPY.note, CW - 220);
    noteLines.forEach((l, i) => ctx.fillText(l, P, gBot + 56 + i * 28));
    font(ctx, 600, 27, INTER, -0.02);
    ctx.fillStyle = C.white; ctx.textAlign = 'right';
    ctx.fillText(COPY.site, W - P, gBot + 66);
    ctx.textAlign = 'left';
  }

  function drawLandscape(ctx, W, H, d) {
    const P = 64;
    background(ctx, W, H);
    halftone(ctx, W, H);
    const gTop = 108, gBot = H - 100;
    grid(ctx, W, H, [40, W - 40], [gTop, gBot], 12, false);

    lockup(ctx, P, 46, 36);
    drawTracked(ctx, COPY.tag, W - P, 46 + 25, 15, rgba(C.ice, 0.9), 'right');

    const LW = 600, RX = P + LW + 48, RW = W - P - RX;

    // Left column: label, big number, sub line, scenario
    const bigSize = fitSize(ctx, d.cost, 600, 112, 36, LW, -0.04);
    font(ctx, 400, 23, INTER, -0.01);
    const subLines = wrap(ctx, d.zero ? COPY.subZero : COPY.sub, LW - 40);
    const sc = scenarioBlock(ctx, P, LW, d, { pad: 18, tag: 13, text: 20, lh: 27, gap: 10, r: 16 });
    const leftH = 16 + 22 + bigSize * 0.76 + 24 + subLines.length * 31 + (sc ? 22 + sc.h : 0);

    // Right column: stacked stats
    const so = { pad: 20, value: 44, label: 17, lh: 23, gap: 10, r: 16 };
    const s1 = statPanel(ctx, RX, 0, RW, d.hours, COPY.hoursLabel, so);
    const s2 = statPanel(ctx, RX, 0, RW, d.days, COPY.daysLabel, so);
    const rightH = s1.h + 14 + s2.h;

    const top = gTop + 24, bottom = gBot - 24, avail = bottom - top;
    let y = top + Math.max(0, (avail - leftH) / 2);
    drawTracked(ctx, COPY.label, P, y + 14, 16, C.ice);
    y += 16 + 22;
    font(ctx, 600, bigSize, INTER, -0.04);
    ctx.fillStyle = C.white; ctx.textAlign = 'left';
    ctx.fillText(d.cost, P - bigSize * 0.04, y + bigSize * 0.74);
    y += bigSize * 0.76 + 24;
    font(ctx, 400, 23, INTER, -0.01);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    subLines.forEach((l, i) => ctx.fillText(l, P, y + 19 + i * 31));
    y += subLines.length * 31;
    if (sc) { y += 22; sc.draw(y); }

    let ry = top + Math.max(0, (avail - rightH) / 2);
    ctx.save(); ctx.translate(0, ry); s1.draw(); ctx.restore();
    ry += s1.h + 14;
    ctx.save(); ctx.translate(0, ry); s2.draw(); ctx.restore();

    // Footer: basis + note, site on the right
    drawTracked(ctx, d.basis.join(' · ').toUpperCase(), P, gBot + 36, 13, 'rgba(255,255,255,0.74)', 'left', 0.08);
    font(ctx, 400, 15, INTER, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(COPY.note, P, gBot + 64);
    font(ctx, 600, 22, INTER, -0.02);
    ctx.fillStyle = C.white; ctx.textAlign = 'right';
    ctx.fillText(COPY.site, W - P, gBot + 56);
    ctx.textAlign = 'left';
  }

  function draw(canvas, format, data, scale = 1) {
    const f = FORMATS[format] || FORMATS.square;
    canvas.width = Math.round(f.w * scale);
    canvas.height = Math.round(f.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.textBaseline = 'alphabetic';
    if (format === 'landscape') drawLandscape(ctx, f.w, f.h, data);
    else drawSquare(ctx, f.w, f.h, data);
    if (hasSpacing) ctx.letterSpacing = '0px';
    return canvas;
  }

  window.HBImage = { ready, draw, FORMATS };
})();
