/* HeyBrain search cost calculator: state, input handling, formatting and results. */
(function () {
  'use strict';

  // ---------- Config ----------
  const CURRENCIES = {
    USD: { locale: 'en-US' },
    GBP: { locale: 'en-GB' },
    EUR: { locale: 'en-IE' },
    ZAR: { locale: 'en-ZA' },
  };

  // curve > 1 gives the slider more travel at the low end (most teams and rates sit there).
  const FIELDS = {
    team:      { min: 1, max: 1000, def: 20,  integer: true,  curve: 2.5, label: 'Team members' },
    minutes:   { min: 0, max: 180,  def: 30,  integer: false, curve: 1,   sliderStep: 1, label: 'Minutes per day' },
    cost:      {}, // filled from PAY_PERIODS for the selected period
    days:      { min: 1, max: 366,  def: 220, integer: true,  label: 'Working days' },
    reduction: { min: 0, max: 75,   def: 25,  integer: true,  curve: 1,   label: 'Reduction' },
    // AI token spend is entered per month in the chosen currency; 45% is HeyBrain's stated upper estimate.
    tokens:    { min: 0, max: 1000000, def: 2000, integer: false, curve: 3, sliderStep: 10, label: 'Monthly AI token spend' },
    tokencut:  { min: 0, max: 45,   def: 45,  integer: true,  curve: 1,   label: 'Token savings' },
  };
  const SLIDER_RES = 1000;
  const HOURS_PER_DAY = 8;

  // Pay can be entered per hour, day, month or year; it is converted to an hourly cost for the maths.
  // Ranges are wide enough for ZAR salaries, since amounts are never converted between currencies.
  const PAY_PERIODS = {
    hourly:  { min: 1,   max: 500,     def: 35,    integer: false, curve: 2,   sliderStep: 1,    decimals: 2, word: 'hourly',  per: 'hour',  label: 'Hourly cost' },
    daily:   { min: 1,   max: 20000,   def: 280,   integer: false, curve: 2.5, sliderStep: 1,    decimals: 0, word: 'daily',   per: 'day',   label: 'Daily cost' },
    monthly: { min: 50,  max: 250000,  def: 5000,  integer: false, curve: 2.5, sliderStep: 50,   decimals: 0, word: 'monthly', per: 'month', label: 'Monthly cost' },
    yearly:  { min: 500, max: 3000000, def: 60000, integer: false, curve: 2.5, sliderStep: 500,  decimals: 0, word: 'yearly',  per: 'year',  label: 'Yearly cost' },
  };
  const DEFAULT_PERIOD = 'monthly';
  Object.assign(FIELDS.cost, PAY_PERIODS[DEFAULT_PERIOD]);

  const state = { currency: 'USD', format: 'square', period: DEFAULT_PERIOD };
  Object.keys(FIELDS).forEach((k) => { state[k] = FIELDS[k].def; });
  // The pay amount as the user last entered it. The maths always uses this, so flipping between
  // hourly/daily/monthly/yearly only changes the display and never drifts the estimate through rounding.
  state.costSource = { period: DEFAULT_PERIOD, value: state.cost };
  const syncCostSource = () => { state.costSource = { period: state.period, value: state.cost }; };

  // Hours a year one person works, used to turn monthly/yearly pay into an hourly cost.
  const hoursPerYear = (s = state) => s.days * HOURS_PER_DAY;
  function toHourly(v, period, s = state) {
    switch (period) {
      case 'daily': return v / HOURS_PER_DAY;
      case 'monthly': return (v * 12) / hoursPerYear(s);
      case 'yearly': return v / hoursPerYear(s);
      default: return v;
    }
  }
  function fromHourly(h, period, s = state) {
    switch (period) {
      case 'daily': return h * HOURS_PER_DAY;
      case 'monthly': return (h * hoursPerYear(s)) / 12;
      case 'yearly': return h * hoursPerYear(s);
      default: return h;
    }
  }

  const $ = (id) => document.getElementById(id);

  // ---------- Formatting (full precision kept in state; rounding only here) ----------
  const nfCache = new Map();
  function nf(opts) {
    const locale = CURRENCIES[state.currency].locale;
    const key = locale + JSON.stringify(opts);
    if (!nfCache.has(key)) nfCache.set(key, new Intl.NumberFormat(locale, opts));
    return nfCache.get(key);
  }
  function fmtNum(v) {
    if (!isFinite(v)) return '–';
    if (v === 0) return '0';
    if (v < 0.1) return '<' + nf({ maximumFractionDigits: 1 }).format(0.1);
    const d = v >= 100 ? 0 : 1;
    return nf({ maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v);
  }
  function fmtMoney(v, opts = {}) {
    if (!isFinite(v)) return '–';
    const currency = state.currency;
    if (v > 0 && v < 0.01) return '<' + nf({ style: 'currency', currency, minimumFractionDigits: 2 }).format(0.01);
    // Whole units from 100 up; cents below, but drop ".00" on whole amounts.
    let d = v >= 100 || v === 0 ? 0 : 2;
    if (d === 2 && Math.abs(v - Math.round(v)) < 1e-9) d = 0;
    if (opts.rate) d = Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2;
    return nf({ style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  }
  function currencySymbol() {
    const part = nf({ style: 'currency', currency: state.currency }).formatToParts(1).find((p) => p.type === 'currency');
    return part ? part.value : state.currency;
  }
  // Plain value for editable fields: locale decimal mark, no grouping.
  function fmtInput(v) {
    return nf({ useGrouping: false, maximumFractionDigits: 2 }).format(v);
  }
  function fmtRangeText(k) {
    const f = FIELDS[k];
    const g = nf({ maximumFractionDigits: 0 });
    return `${g.format(f.min)} to ${g.format(f.max)}`;
  }

  // Accepts "1,000", "1 000", "35.50", "35,50", "$35" and similar.
  function parseNum(raw) {
    let s = String(raw).trim().replace(/[\s  ']/g, '').replace(/[^\d.,\-]/g, '');
    if (!s || s === '-' || s === '.' || s === ',') return NaN;
    if ((s.match(/-/g) || []).length > 1 || s.indexOf('-') > 0) return NaN;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    let dec = null; // which mark is the decimal point; the other is grouping
    if (lc > -1 && ld > -1) dec = lc > ld ? ',' : '.';
    else if (lc > -1) dec = /^-?\d*,\d{1,2}$/.test(s) ? ',' : null;        // "35,5" vs "1,000"
    else if (ld > -1) dec = (s.match(/\./g) || []).length === 1 ? '.' : null; // "35.5" vs "1.000.000"
    if (dec === null) {
      if (/[.,]/.test(s) && !/^-?\d{1,3}([.,]\d{3})+$/.test(s)) return NaN; // grouping must be in threes
      s = s.replace(/[.,]/g, '');
    }
    else {
      s = s.split(dec === ',' ? '.' : ',').join('');
      if (dec === ',') s = s.replace(',', '.');
    }
    if ((s.match(/\./g) || []).length > 1) return NaN;
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  // ---------- Calculation ----------
  function compute(s = state) {
    const hours = (s.team * s.minutes / 60) * s.days;
    const src = s.costSource || { period: s.period, value: s.cost };
    const hourly = toHourly(src.value, src.period, s);
    const cost = hours * hourly;
    const days8 = hours / HOURS_PER_DAY;
    const r = s.reduction / 100;
    const tokenMonth = s.tokens * s.tokencut / 100;
    return { hours, hourly, cost, days8, recHours: hours * r, recValue: cost * r, tokenMonth, tokenYear: tokenMonth * 12 };
  }

  // ---------- Slider mapping ----------
  const toPos = (k, v) => {
    const f = FIELDS[k];
    const t = (v - f.min) / (f.max - f.min);
    return Math.round(SLIDER_RES * Math.pow(Math.min(1, Math.max(0, t)), 1 / f.curve));
  };
  const fromPos = (k, p) => {
    const f = FIELDS[k];
    let v = f.min + (f.max - f.min) * Math.pow(p / SLIDER_RES, f.curve);
    const step = f.integer ? 1 : (f.sliderStep || 1);
    v = Math.round(v / step) * step;
    return Math.min(f.max, Math.max(f.min, v));
  };

  const perText = () => (FIELDS.cost.per === 'hour' ? 'an hour' : `a ${FIELDS.cost.per}`);

  function unitText(k, v) {
    switch (k) {
      case 'team': return `${fmtNum(v)} ${v === 1 ? 'person' : 'people'}`;
      case 'minutes': return `${fmtNum(v)} minutes a day`;
      case 'cost': return `${fmtMoney(v, { rate: true })} ${perText()}`;
      case 'reduction': return `${v}% reduction`;
      case 'tokens': return `${fmtMoney(v)} a month`;
      case 'tokencut': return `${v}% token savings`;
      default: return String(v);
    }
  }

  function setSlider(k) {
    const el = $(k + '-range');
    if (!el) return;
    const p = toPos(k, state[k]);
    el.value = p;
    el.style.setProperty('--pct', (p / SLIDER_RES * 100) + '%');
    el.setAttribute('aria-valuetext', unitText(k, state[k]));
  }

  function setError(k, msg) {
    const field = document.querySelector(`[data-field="${k}"]`);
    if (!field) return;
    field.classList.toggle('invalid', !!msg);
    $(k + '-err').textContent = msg || '';
    $(k + '-num').setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function validate(k, v) {
    const f = FIELDS[k];
    if (!isFinite(v)) return `Enter a number from ${fmtRangeText(k)}.`;
    if (v < f.min || v > f.max) return `Enter a number from ${fmtRangeText(k)}.`;
    return '';
  }

  // ---------- Wiring ----------
  Object.keys(FIELDS).forEach((k) => {
    const f = FIELDS[k];
    const num = $(k + '-num');
    const range = $(k + '-range');
    num.value = fmtInput(state[k]);

    if (range) {
      range.min = 0; range.max = SLIDER_RES; range.step = 1;
      range.addEventListener('input', () => {
        state[k] = fromPos(k, Number(range.value));
        if (k === 'cost') syncCostSource();
        num.value = fmtInput(state[k]);
        range.style.setProperty('--pct', (range.value / SLIDER_RES * 100) + '%');
        range.setAttribute('aria-valuetext', unitText(k, state[k]));
        setError(k, '');
        render();
      });
      // Arrow keys move by whole units in value space, not slider pixels.
      range.addEventListener('keydown', (e) => {
        const map = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
        let next;
        const unit = f.sliderStep || 1;
        if (e.key in map) next = Math.round(state[k] / unit) * unit + map[e.key] * unit * (k === 'team' && e.key.startsWith('Page') ? 5 : 1);
        else if (e.key === 'Home') next = f.min;
        else if (e.key === 'End') next = f.max;
        else return;
        e.preventDefault();
        state[k] = Math.min(f.max, Math.max(f.min, next));
        if (k === 'cost') syncCostSource();
        num.value = fmtInput(state[k]);
        setSlider(k);
        setError(k, '');
        render();
      });
    }

    num.addEventListener('input', () => {
      let v = parseNum(num.value);
      if (num.value.trim() === '') { setError(k, `Enter a number from ${fmtRangeText(k)}.`); return; }
      const msg = validate(k, v);
      setError(k, msg);
      if (msg) return;
      if (f.integer) v = Math.round(v);
      state[k] = Math.max(f.min, v);
      if (k === 'cost') syncCostSource();
      setSlider(k);
      render();
    });

    const commit = () => {
      let v = parseNum(num.value);
      if (!isFinite(v)) v = state[k];               // keep last good value
      v = Math.min(f.max, Math.max(f.min, v));      // clamp out-of-range entries
      if (f.integer) v = Math.round(v);
      const changed = v !== state[k];
      state[k] = v;
      if (k === 'cost' && changed) syncCostSource();
      num.value = fmtInput(v);
      setError(k, '');
      setSlider(k);
      render();
    };
    num.addEventListener('blur', commit);
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); num.select(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
        const base = isFinite(parseNum(num.value)) ? parseNum(num.value) : state[k];
        num.value = fmtInput(Math.min(f.max, Math.max(f.min, Math.round(base) + d)));
        commit();
      }
    });
    num.addEventListener('focus', () => num.select());
    setSlider(k);
  });

  document.querySelectorAll('input[name="currency"]').forEach((r) => {
    r.addEventListener('change', () => {
      state.currency = r.value;
      // Re-render editable values in the new locale's decimal format; amounts are not converted.
      Object.keys(FIELDS).forEach((k) => {
        if (document.activeElement !== $(k + '-num')) $(k + '-num').value = fmtInput(state[k]);
        setSlider(k);
      });
      render();
    });
  });

  // Switching pay period converts the current amount so the estimate stays put
  // (rounded to whole units for daily, monthly and yearly, cents for hourly).
  function applyPeriod(p, convert) {
    const hourly = toHourly(state.costSource.value, state.costSource.period);
    Object.keys(FIELDS.cost).forEach((key) => delete FIELDS.cost[key]);
    Object.assign(FIELDS.cost, PAY_PERIODS[p]);
    state.period = p;
    const f = FIELDS.cost;
    let v = convert ? fromHourly(hourly, p) : f.def;
    const m = Math.pow(10, f.decimals);
    v = Math.round(v * m) / m;
    state.cost = Math.min(f.max, Math.max(f.min, v));
    // Re-anchor on reset, or when the converted amount fell outside this period's range and was clamped.
    if (!convert || state.cost !== v) syncCostSource();
    $('per-' + p).checked = true;
    $('cost-num').value = fmtInput(state.cost);
    $('cost-label').textContent = `Average ${f.word} employee cost`;
    $('cost-range').setAttribute('aria-label', `Average ${f.word} employee cost`);
    $('cost-suffix').textContent = `/ ${f.per}`;
    setError('cost', '');
    setSlider('cost');
  }
  document.querySelectorAll('input[name="period"]').forEach((r) => {
    r.addEventListener('change', () => { applyPeriod(r.value, true); render(); });
  });

  document.querySelectorAll('input[name="format"]').forEach((r) => {
    r.addEventListener('change', () => { state.format = r.value; schedulePreview(0); });
  });

  $('reset').addEventListener('click', () => {
    applyPeriod(DEFAULT_PERIOD, false);
    Object.keys(FIELDS).forEach((k) => {
      state[k] = FIELDS[k].def;
      $(k + '-num').value = fmtInput(state[k]);
      setError(k, '');
      setSlider(k);
    });
    render();
  });

  // ---------- Rendering ----------
  function fitText(el, max, min) {
    el.style.fontSize = max + 'px';
    let size = max;
    while (el.scrollWidth > el.clientWidth && size > min) {
      size -= 2;
      el.style.fontSize = size + 'px';
    }
  }

  let lastResult = compute();
  function syncDisplayedCost() {
    const src = state.costSource;
    if (src.period === state.period) return;
    const f = FIELDS.cost;
    const m = Math.pow(10, f.decimals);
    const v = Math.min(f.max, Math.max(f.min, Math.round(fromHourly(toHourly(src.value, src.period), state.period) * m) / m));
    if (v === state.cost) return;
    state.cost = v;
    if (document.activeElement !== $('cost-num')) $('cost-num').value = fmtInput(v);
    setSlider('cost');
  }

  function render() {
    syncDisplayedCost();
    const r = compute();
    lastResult = r;

    $('r-cost').textContent = fmtMoney(r.cost);
    $('r-hours').textContent = fmtNum(r.hours);
    $('r-days').textContent = fmtNum(r.days8);
    $('r-rec-hours').textContent = fmtNum(r.recHours);
    $('r-rec-value').textContent = fmtMoney(r.recValue);
    $('r-tok-month').textContent = fmtMoney(r.tokenMonth);
    $('r-tok-year').textContent = fmtMoney(r.tokenYear);
    $('sticky-cost').textContent = fmtMoney(r.cost);
    $('zero-hint').hidden = r.hours !== 0;

    $('r-basis').textContent = basisText();
    $('days-current').textContent = `${fmtNum(state.days)} working days a year`;

    document.querySelectorAll('[data-cur-symbol]').forEach((el) => { el.textContent = currencySymbol(); });
    document.querySelectorAll('[data-cost-scale]').forEach((el) => { el.textContent = fmtMoney(FIELDS.cost[el.dataset.costScale], { rate: true }); });
    document.querySelectorAll('[data-money]').forEach((el) => { const [k, end] = el.dataset.money.split(':'); el.textContent = fmtMoney(FIELDS[k][end]); });
    $('cost-equiv').textContent = equivText(r.hourly);
    document.querySelectorAll('[data-fmt]').forEach((el) => { el.textContent = nf({}).format(Number(el.dataset.fmt)); });

    const big = $('r-cost');
    const w = big.parentElement.clientWidth;
    fitText(big, w < 420 ? 56 : 76, 28);
    document.querySelectorAll('.stat-value').forEach((el) => fitText(el, el.closest('.s-stat') ? 28 : 32, 16));

    schedulePreview();
  }

  // Shows what the entered pay means in the other unit, so the conversion is never hidden.
  function equivText(hourly) {
    const days = fmtNum(state.days);
    if (state.period === 'hourly') return `About ${fmtMoney(fromHourly(hourly, 'monthly'))} a month, at ${days} working days of ${HOURS_PER_DAY} hours a year.`;
    if (state.period === 'daily') return `About ${fmtMoney(hourly, { rate: true })} an hour, based on ${HOURS_PER_DAY}-hour days.`;
    return `About ${fmtMoney(hourly, { rate: true })} an hour, based on ${days} working days of ${HOURS_PER_DAY} hours a year.`;
  }

  function basisText() {
    const people = `${fmtNum(state.team)} ${state.team === 1 ? 'person' : 'people'}`;
    return `${people} × ${fmtNum(state.minutes)} min a day × ${fmtNum(state.days)} working days × ${fmtMoney(state.cost, { rate: true })} ${perText()}`;
  }

  // Data handed to the image renderer: display strings only, already rounded.
  function imageData() {
    const r = lastResult;
    return {
      cost: fmtMoney(r.cost),
      hours: fmtNum(r.hours),
      days: fmtNum(r.days8),
      recHours: fmtNum(r.recHours),
      recValue: fmtMoney(r.recValue),
      reduction: state.reduction,
      tokenSpend: fmtMoney(state.tokens),
      tokenYear: fmtMoney(r.tokenYear),
      tokenPct: state.tokencut,
      tokenShow: r.tokenYear > 0,
      zero: r.hours === 0,
      basis: [
        `${fmtNum(state.team)} ${state.team === 1 ? 'person' : 'people'}`,
        `${fmtNum(state.minutes)} min a day`,
        `${fmtMoney(state.cost, { rate: true })}/${FIELDS.cost.per}`,
        `${fmtNum(state.days)} working days`,
      ],
    };
  }

  // ---------- Preview + download ----------
  let previewTimer = null;
  function schedulePreview(delay = 140) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      window.HBImage.ready.then(() => window.HBImage.draw($('preview'), state.format, imageData(), 1));
    }, delay);
  }

  $('download').addEventListener('click', async () => {
    const btn = $('download');
    const status = $('dl-status');
    btn.disabled = true;
    status.textContent = 'Preparing your image…';
    try {
      await window.HBImage.ready;
      const canvas = document.createElement('canvas');
      window.HBImage.draw(canvas, state.format, imageData(), 2);
      const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
      const filename = `heybrain-search-cost-${state.format}.png`;
      const dims = state.format === 'square' ? '2160 × 2160' : '2400 × 1260';
      // Inside a claude.ai Artifact the page can't start downloads itself; it asks the viewer through the
      // `downloads` capability instead. Everywhere else, a normal browser download.
      const host = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
      if (host) {
        try {
          await host.save({filename, data: blob});
          status.textContent = `Saved ${filename} (${dims} px).`;
        } catch (e) {
          status.textContent = e && e.code === 'declined' ? 'Download cancelled.' : 'The download did not start. Right-click the preview and choose "Save image as" instead.';
        }
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      status.textContent = `Downloaded ${filename} (${dims} px).`;
    } catch (err) {
      console.error(err);
      status.textContent = 'The download did not start. Right-click the preview and choose "Save image as" instead.';
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Brand lockups ----------
  function buildLockups() {
    const A = window.HB_ASSETS;
    document.querySelectorAll('[data-lockup]').forEach((el) => {
      const ink = el.dataset.lockup === 'ink';
      const h = Number(el.dataset.height) || 30;
      const k = h / 152;
      el.style.width = 657 * k + 'px';
      el.style.height = 152 * k + 'px';
      const size = 158.1 * k;
      const color = ink ? '#34373A' : '#FFFFFF';
      el.innerHTML =
        `<svg viewBox="-130 -130 260 260" width="${size}" height="${size}" style="left:${-3.04 * k}px;top:${-3.04 * k}px" aria-hidden="true">` +
        A.logoPaths.map((d) => `<path d="${d}" fill="${color}" fill-rule="evenodd"/>`).join('') +
        `</svg><img src="${ink ? A.wordmarkInk : A.wordmarkWhite}" alt="HeyBrain" style="left:${187 * k}px;top:${12 * k}px;width:${470 * k}px;height:${136 * k}px">`;
    });
  }

  // ---------- Mobile sticky summary ----------
  function setupSticky() {
    const bar = $('sticky-sum');
    const results = $('results');
    const inputs = $('inputs');
    if (!('IntersectionObserver' in window)) return;
    let resultsVisible = false, inputsVisible = true;
    const update = () => bar.classList.toggle('show', inputsVisible && !resultsVisible);
    new IntersectionObserver(([e]) => { resultsVisible = e.isIntersecting; update(); }, { threshold: 0.15 }).observe(results);
    new IntersectionObserver(([e]) => { inputsVisible = e.isIntersecting; update(); }, { threshold: 0 }).observe(inputs);
  }

  buildLockups();
  setupSticky();
  render();
  window.addEventListener('resize', () => render());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => render());

  // Exposed for testing in the console.
  window.HBCalc = { state, compute, toHourly, fromHourly, parseNum, fmtMoney, fmtNum, render, imageData };
})();
