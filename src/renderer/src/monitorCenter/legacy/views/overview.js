import { get, onTick, onEvent, fmtUptime, fmtTime } from '../api.js';
import { sparkline, lineChart, PAL } from '../charts.js';
import { openDeviceDrawer } from '../drawer.js';
import { $id } from '../dom.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let root = null;
const sparkHist = new Map();
const fleet = { timestamps: [], tps: [], gpu: [], pwr: [] };
const feedEvents = [];
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const value = (v, suffix = '') => finite(v) ? `${v}${suffix}` : 'N/A';
const STATUS = { online: '在线', degraded: '采集降级', auth_failed: '认证失败', unreachable: '不可达', unsupported: '不支持', pending: '等待采集' };

function hist(id, key, v) {
  if (!sparkHist.has(id)) sparkHist.set(id, { cpu: [], gpu: [] });
  const h = sparkHist.get(id);
  if (finite(v)) h[key].push(Number(v));
  if (h[key].length > 60) h[key].shift();
  return h[key];
}

const KPIS = [
  { id: 'k-dev', label: '物理节点', cls: '', val: t => `${t.devices}<small>NODES</small>`, sub: t => `异常 ${t.warnDevices}` },
  { id: 'k-gpu', label: '加速单元', cls: 'k-toxic', val: t => `${t.gpus}<small>GPU</small>`, sub: t => `均载 ${value(t.gpuUtilAvg, '%')}` },
  { id: 'k-vram', label: '显存占用', cls: 'k-toxic', val: t => finite(t.vramUsed) && finite(t.vramTotal) ? `${t.vramUsed}<small>/ ${t.vramTotal}GB</small>` : `N/A<small>GB</small>`, sub: t => finite(t.vramUsed) && finite(t.vramTotal) && t.vramTotal > 0 ? `${(t.vramUsed / t.vramTotal * 100).toFixed(1)}% POOLED` : '统一内存或不可用' },
  { id: 'k-tps', label: '推理吞吐', cls: '', val: t => `${t.tpsTotal}<small>TOK/S</small>`, sub: t => `${t.rpmTotal} REQ/MIN` },
  { id: 'k-model', label: '在线模型', cls: 'k-cyan', val: t => `${t.modelsLoaded}<small>/ ${t.models}</small>`, sub: () => 'LLM · 多模态' },
  { id: 'k-svc', label: '容器服务', cls: 'k-cyan', val: t => `${t.svcUp}<small>/ ${t.svcTotal}</small>`, sub: t => `可用率 ${(t.svcTotal ? t.svcUp / t.svcTotal * 100 : 100).toFixed(1)}%` },
  { id: 'k-pwr', label: 'GPU 功耗', cls: '', val: t => `${value(t.powerKw)}<small>KW</small>`, sub: () => 'REAL TELEMETRY' },
  { id: 'k-alert', label: '告警 24H', cls: 'k-red', val: t => `${t.alerts24h}<small>EVENTS</small>`, sub: () => 'WARN + CRIT' }
];

export function mount(el) {
  root = el;
  feedEvents.length = 0;
  root.innerHTML = `<div class="kpi-band">${KPIS.map(k => `<div class="kpi ${k.cls}" id="${k.id}"><div class="lb">${k.label}</div><div class="vl">--</div><div class="sub">--</div></div>`).join('')}</div>
    <div class="sect-h">物理设备资源矩阵 · PHYSICAL NODES</div><div class="dev-grid" id="dev-grid"></div>
    <div class="sect-h" style="margin-top:16px">集群遥测 · FLEET TELEMETRY</div><div class="split-3">
    <div class="panel"><div class="panel-t">集群推理吞吐 <span class="tail">AGG TOK/S</span></div><div class="chart-box"><canvas class="chart" id="fleet-tps"></canvas></div></div>
    <div class="panel"><div class="panel-t">GPU 均载 / 功耗 <span class="tail">UTIL% · KW</span></div><div class="chart-box"><canvas class="chart" id="fleet-gpu"></canvas></div></div>
    <div class="panel"><div class="panel-t">实时事件流 <span class="tail">EVENT FEED</span></div><div class="ev-feed" id="ev-feed" style="height:120px"></div></div></div>`;
  root.querySelector('#dev-grid').addEventListener('click', e => { const card = e.target.closest('.dev-card'); if (card) openDeviceDrawer(card.dataset.id); });
  onTick(data => { if (root.classList.contains('active')) render(data); });
  onEvent(evs => { feedEvents.unshift(...evs.reverse()); if (feedEvents.length > 40) feedEvents.length = 40; if (root.classList.contains('active')) renderFeed(); });
  get('/api/events?limit=10').then(evs => { feedEvents.push(...evs); renderFeed(); }).catch(() => {});
  get('/api/devices').then(list => Promise.all(list.map(d => get(`/api/devices/${d.id}`)))).then(details => {
    for (const d of details) sparkHist.set(d.id, { cpu: (d.hist?.cpu || []).slice(-60), gpu: (d.hist?.gpu || []).slice(-60) });
  }).catch(() => {});
}

