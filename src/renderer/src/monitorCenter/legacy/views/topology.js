// 应用拓扑发现(替换原项目的星型网络拓扑,保持同一套视觉语言:切角框、网格底、流动脉冲)。
// 「发现 / 更新」都由用户手动触发,主进程逐台主机执行,每完成一台就推送新的拓扑。
import { get, post, toast, store, fmtTime } from '../api.js';
import { PAL } from '../charts.js';
import { openDeviceDrawer } from '../drawer.js';
import { frameLoop, listen, onDispose, visible } from '../dom.js';

let root = null;
let canvas = null;
let topo = { discoveredAt: null, hosts: [], services: [], edges: [] };
let progress = { running: false, index: 0, total: 0, phase: 'done' };
let mode = 'host';
let view = { scale: 1, ox: 0, oy: 0 };
let userMoved = false;
let layoutKey = '';
let nodes = new Map();
let frames = [];
let hoverId = null;
let selected = null;
let pulseT = 0;
let drag = null;
let wakeLoop = () => {};
const filters = { gateway: true, app: true, llm: true, data: true, external: true, infra: false };

const NODE_W = 168, NODE_H = 50;
const LAYERS = ['gateway', 'app', 'llm', 'data', 'infra', 'external'];
const CAT_LABEL = { gateway: '网关', app: '应用', llm: '模型', data: '数据 / 中间件', infra: '基础设施', external: '外部' };
const DEPLOY = { docker: 'DOCKER', k8s: 'K8S', systemd: 'SYSTEMD', process: 'PROC', external: 'EXT' };
const DEPLOY_TEXT = { docker: 'Docker 容器', k8s: 'Kubernetes', systemd: 'systemd 服务', process: '直接部署（进程）', external: '外部 / 未纳管' };
const EDGE_TEXT = { proxy: '反向代理', conn: 'TCP 连接', config: '配置引用' };

const catColor = c => ({ gateway: PAL.cyan, app: PAL.amber, llm: PAL.toxic, data: '#e08bff', infra: PAL.dim, external: '#ff8a4f' })[c] || PAL.amber;
const edgeColor = k => ({ proxy: PAL.cyan, conn: PAL.amber, config: PAL.dim })[k] || PAL.amber;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function mount(el) {
  root = el;
  selected = null; hoverId = null; userMoved = false; layoutKey = '';
  root.innerHTML = `
    <div class="topo-wrap">
      <div class="panel topo-panel">
        <canvas id="topo-canvas"></canvas>
        <div style="position:absolute;top:12px;left:14px" class="panel-t">应用拓扑 · TOPOLOGY DISCOVERY</div>
        <div class="topo-toolbar">
          <div class="skin-sw" id="topo-mode">
            <button class="skin-btn active" data-mode="host">主机视图</button>
            <button class="skin-btn" data-mode="app">应用视图</button>
          </div>
          <button class="btn ghost sm" id="topo-fit">适配</button>
          <button class="btn ghost sm" id="topo-cancel" style="display:none">取消</button>
          <button class="btn toxic sm" id="topo-discover">发现</button>
        </div>
        <div class="topo-progress" id="topo-progress"></div>
        <div style="position:absolute;bottom:10px;left:14px" class="topo-legend" id="topo-legend"></div>
        <div class="topo-zoom" id="topo-zoom"></div>
        <div class="topo-empty" id="topo-empty"></div>
      </div>
      <div class="topo-side">
        <div class="panel">
          <div class="panel-t">发现状态 <span class="tail">HOSTS · 手动发现</span></div>
          <div id="topo-hosts"></div>
        </div>
        <div class="panel">
          <div class="panel-t">节点详情 <span class="tail">CLICK NODE</span></div>
          <div id="topo-detail"><div class="topo-muted">点击图中的服务或主机查看详情</div></div>
        </div>
        <div class="panel">
          <div class="panel-t">显示 <span class="tail">FILTER</span></div>
          <div id="topo-filter" class="topo-filter"></div>
        </div>
        <div class="panel">
          <div class="panel-t">关系链路 <span class="tail" id="topo-edge-count">LINKS</span></div>
          <div id="topo-edges"></div>
        </div>
      </div>
    </div>`;
  canvas = root.querySelector('#topo-canvas');
  renderLegend();
  renderFilter();

  listen(canvas, 'mousedown', onDown);
  listen(window, 'mousemove', onMove);
  listen(window, 'mouseup', onUp);
  listen(canvas, 'wheel', onWheel, { passive: false });
  listen(canvas, 'dblclick', onDblClick);
  listen(canvas, 'mouseleave', () => { hoverId = null; });

  root.querySelector('#topo-mode').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    mode = b.dataset.mode;
    root.querySelectorAll('#topo-mode .skin-btn').forEach(x => x.classList.toggle('active', x === b));
    layoutKey = ''; userMoved = false;
    relayout();
  });
  root.querySelector('#topo-fit').addEventListener('click', () => { userMoved = false; fit(); });
  root.querySelector('#topo-discover').addEventListener('click', () => discover());
  root.querySelector('#topo-cancel').addEventListener('click', () => post('/api/discover/cancel').catch(() => {}));
  root.querySelector('#topo-hosts').addEventListener('click', e => {
    const b = e.target.closest('[data-rediscover]');
    if (b) return discover([b.dataset.rediscover]);
    const row = e.target.closest('[data-host]');
    if (row) { selected = { type: 'host', id: row.dataset.host }; renderDetail(); }
  });
  root.querySelector('#topo-detail').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'rediscover') discover([b.dataset.id]);
    if (b.dataset.act === 'drawer') openDeviceDrawer(b.dataset.id);
    if (b.dataset.act === 'goto') { selected = { type: 'node', id: b.dataset.id }; renderDetail(); focusNode(b.dataset.id); }
  });
  root.querySelector('#topo-edges').addEventListener('click', e => {
    const row = e.target.closest('[data-goto]');
    if (row) { selected = { type: 'node', id: row.dataset.goto }; renderDetail(); focusNode(row.dataset.goto); }
  });
  root.querySelector('#topo-filter').addEventListener('change', e => {
    const cb = e.target.closest('[data-cat]');
    if (!cb) return;
    filters[cb.dataset.cat] = cb.checked;
    layoutKey = '';
    relayout();
  });

  const mc = window.api.monitorCenter;
  onDispose(mc.onTopology(t => { topo = t; relayout(); renderSide(); }));
  onDispose(mc.onDiscovery(p => {
    progress = p;
    renderProgress();
    renderHosts();
    if (p.phase === 'done') toast(`拓扑发现完成：${p.total} 台主机`);
    if (p.phase === 'cancelled') toast('拓扑发现已取消');
    if (p.error && p.phase === 'hostDone') toast(`${p.hostName}：${p.error}`, true);
  }));
  load();
  // 只有拓扑页处于当前视图、且模块在屏幕上时才逐帧绘制;其余时间循环完全停止
  wakeLoop = frameLoop(draw, () => !!root && root.classList.contains('active') && visible());
}

