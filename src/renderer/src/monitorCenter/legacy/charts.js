const THEME_PALETTES = {
  amber: {
    amber: '#ffb000', amberHi: '#ffd25e', amberDim: '#8a6200',
    toxic: '#9dff3f', cyan: '#4fd8c9', red: '#ff4438',
    bone: '#ece0c4', dim: '#9a8a68', grid: 'rgba(255,176,0,0.08)'
  },
  pipboy: {
    amber: '#35ff70', amberHi: '#c9ffdc', amberDim: '#1d7a3c',
    toxic: '#a4ff4f', cyan: '#37e6c3', red: '#ff4b41',
    bone: '#dcfbe4', dim: '#63ab78', grid: 'rgba(53,255,112,0.09)'
  }
};

export const PAL = Object.assign({}, THEME_PALETTES.amber);

export function setChartTheme(name) {
  Object.assign(PAL, THEME_PALETTES[name] || THEME_PALETTES.amber);
}

function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawGrid(ctx, w, h, pad, rows = 4, cols = 5) {
  ctx.strokeStyle = PAL.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= rows; i++) {
    const y = pad.t + (h - pad.t - pad.b) * i / rows;
    ctx.moveTo(pad.l, y + .5); ctx.lineTo(w - pad.r, y + .5);
  }
  for (let i = 0; i <= cols; i++) {
    const x = pad.l + (w - pad.l - pad.r) * i / cols;
    ctx.moveTo(x + .5, pad.t); ctx.lineTo(x + .5, h - pad.b);
  }
  ctx.stroke();
}

const validNumber = v => v !== null && v !== '' && Number.isFinite(Number(v));
const chartNumber = v => {
  const n = Number(v);
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1).replace(/\.0$/, '');
  return n.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
};
const chartTime = v => {
  if (v === null || v === undefined) return '--:--:--';
  const raw = typeof v === 'number' && v < 1e12 ? v * 1000 : v;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '--:--:--' : d.toLocaleTimeString('zh-CN', { hour12: false });
};

function bindChartEvents(canvas) {
  const state = canvas.__chartState;
  if (state.bound) return;
  canvas.addEventListener('mousemove', e => {
    const current = canvas.__chartState;
    if (!current?.interactive) return;
    const rect = canvas.getBoundingClientRect();
    current.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    current.draw?.();
  });
  canvas.addEventListener('mouseleave', () => {
    const current = canvas.__chartState;
    if (!current?.mouse) return;
    current.mouse = null;
    current.draw?.();
  });
  state.bound = true;
}