function renderFeed() {
  const box = root?.querySelector('#ev-feed'); if (!box) return;
  box.innerHTML = feedEvents.slice(0, 20).map(e => `<div class="ev ${e.level}"><span class="et">${fmtTime(e.t)}</span><span class="ed">${esc(e.device)}</span><span class="em">${esc(e.msg)}</span></div>`).join('');
}

function renderFleet(t, timestamp) {
  fleet.timestamps.push(timestamp || Date.now());
  fleet.tps.push(finite(t.tpsTotal) ? Number(t.tpsTotal) : null);
  fleet.gpu.push(finite(t.gpuUtilAvg) ? Number(t.gpuUtilAvg) : null);
  fleet.pwr.push(finite(t.powerKw) ? Number(t.powerKw) : null);
  for (const arr of Object.values(fleet)) if (arr.length > 120) arr.shift();
  const ct = root.querySelector('#fleet-tps'), cg = root.querySelector('#fleet-gpu');
  if (ct) lineChart(ct, [fleet.tps], {
    axes: true, tooltip: true, min: 0, colors: [PAL.amber], timestamps: fleet.timestamps,
    seriesNames: ['聚合吞吐'], units: ['TOK/S']
  });
  if (cg) lineChart(cg, [fleet.gpu, fleet.pwr], {
    axes: true, tooltip: true, colors: [PAL.toxic, PAL.cyan], timestamps: fleet.timestamps,
    seriesNames: ['GPU均载', 'GPU功耗'], units: ['%', 'kW'], seriesAxes: [0, 1],
    yAxes: [{ min: 0, max: 100, unit: '%' }, { min: 0, unit: 'kW' }]
  });
}

function render(data) {
  const t = data.totals;
  if (t) for (const k of KPIS) { const el = $id(k.id); if (el) { el.querySelector('.vl').innerHTML = k.val(t); el.querySelector('.sub').textContent = k.sub(t); } }
  const grid = root.querySelector('#dev-grid'), ids = new Set();
  for (const d of data.devices || []) {
    ids.add(d.id); let card = grid.querySelector(`[data-id="${d.id}"]`);
    if (!card) { card = document.createElement('div'); card.className = 'dev-card'; card.dataset.id = d.id; card.innerHTML = cardHtml(); grid.appendChild(card); }
    card.classList.toggle('warn', d.alert === 'warn'); card.classList.toggle('crit', d.alert === 'crit'); fillCard(card, d);
    const cpuH = hist(d.id, 'cpu', d.cpu?.util); const gpuValues = (d.gpus || []).map(g => g.util).filter(finite); hist(d.id, 'gpu', gpuValues.length ? gpuValues.reduce((a,b)=>a+Number(b),0)/gpuValues.length : null);
    sparkline(card.querySelector('.dc-spark'), cpuH, d.alert === 'crit' ? PAL.red : PAL.amber, { max: 100 });
  }
  for (const card of [...grid.children]) if (!ids.has(card.dataset.id)) card.remove();
  if (t) renderFleet(t, data.t);
}