export function refresh() { load(); wakeLoop(); }

async function load() {
  try {
    const r = await get('/api/topology');
    topo = r.topology;
    progress = r.progress;
    relayout();
    renderSide();
    renderProgress();
  } catch (e) { /* 保持旧数据 */ }
}

async function discover(hostIds) {
  try {
    await post('/api/discover', hostIds ? { hostIds } : {});
  } catch (e) { toast(e.message, true); }
}

// ---------- 布局 ----------

function visibleServices() {
  return (topo.services || []).filter(s => filters[s.category] !== false);
}

function relayout() {
  const list = visibleServices();
  const key = `${mode}|${list.map(s => s.id).join(',')}`;
  const changed = key !== layoutKey;
  layoutKey = key;
  nodes = new Map();
  frames = [];
  if (mode === 'host') layoutHosts(list); else layoutLayers(list);
  if (changed && !userMoved) fit();
  const empty = root.querySelector('#topo-empty');
  empty.innerHTML = topo.discoveredAt ? (list.length ? '' : '<div>当前筛选下没有可显示的服务</div>')
    : '<div class="topo-empty-t">尚未进行拓扑发现</div><div>点击右上角「发现」，将依次登录已启用监控的主机，识别直接部署 / Docker 部署的服务、nginx 反向代理、vLLM 等模型服务以及它们之间的连接关系。</div>';
}

function sortSvc(a, b) {
  return LAYERS.indexOf(a.category) - LAYERS.indexOf(b.category) || String(a.name).localeCompare(String(b.name));
}