export function lineChart(canvas, series, opts = {}) {
  const state = canvas.__chartState || (canvas.__chartState = { mouse: null, bound: false });
  state.interactive = Boolean(opts.tooltip);
  state.draw = () => {
    const fitted = fitCanvas(canvas);
    if (!fitted) return;
    const { ctx, w, h } = fitted;
    ctx.clearRect(0, 0, w, h);
    const axes = Boolean(opts.axes);
    const dualAxis = axes && Array.isArray(opts.yAxes) && opts.yAxes.length > 1;
    const pad = Object.assign(axes ? { t: 25, r: dualAxis ? 43 : 9, b: 23, l: 43 } : { t: 8, r: 6, b: 6, l: 6 }, opts.pad || {});
    const colors = opts.colors || [PAL.amber, PAL.toxic, PAL.cyan, PAL.red];
    const raw = Array.isArray(series) ? series : [];
    const n = Math.max(0, ...raw.map(s => Array.isArray(s) ? s.length : 0));
    const data = raw.map(s => {
      const values = Array.isArray(s) ? s.map(v => validNumber(v) ? Number(v) : null) : [];
      return Array(n - values.length).fill(null).concat(values);
    });
    if (!n || !data.some(s => s.some(validNumber))) return;

    const seriesAxes = opts.seriesAxes || data.map(() => 0);
    const axisCount = dualAxis ? 2 : 1;
    const ranges = Array.from({ length: axisCount }, (_, ai) => {
      const values = data.flatMap((s, si) => seriesAxes[si] === ai ? s.filter(validNumber) : []);
      const config = opts.yAxes?.[ai] || {};
      let min = config.min !== undefined ? config.min : (ai === 0 && opts.min !== undefined ? opts.min : (opts.zero ? 0 : Math.min(...values, 0)));
      let max = config.max !== undefined ? config.max : (ai === 0 && opts.max !== undefined ? opts.max : Math.max(...values, 1) * 1.15);
      if (max <= min) max = min + 1;
      return { min, max, unit: config.unit || opts.units?.[ai] || '' };
    });
    const iw = Math.max(1, w - pad.l - pad.r), ih = Math.max(1, h - pad.t - pad.b);
    const px = i => pad.l + iw * (n <= 1 ? 1 : i / (n - 1));
    const py = (v, ai) => pad.t + ih * (1 - (v - ranges[ai].min) / (ranges[ai].max - ranges[ai].min));

    if (opts.grid !== false) drawGrid(ctx, w, h, pad, axes ? 4 : 3, axes ? 5 : 6);

    if (axes) {
      ctx.font = '9px "Cascadia Mono", Consolas, monospace';
      ctx.fillStyle = PAL.dim;
      ctx.textBaseline = 'middle';
      for (let ai = 0; ai < axisCount; ai++) {
        ctx.textAlign = ai === 0 ? 'right' : 'left';
        for (let tick = 0; tick <= 4; tick++) {
          const value = ranges[ai].max - (ranges[ai].max - ranges[ai].min) * tick / 4;
          ctx.fillText(chartNumber(value), ai === 0 ? pad.l - 5 : w - pad.r + 5, pad.t + ih * tick / 4);
        }
      }
      const timestamps = Array(n - Math.min(n, opts.timestamps?.length || 0)).fill(null).concat((opts.timestamps || []).slice(-n));
      const labelCount = Math.min(6, n);
      const indices = [...new Set(Array.from({ length: labelCount }, (_, i) => Math.round(i * (n - 1) / Math.max(1, labelCount - 1))))];
      ctx.textBaseline = 'top';
      indices.forEach((index, i) => {
        ctx.textAlign = i === 0 ? 'left' : i === indices.length - 1 ? 'right' : 'center';
        ctx.fillText(chartTime(timestamps[index]), px(index), h - pad.b + 5);
      });

      const names = opts.seriesNames || [];
      let legendX = pad.l;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      data.forEach((_, si) => {
        if (!names[si]) return;
        const text = `${names[si]} ${opts.units?.[si] || ''}`.trim();
        ctx.fillStyle = colors[si % colors.length];
        ctx.fillRect(legendX, 7, 9, 2);
        ctx.fillStyle = PAL.bone;
        ctx.fillText(text, legendX + 13, 8);
        legendX += 20 + ctx.measureText(text).width;
      });
    }

    data.forEach((s, si) => {
      const color = colors[si % colors.length], ai = seriesAxes[si] || 0;
      const points = s.map((v, i) => validNumber(v) ? { x: px(i), y: py(v, ai), v, i } : null).filter(Boolean);
      if (!points.length) return;
      if (opts.fill !== false && si === 0) {
        const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
        grad.addColorStop(0, color + '3d'); grad.addColorStop(1, color + '00');
        ctx.beginPath(); ctx.moveTo(points[0].x, h - pad.b);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, h - pad.b); ctx.closePath();
        ctx.fillStyle = grad; ctx.fill();
      }
      ctx.beginPath();
      points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.strokeStyle = color; ctx.lineWidth = si === 0 ? 1.6 : 1.2;
      ctx.shadowColor = color; ctx.shadowBlur = 7; ctx.stroke(); ctx.shadowBlur = 0;
      const last = points[points.length - 1];
      ctx.beginPath(); ctx.arc(last.x, last.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
    });

    if (opts.threshold !== undefined) {
      const y = py(opts.threshold, 0);
      ctx.strokeStyle = PAL.red; ctx.setLineDash([5, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, y + .5); ctx.lineTo(w - pad.r, y + .5); ctx.stroke(); ctx.setLineDash([]);
    }

    if (state.interactive && state.mouse && state.mouse.x >= pad.l && state.mouse.x <= w - pad.r) {
      const index = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((state.mouse.x - pad.l) / iw * (n - 1))));
      const x = px(index);
      ctx.strokeStyle = PAL.bone + '99'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x + .5, pad.t); ctx.lineTo(x + .5, h - pad.b); ctx.stroke(); ctx.setLineDash([]);
      const lines = [];
      data.forEach((s, si) => {
        const v = s[index]; if (!validNumber(v)) return;
        const color = colors[si % colors.length], y = py(v, seriesAxes[si] || 0);
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        lines.push({ color, text: `${opts.seriesNames?.[si] || `SERIES ${si + 1}`}: ${chartNumber(v)} ${opts.units?.[si] || ''}`.trim() });
      });
      const timestamps = opts.timestamps || [];
      const timeIndex = timestamps.length - n + index;
      const texts = [chartTime(timeIndex >= 0 ? timestamps[timeIndex] : null), ...lines.map(line => line.text)];
      ctx.font = '10px "Cascadia Mono", Consolas, monospace';
      const tw = Math.max(...texts.map(text => ctx.measureText(text).width)) + 18, th = 10 + texts.length * 15;
      let tx = x + 9; if (tx + tw > w - 3) tx = x - tw - 9;
      const ty = Math.max(3, Math.min(h - th - 3, state.mouse.y - th / 2));
      ctx.fillStyle = 'rgba(10,8,5,.94)'; ctx.fillRect(tx, ty, tw, th);
      ctx.strokeStyle = PAL.amberDim; ctx.strokeRect(tx + .5, ty + .5, tw - 1, th - 1);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = PAL.bone;
      ctx.fillText(texts[0], tx + 9, ty + 11);
      lines.forEach((line, i) => { ctx.fillStyle = line.color; ctx.fillText(line.text, tx + 9, ty + 26 + i * 15); });
    }
  };
  bindChartEvents(canvas);
  state.draw();
}