function cardHtml() { return `<div class="dc-head"><span class="dc-name"></span><span class="dc-role"></span><span class="dc-alert"></span></div>
  <div class="dc-status"><span class="collect-state"></span><span class="collect-proto"></span><span class="collect-error"></span></div>
  <div class="dc-meta"><span class="m-ip"></span><span class="m-os"></span><span class="m-up"></span></div>
  <div class="dc-meters"><div class="meter"><div class="m-lb"><span>CPU</span><span class="v v-cpu"></span></div><div class="bar b-cpu"><i></i></div></div>
  <div class="meter"><div class="m-lb"><span>MEM</span><span class="v v-mem"></span></div><div class="bar c b-mem"><i></i></div></div>
  <div class="meter"><div class="m-lb"><span>GPU</span><span class="v v-gpu"></span></div><div class="bar g b-gpu"><i></i></div></div>
  <div class="meter"><div class="m-lb"><span>NETWORK</span><span class="v v-vram"></span></div><div class="bar b-vram"><i></i></div></div></div>
  <canvas class="dc-spark"></canvas><div class="dc-foot"><span class="f-gpu"></span><span class="f-svc" style="margin-left:auto"></span><span class="f-tps"></span></div>`; }

function fillCard(card, d) {
  const q = s => card.querySelector(s), cpu = d.cpu?.util, used = d.mem?.used, total = d.mem?.total, memPct = finite(used) && finite(total) && Number(total) > 0 ? used / total * 100 : null;
  q('.dc-name').textContent = d.name; q('.dc-role').textContent = d.role; q('.dc-alert').innerHTML = d.alert === 'crit' ? '<span class="st st-crit">CRIT</span>' : d.alert === 'warn' ? '<span class="st st-warn">WARN</span>' : '<span class="st st-ok">OK</span>';
  q('.collect-state').textContent = STATUS[d.collectionStatus] || d.collectionStatus || '等待采集'; q('.collect-state').className = `collect-state ${d.collectionStatus || ''}`;
  q('.collect-proto').textContent = (d.protocol || 'auto').toUpperCase(); q('.collect-error').textContent = d.lastError || '';
  q('.m-ip').innerHTML = `<b>IP</b> ${esc(d.ip)}`; q('.m-os').innerHTML = `<b>OS</b> ${esc(String(d.os || 'N/A').split(' ').slice(0, 3).join(' '))}`; q('.m-up').innerHTML = `<b>UP</b> ${finite(d.uptimeSec) ? fmtUptime(d.uptimeSec) : 'N/A'}`;
  q('.v-cpu').textContent = value(cpu, '%'); q('.b-cpu i').style.width = finite(cpu) ? `${cpu}%` : '0%'; q('.b-cpu').className = `bar b-cpu ${finite(cpu) && cpu > 88 ? 'r' : ''}`;
  q('.v-mem').textContent = finite(used) && finite(total) ? `${used}/${total}G` : 'N/A'; q('.b-mem i').style.width = finite(memPct) ? `${memPct}%` : '0%';
  const gpus = d.gpus || [], utils = gpus.map(g => g.util).filter(finite);
  if (gpus.length) { const gu = utils.length ? utils.reduce((a,b)=>a+Number(b),0)/utils.length : null; q('.v-gpu').textContent = finite(gu) ? `${gu.toFixed(1)}%` : '已检测'; q('.b-gpu i').style.width = finite(gu) ? `${gu}%` : '0%'; const temps=gpus.map(g=>g.temp).filter(finite); q('.f-gpu').innerHTML = `<span class="gpu-chip">GPU×${gpus.length}${temps.length ? ` · 最高 ${Math.max(...temps).toFixed(0)}°C` : ''}</span>`; }
  else { q('.v-gpu').textContent='无 GPU'; q('.b-gpu i').style.width='0%'; q('.f-gpu').textContent='GPU×0'; }
  q('.v-vram').textContent = finite(d.net?.rx) && finite(d.net?.tx) ? `↓${d.net.rx} ↑${d.net.tx}M` : 'N/A'; q('.b-vram i').style.width='0%'; q('.f-svc').textContent = d.lastSeenAt ? `采集 ${new Date(d.lastSeenAt).toLocaleTimeString()}` : '尚未成功采集'; q('.f-tps').textContent='';
}