function layoutHosts(list) {
  const byHost = new Map();
  for (const h of topo.hosts || []) byHost.set(h.hostId, []);
  const ext = [];
  for (const s of list) {
    if (!s.hostId) { ext.push(s); continue; }
    if (!byHost.has(s.hostId)) byHost.set(s.hostId, []);
    byHost.get(s.hostId).push(s);
  }
  const groups = [...byHost.entries()].map(([id, svcs]) => ({ id, svcs: svcs.sort(sortSvc), host: (topo.hosts || []).find(h => h.hostId === id) }));
  if (ext.length) groups.push({ id: '__ext', svcs: ext.sort(sortSvc), host: null });
  const cols = Math.max(1, Math.min(groups.length, Math.ceil(Math.sqrt(groups.length * 1.6))));
  const FW = NODE_W + 36, GAP_X = 70, GAP_Y = 60, HEAD = 46, ROW = NODE_H + 16;
  let x = 0, y = 0, rowH = 0;
  groups.forEach((g, i) => {
    if (i && i % cols === 0) { x = 0; y += rowH + GAP_Y; rowH = 0; }
    const h = HEAD + Math.max(1, g.svcs.length) * ROW + 10;
    frames.push({ id: g.id, x, y, w: FW, h, host: g.host, count: g.svcs.length });
    g.svcs.forEach((s, j) => nodes.set(s.id, { s, x: x + FW / 2, y: y + HEAD + j * ROW + NODE_H / 2 }));
    x += FW + GAP_X;
    rowH = Math.max(rowH, h);
  });
}

function layoutLayers(list) {
  const layers = LAYERS.map(c => list.filter(s => s.category === c).sort((a, b) => String(a.hostId).localeCompare(String(b.hostId)) || String(a.name).localeCompare(String(b.name)))).filter(l => l.length);
  const perRow = Math.max(5, Math.ceil(Math.sqrt(list.length) * 1.6));
  const GX = NODE_W + 26, GY = NODE_H + 30, LAYER_GAP = 46;
  let y = 0;
  for (const layer of layers) {
    const rows = Math.ceil(layer.length / perRow);
    for (let r = 0; r < rows; r++) {
      const items = layer.slice(r * perRow, (r + 1) * perRow);
      const width = items.length * GX;
      items.forEach((s, i) => nodes.set(s.id, { s, x: -width / 2 + i * GX + GX / 2, y: y + r * GY }));
    }
    frames.push({ id: `layer:${layer[0].category}`, layer: layer[0].category, x: -perRow * GX / 2 - 30, y: y - NODE_H / 2 - 22, w: perRow * GX + 60, h: rows * GY + 22, count: layer.length });
    y += rows * GY + LAYER_GAP;
  }
}

function bounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of frames) { x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h); }
  for (const n of nodes.values()) { x0 = Math.min(x0, n.x - NODE_W / 2); y0 = Math.min(y0, n.y - NODE_H / 2); x1 = Math.max(x1, n.x + NODE_W / 2); y1 = Math.max(y1, n.y + NODE_H / 2); }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

function fit() {
  const b = bounds();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!b || !w || !h) { view = { scale: 1, ox: w / 2, oy: h / 2 }; return; }
  const padTop = 60, pad = 40;
  const scale = Math.max(0.25, Math.min(1.25, (w - pad * 2) / (b.x1 - b.x0 || 1), (h - padTop - pad) / (b.y1 - b.y0 || 1)));
  view = { scale, ox: (w - (b.x1 - b.x0) * scale) / 2 - b.x0 * scale, oy: padTop + (h - padTop - pad - (b.y1 - b.y0) * scale) / 2 - b.y0 * scale };
}

function focusNode(id) {
  const n = nodes.get(id);
  if (!n) return;
  userMoved = true;
  view.ox = canvas.clientWidth / 2 - n.x * view.scale;
  view.oy = canvas.clientHeight / 2 - n.y * view.scale;
}

// ---------- 绘制 ----------

function chamfer(ctx, x, y, w, h, c) {
  ctx.beginPath();
  ctx.moveTo(x + c, y); ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x, y + h); ctx.lineTo(x, y + c);
  ctx.closePath();
}

function fitText(ctx, text, max) {
  text = String(text ?? '');
  if (ctx.measureText(text).width <= max) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1);
  return text + '…';
}

function deviceAlert(hostId) {
  return (store.devices || []).find(d => d.id === hostId)?.alert;
}

function related(id) {
  const set = new Set([id]);
  for (const e of topo.edges || []) {
    if (e.from === id) set.add(e.to);
    if (e.to === id) set.add(e.from);
  }
  return set;
}