export function gauge(canvas, value, opts = {}) {
  const fitted = fitCanvas(canvas);
  if (!fitted) return;
  const { ctx, w, h } = fitted;
  const max = opts.max || 100;
  const pct = Math.max(0, Math.min(1, value / max));
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2 - 7;
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  const color = opts.color || (pct > 0.9 ? PAL.red : pct > 0.72 ? PAL.amber : PAL.toxic);

  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.strokeStyle = '#241e12';
  ctx.lineWidth = 8;
  ctx.stroke();

  const segs = 40;
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + (a1 - a0) * i / segs;
    const t1 = a0 + (a1 - a0) * (i + 0.62) / segs;
    if (i / segs > pct) break;
    ctx.beginPath();
    ctx.arc(cx, cy, r, t0, t1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  const na = a0 + (a1 - a0) * pct;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(na) * (r - 12), cy + Math.sin(na) * (r - 12));
  ctx.strokeStyle = PAL.bone;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = PAL.bone;
  ctx.fill();

  ctx.fillStyle = color;
  ctx.font = `700 ${Math.round(r * 0.42)}px Bahnschrift, "Arial Narrow", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillText(opts.text !== undefined ? opts.text : `${Math.round(value)}`, cx, cy + r * 0.34);
  ctx.shadowBlur = 0;
  if (opts.unit) {
    ctx.fillStyle = PAL.dim;
    ctx.font = `9px "Cascadia Mono", Consolas, monospace`;
    ctx.fillText(opts.unit, cx, cy + r * 0.34 + r * 0.3);
  }
}

export function sparkline(canvas, data, color = PAL.amber, opts = {}) {
  lineChart(canvas, [data], Object.assign({ grid: false, colors: [color], fill: true, zero: true }, opts));
}

export function hbars(canvas, items, opts = {}) {
  const fitted = fitCanvas(canvas);
  if (!fitted) return;
  const { ctx, w, h } = fitted;
  if (!items.length) return;
  const max = Math.max(...items.map(i => i.value), 1);
  const rowH = h / items.length;
  const labelW = opts.labelW || 108;
  ctx.textBaseline = 'middle';
  items.forEach((it, i) => {
    const y = rowH * i + rowH / 2;
    ctx.fillStyle = PAL.dim;
    ctx.font = '9.5px "Cascadia Mono", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(it.label.slice(0, 16), 2, y);
    const bw = (w - labelW - 46) * (it.value / max);
    const color = it.color || PAL.amber;
    ctx.fillStyle = '#0d0a06';
    ctx.fillRect(labelW, y - 5, w - labelW - 46, 10);
    const grad = ctx.createLinearGradient(labelW, 0, labelW + bw, 0);
    grad.addColorStop(0, color + '66');
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.fillRect(labelW, y - 5, Math.max(bw, 2), 10);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PAL.bone;
    ctx.textAlign = 'right';
    ctx.fillText(it.text !== undefined ? it.text : String(Math.round(it.value)), w - 4, y);
  });
}

export function donut(canvas, parts, opts = {}) {
  const fitted = fitCanvas(canvas);
  if (!fitted) return;
  const { ctx, w, h } = fitted;
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2 - 8;
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  let a = -Math.PI / 2;
  parts.forEach(p => {
    const sweep = Math.PI * 2 * p.value / total;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a + 0.02, a + sweep - 0.02);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = opts.thick || 11;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 7;
    ctx.stroke();
    a += sweep;
  });
  ctx.shadowBlur = 0;
  if (opts.center) {
    ctx.fillStyle = PAL.bone;
    ctx.font = `700 ${Math.round(r * 0.4)}px Bahnschrift, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(opts.center, cx, cy - 6);
    ctx.fillStyle = PAL.dim;
    ctx.font = '9px "Cascadia Mono", Consolas, monospace';
    ctx.fillText(opts.centerSub || '', cx, cy + 12);
  }
}