function edgePath(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  // 同一列(同一主机框里上下排列)的服务:从右侧绕弧,避免穿过中间的节点
  if (Math.abs(dx) < NODE_W / 2) {
    const off = NODE_W / 2 + 16 + Math.min(70, Math.abs(dy) * 0.12);
    return [a.x, a.y, a.x + off * 1.6, a.y, b.x + off * 1.6, b.y, b.x, b.y];
  }
  if (Math.abs(dy) > Math.abs(dx) * 0.6) {
    const k = dy / 2;
    return [a.x, a.y, a.x, a.y + k, b.x, b.y - k, b.x, b.y];
  }
  const k = dx / 2;
  return [a.x, a.y, a.x + k, a.y, b.x - k, b.y, b.x, b.y];
}

function bez(p, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6],
    y: u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7]
  };
}

function inBox(pt, n, m = 2) {
  return Math.abs(pt.x - n.x) <= NODE_W / 2 + m && Math.abs(pt.y - n.y) <= NODE_H / 2 + m;
}

function draw() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (!userMoved) fit();
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // 网格底(随平移移动,与原拓扑页同款 44px)
  ctx.strokeStyle = PAL.grid;
  ctx.lineWidth = 1;
  const gs = 44 * view.scale;
  const gx = ((view.ox % gs) + gs) % gs, gy = ((view.oy % gs) + gs) % gs;
  ctx.beginPath();
  for (let x = gx; x < w; x += gs) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, h); }
  for (let y = gy; y < h; y += gs) { ctx.moveTo(0, y + .5); ctx.lineTo(w, y + .5); }
  ctx.stroke();

  pulseT = (pulseT + 0.006) % 1;
  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);

  for (const f of frames) drawFrame(ctx, f);

  const focus = selected?.type === 'node' ? selected.id : hoverId;
  const rel = focus ? related(focus) : null;

  for (const e of topo.edges || []) {
    const a = nodes.get(e.from), b = nodes.get(e.to);
    if (!a || !b) continue;
    const on = !rel || (rel.has(e.from) && rel.has(e.to) && (e.from === focus || e.to === focus));
    drawEdge(ctx, e, a, b, on, !!rel);
  }
  for (const n of nodes.values()) {
    drawNode(ctx, n, !rel || rel.has(n.s.id), n.s.id === focus || (selected?.type === 'node' && selected.id === n.s.id));
  }
  ctx.restore();
  root.querySelector('#topo-zoom').textContent = `${Math.round(view.scale * 100)}%`;
}

function drawFrame(ctx, f) {
  if (f.layer) {
    ctx.strokeStyle = catColor(f.layer) + '33';
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.setLineDash([]);
    ctx.fillStyle = catColor(f.layer);
    ctx.font = '700 11px Bahnschrift, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${CAT_LABEL[f.layer]} · ${f.count}`, f.x + 8, f.y + 14);
    return;
  }
  const host = f.host;
  const alert = host ? deviceAlert(host.hostId) : null;
  const color = !host ? '#ff8a4f' : host.status === 'error' ? PAL.red : alert === 'crit' ? PAL.red : alert === 'warn' ? PAL.amber : PAL.cyan;
  const sel = selected?.type === 'host' && host && selected.id === host.hostId;
  chamfer(ctx, f.x, f.y, f.w, f.h, 12);
  ctx.fillStyle = 'rgba(20,17,10,0.72)';
  ctx.fill();
  ctx.strokeStyle = color + (sel ? 'ff' : '88');
  ctx.lineWidth = sel ? 2 : 1.2;
  ctx.shadowColor = color; ctx.shadowBlur = sel ? 14 : 4;
  ctx.stroke(); ctx.shadowBlur = 0;
  // 顶部危险条纹
  ctx.save();
  chamfer(ctx, f.x, f.y, f.w, 5, 4); ctx.clip();
  for (let i = -10; i < f.w + 10; i += 14) {
    ctx.fillStyle = i % 28 === 0 ? color + 'cc' : '#161207';
    ctx.beginPath(); ctx.moveTo(f.x + i, f.y); ctx.lineTo(f.x + i + 7, f.y); ctx.lineTo(f.x + i + 2, f.y + 5); ctx.lineTo(f.x + i - 5, f.y + 5); ctx.fill();
  }
  ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PAL.bone;
  ctx.font = '700 13px Bahnschrift, sans-serif';
  ctx.fillText(fitText(ctx, host ? host.name : '外部 / 未纳管节点', f.w - 60), f.x + 12, f.y + 22);
  ctx.fillStyle = PAL.dim;
  ctx.font = '9px "Cascadia Mono", Consolas, monospace';
  const sub = host ? `${host.address}${host.discoveredAt ? '' : ' · 未发现'}${host.status === 'error' ? ' · 发现失败' : host.status === 'unsupported' ? ' · 不支持' : ''}` : 'EXTERNAL';
  ctx.fillText(fitText(ctx, sub, f.w - 24), f.x + 12, f.y + 36);
  ctx.textAlign = 'right';
  ctx.fillStyle = color;
  ctx.fillText(`${f.count} SVC`, f.x + f.w - 10, f.y + 22);
  if (progress.running && host && progress.hostId === host.hostId && progress.phase === 'host') {
    ctx.fillStyle = PAL.toxic;
    ctx.fillText(`SCANNING${'.'.repeat(1 + Math.floor(pulseT * 6) % 3)}`, f.x + f.w - 10, f.y + 36);
  }
}

function drawEdge(ctx, e, a, b, on, dimOthers) {
  const p = edgePath(a, b);
  const color = edgeColor(e.kind);
  ctx.save();
  ctx.globalAlpha = on ? 1 : dimOthers ? 0.12 : 0.6;
  ctx.strokeStyle = color + (on && dimOthers ? 'ff' : 'aa');
  ctx.lineWidth = e.kind === 'conn' ? Math.min(1 + Math.log2((e.count || 1) + 1) * 0.6, 4) : e.kind === 'proxy' ? 1.8 : 1.2;
  if (e.kind === 'config') ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]); ctx.stroke();
  ctx.setLineDash([]);
  // 箭头:沿曲线从终点往回找出目标框边界
  let t = 1;
  while (t > 0 && inBox(bez(p, t), b)) t -= 0.01;
  const tip = bez(p, t), back = bez(p, Math.max(0, t - 0.04));
  const ang = Math.atan2(tip.y - back.y, tip.x - back.x);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - 9 * Math.cos(ang - 0.4), tip.y - 9 * Math.sin(ang - 0.4));
  ctx.lineTo(tip.x - 9 * Math.cos(ang + 0.4), tip.y - 9 * Math.sin(ang + 0.4));
  ctx.closePath(); ctx.fill();
  // 流动脉冲(与原拓扑页一致)
  let t0 = 0;
  while (t0 < 1 && inBox(bez(p, t0), a)) t0 += 0.01;
  const span = Math.max(0.01, t - t0);
  const pt = bez(p, t0 + ((pulseT + (e.id.length % 7) / 7) % 1) * span);
  ctx.beginPath(); ctx.arc(pt.x, pt.y, 2.4, 0, Math.PI * 2);
  ctx.shadowColor = color; ctx.shadowBlur = 9; ctx.fill(); ctx.shadowBlur = 0;
  if (e.label && on && (view.scale > 0.6 || dimOthers)) {
    const mid = bez(p, (t0 + t) / 2);
    ctx.font = '9px "Cascadia Mono", Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = fitText(ctx, e.label, 150);
    const tw = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(10,8,5,.85)';
    ctx.fillRect(mid.x - tw / 2, mid.y - 7, tw, 14);
    ctx.fillStyle = color;
    ctx.fillText(label, mid.x, mid.y);
  }
  ctx.restore();
}

function drawNode(ctx, n, on, hot) {
  const s = n.s;
  const color = s.state === 'missing' ? PAL.red : catColor(s.category);
  const x = n.x - NODE_W / 2, y = n.y - NODE_H / 2;
  ctx.save();
  ctx.globalAlpha = on ? 1 : 0.25;
  chamfer(ctx, x, y, NODE_W, NODE_H, 8);
  ctx.fillStyle = hot ? '#241d10' : '#191510';
  ctx.strokeStyle = color;
  ctx.lineWidth = hot ? 2 : 1.2;
  if (s.state === 'missing') ctx.setLineDash([4, 3]);
  ctx.shadowColor = color; ctx.shadowBlur = hot ? 14 : 5;
  ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0; ctx.setLineDash([]);

  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x + 11, y + 11, 3, 0, Math.PI * 2); ctx.fill();

  // 部署方式徽标
  const tag = DEPLOY[s.deploy] || s.deploy;
  ctx.font = '700 8px "Cascadia Mono", Consolas, monospace';
  const tw = ctx.measureText(tag).width + 8;
  ctx.fillStyle = s.deploy === 'docker' || s.deploy === 'k8s' ? PAL.cyan + '33' : s.deploy === 'systemd' ? PAL.amber + '2a' : 'rgba(154,138,104,.18)';
  ctx.fillRect(x + NODE_W - tw - 5, y + 4, tw, 12);
  ctx.fillStyle = s.deploy === 'docker' || s.deploy === 'k8s' ? PAL.cyan : s.deploy === 'systemd' ? PAL.amber : PAL.dim;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(tag, x + NODE_W - tw / 2 - 5, y + 10.5);
  if (s.state === 'new' || s.state === 'missing') {
    const st = s.state === 'new' ? 'NEW' : 'MISSING';
    const sw = ctx.measureText(st).width + 8;
    ctx.fillStyle = s.state === 'new' ? PAL.toxic : PAL.red;
    ctx.fillRect(x + NODE_W - tw - sw - 9, y + 4, sw, 12);
    ctx.fillStyle = '#171204';
    ctx.fillText(st, x + NODE_W - tw - sw / 2 - 9, y + 10.5);
  }

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PAL.bone;
  ctx.font = '700 12px Bahnschrift, sans-serif';
  ctx.fillText(fitText(ctx, s.name, NODE_W - 28 - tw), x + 20, y + 15);
  ctx.font = '9px "Cascadia Mono", Consolas, monospace';
  ctx.fillStyle = PAL.dim;
  const ports = (s.ports || []).slice(0, 3).map(p => p.published ? `${p.published}→${p.port}` : p.port).join(',');
  ctx.fillText(fitText(ctx, `${s.kind}${ports ? ` :${ports}` : ''}`, NODE_W - 14), x + 8, y + 31);
  const extra = s.category === 'llm'
    ? `${s.meta?.servedName || s.meta?.modelShort || '模型未知'}${s.meta?.gpus ? ` · GPU×${s.meta.gpus.length}` : ''}`
    : s.category === 'gateway' && s.meta?.routes ? `${s.meta.routes.length} 条转发规则`
      : s.hostId ? '' : CAT_LABEL[s.category] || '';
  if (extra) {
    ctx.fillStyle = color;
    ctx.fillText(fitText(ctx, extra, NODE_W - 14), x + 8, y + 44);
  } else if (s.image || s.unit) {
    ctx.fillStyle = PAL.dimmer || '#63573f';
    ctx.fillText(fitText(ctx, s.image || `${s.unit}.service`, NODE_W - 14), x + 8, y + 44);
  }
  ctx.restore();
}

// ---------- 交互 ----------

function toWorld(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.ox) / view.scale, y: (e.clientY - r.top - view.oy) / view.scale, sx: e.clientX - r.left, sy: e.clientY - r.top };
}

function nodeAt(pt) {
  for (const n of nodes.values()) if (inBox(pt, n, 0)) return n;
  return null;
}

function frameAt(pt) {
  return frames.find(f => f.host && pt.x >= f.x && pt.x <= f.x + f.w && pt.y >= f.y && pt.y <= f.y + 42) || null;
}

function onDown(e) {
  if (e.button !== 0) return;
  const pt = toWorld(e);
  drag = { sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy, moved: false, pt };
}

function onMove(e) {
  if (!canvas || !root?.classList.contains('active')) return;
  if (drag) {
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) { view.ox = drag.ox + dx; view.oy = drag.oy + dy; userMoved = true; canvas.style.cursor = 'grabbing'; }
    return;
  }
  // 事件冒泡出 Shadow DOM 后 target 会被改成宿主元素,要看 composedPath
  if (e.composedPath()[0] !== canvas) return;
  const pt = toWorld(e);
  const n = nodeAt(pt);
  hoverId = n ? n.s.id : null;
  canvas.style.cursor = n || frameAt(pt) ? 'pointer' : 'grab';
}

function onUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  canvas.style.cursor = 'grab';
  if (d.moved) return;
  const n = nodeAt(d.pt);
  if (n) { selected = { type: 'node', id: n.s.id }; renderDetail(); return; }
  const f = frameAt(d.pt);
  if (f) { selected = { type: 'host', id: f.host.hostId }; renderDetail(); return; }
  selected = null;
  renderDetail();
}

function onDblClick(e) {
  const f = frameAt(toWorld(e));
  if (f && f.host) openDeviceDrawer(f.host.hostId);
}

function onWheel(e) {
  e.preventDefault();
  const pt = toWorld(e);
  const k = Math.exp(-e.deltaY * 0.0015);
  const scale = Math.max(0.2, Math.min(3, view.scale * k));
  view.ox = pt.sx - pt.x * scale;
  view.oy = pt.sy - pt.y * scale;
  view.scale = scale;
  userMoved = true;
}

// ---------- 侧栏 ----------

function renderLegend() {
  const cats = ['gateway', 'app', 'llm', 'data', 'external'].map(c => `<span><i style="background:${catColor(c)}"></i>${CAT_LABEL[c]}</span>`).join('');
  const edges = `<span><b style="color:${PAL.cyan}">━</b> 反代</span><span><b style="color:${PAL.amber}">━</b> 连接</span><span><b style="color:${PAL.dim}">┅</b> 配置</span>`;
  root.querySelector('#topo-legend').innerHTML = cats + edges;
}

function renderFilter() {
  root.querySelector('#topo-filter').innerHTML = Object.keys(filters).map(c => `<label><input type="checkbox" data-cat="${c}" ${filters[c] ? 'checked' : ''}> <i style="background:${catColor(c)}"></i>${CAT_LABEL[c]}</label>`).join('');
}

function renderSide() {
  renderHosts();
  renderDetail();
  renderEdges();
}

function renderProgress() {
  const box = root.querySelector('#topo-progress');
  const btn = root.querySelector('#topo-discover');
  const cancel = root.querySelector('#topo-cancel');
  btn.textContent = progress.running ? '发现中…' : topo.discoveredAt ? '更新' : '发现';
  btn.disabled = !!progress.running;
  cancel.style.display = progress.running ? '' : 'none';
  if (!progress.running) { box.innerHTML = ''; box.style.display = 'none'; return; }
  const pct = progress.total ? Math.round(progress.index / progress.total * 100) : 0;
  box.style.display = '';
  box.innerHTML = `<div class="tp-t">TOPOLOGY SCAN · ${progress.index}/${progress.total}${progress.hostName ? ` · ${esc(progress.hostName)}` : ''}</div><div class="bar g"><i style="width:${pct}%"></i></div>`;
}

function renderHosts() {
  const box = root.querySelector('#topo-hosts');
  const count = id => (topo.services || []).filter(s => s.hostId === id && s.state !== 'missing').length;
  const hosts = topo.hosts || [];
  box.innerHTML = hosts.length ? hosts.map(h => {
    const scanning = progress.running && progress.hostId === h.hostId && progress.phase === 'host';
    const st = scanning ? '<span class="st st-info">SCANNING</span>' : h.status === 'ok' ? '<span class="st st-ok">已发现</span>' : h.status === 'error' ? '<span class="st st-crit">失败</span>' : h.status === 'unsupported' ? '<span class="st st-warn">不支持</span>' : '<span class="st st-dim">未发现</span>';
    return `<div class="topo-host" data-host="${esc(h.hostId)}">
      <div class="th-l"><b>${esc(h.name)}</b><small>${esc(h.address)} · ${count(h.hostId)} 服务${h.discoveredAt ? ` · ${fmtTime(h.discoveredAt)}` : ''}</small>${h.error ? `<small class="th-err" title="${esc(h.error)}">${esc(h.error)}</small>` : ''}</div>
      <div class="th-r">${st}<button class="btn ghost sm" data-rediscover="${esc(h.hostId)}" ${progress.running ? 'disabled' : ''}>${h.discoveredAt ? '重新发现' : '发现'}</button></div>
    </div>`;
  }).join('') : '<div class="topo-muted">主机库中没有已启用监控的主机</div>';
}

function svcById(id) { return (topo.services || []).find(s => s.id === id); }
function hostName(id) { return (topo.hosts || []).find(h => h.hostId === id)?.name || ''; }
function svcLabel(s) { return s ? `${s.name}${s.hostId ? ` @${hostName(s.hostId)}` : ''}` : '?'; }

function kv(k, v) { return v === undefined || v === null || v === '' ? '' : `<div class="hw-item"><div class="k">${k}</div><div class="v">${v}</div></div>`; }

function renderDetail() {
  const box = root.querySelector('#topo-detail');
  if (!selected) { box.innerHTML = '<div class="topo-muted">点击图中的服务或主机查看详情；双击主机标题打开设备详情</div>'; renderEdges(); return; }
  if (selected.type === 'host') {
    const h = (topo.hosts || []).find(x => x.hostId === selected.id);
    if (!h) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="td-title">${esc(h.name)}</div>
      <div class="hw-grid td-grid">${kv('地址', esc(h.address))}${kv('主机名', esc(h.hostname))}${kv('IP', esc((h.ips || []).slice(0, 6).join(' ')))}${kv('Docker', h.docker ? '可访问' : '不可用 / 无权限')}${kv('权限', h.sudo ? 'root / 免密 sudo' : '普通用户（部分进程归属不可见）')}${kv('上次发现', h.discoveredAt ? new Date(h.discoveredAt).toLocaleString() : '从未')}</div>
      ${h.error ? `<div class="td-err">${esc(h.error)}</div>` : ''}
      <div class="td-actions"><button class="btn ghost sm" data-act="rediscover" data-id="${esc(h.hostId)}" ${progress.running ? 'disabled' : ''}>重新发现此主机</button><button class="btn ghost sm" data-act="drawer" data-id="${esc(h.hostId)}">设备详情</button></div>`;
    renderEdges();
    return;
  }
  const s = svcById(selected.id);
  if (!s) { selected = null; renderDetail(); return; }
  const m = s.meta || {};
  const ports = (s.ports || []).map(p => `${esc(p.bind)}:${p.port}${p.published ? ` ⇐ 宿主 ${p.published}` : ''}`).join('<br>');
  const gpus = Array.isArray(m.gpus) ? m.gpus.map(g => `GPU${esc(g.gpu)} · ${g.memMiB} MiB`).join('<br>') : '';
  const routes = Array.isArray(m.routes) && m.routes.length ? `<div class="td-sub">转发规则 · ${m.routes.length}</div><div class="td-routes">${m.routes.slice(0, 40).map(r => `<div><span>${esc(r.serverName || '_')} ${esc(r.location)}</span><b>→ ${esc(r.target)}</b></div>`).join('')}</div>` : '';
  box.innerHTML = `<div class="td-title" style="color:${catColor(s.category)}">${esc(s.name)} ${s.state === 'new' ? '<span class="st st-ok">NEW</span>' : s.state === 'missing' ? '<span class="st st-crit">MISSING</span>' : ''}</div>
    <div class="td-tags"><span class="type-tag">${esc(CAT_LABEL[s.category] || s.category)}</span><span class="type-tag">${esc(s.kind)}</span><span class="type-tag">${esc(DEPLOY_TEXT[s.deploy] || s.deploy)}</span></div>
    <div class="hw-grid td-grid">
      ${kv('主机', s.hostId ? esc(hostName(s.hostId)) : '外部')}
      ${kv('端口', ports)}
      ${kv('容器', s.containerName ? esc(s.containerName) : '')}
      ${kv('镜像', esc(s.image))}
      ${kv('Compose', esc(m.compose))}
      ${kv('systemd', s.unit ? `${esc(s.unit)}.service` : '')}
      ${kv('进程', s.process ? `${esc(s.process)}${s.pid ? ` · PID ${s.pid}` : ''}` : '')}
      ${kv('模型', esc(m.model))}
      ${kv('服务名', esc(m.servedName))}
      ${kv('张量并行', esc(m.tp))}
      ${kv('GPU', gpus)}
      ${kv('版本', esc(m.version))}
      ${kv('首次发现', s.firstSeen ? new Date(s.firstSeen).toLocaleString() : '')}
    </div>
    ${s.cmd ? `<div class="td-sub">命令行</div><div class="td-cmd">${esc(s.cmd)}</div>` : ''}
    ${m.note ? `<div class="td-err">${esc(m.note)}</div>` : ''}
    ${routes}`;
  renderEdges();
}

function renderEdges() {
  const box = root.querySelector('#topo-edges');
  const focus = selected?.type === 'node' ? selected.id : null;
  const hostFocus = selected?.type === 'host' ? selected.id : null;
  let list = topo.edges || [];
  if (focus) list = list.filter(e => e.from === focus || e.to === focus);
  else if (hostFocus) list = list.filter(e => svcById(e.from)?.hostId === hostFocus || svcById(e.to)?.hostId === hostFocus);
  root.querySelector('#topo-edge-count').textContent = `${list.length} LINKS`;
  const order = { proxy: 0, conn: 1, config: 2 };
  box.innerHTML = list.length ? [...list].sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 120).map(e => {
    const a = svcById(e.from), b = svcById(e.to);
    const other = focus && e.from === focus ? e.to : e.from;
    return `<div class="topo-edge" data-goto="${esc(focus ? other : e.from)}" title="${esc((e.evidence || []).join('\n'))}">
      <div><span class="type-tag" style="color:${edgeColor(e.kind)}">${EDGE_TEXT[e.kind] || e.kind}</span>${e.count > 1 ? `<small>×${e.count}</small>` : ''}</div>
      <div class="te-path">${esc(svcLabel(a))} <b>→</b> ${esc(svcLabel(b))}</div>
      ${e.label ? `<div class="te-label">${esc(e.label)}</div>` : ''}
      <div class="te-ev">${esc((e.evidence || [])[0] || '')}</div>
    </div>`;
  }).join('') : '<div class="topo-muted">暂无关系</div>';
}
