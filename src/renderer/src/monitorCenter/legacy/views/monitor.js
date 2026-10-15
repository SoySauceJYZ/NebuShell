import { get, onTick, fmtNum } from '../api.js';
import { hbars, donut, PAL } from '../charts.js';
import { $id } from '../dom.js';

let root = null;
let tab = 'llm';
let fetching = false;

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const DEPLOY = { docker: 'DOCKER', k8s: 'K8S', systemd: 'SYSTEMD', process: '直接部署' };

export function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="mon-tabs">
      <button class="mon-tab ${tab === 'llm' ? 'active' : ''}" data-tab="llm">LLM 模型监控</button>
      <button class="mon-tab ${tab === 'app' ? 'active' : ''}" data-tab="app">应用服务状态</button>
      <button class="mon-tab ${tab === 'db' ? 'active' : ''}" data-tab="db">数据库监控</button>
    </div>
    <div id="mon-body"></div>`;
  root.querySelector('.mon-tabs').addEventListener('click', e => {
    const b = e.target.closest('.mon-tab');
    if (!b) return;
    tab = b.dataset.tab;
    root.querySelectorAll('.mon-tab').forEach(x => x.classList.toggle('active', x === b));
    load();
  });
  fetching = false;
  load();
  onTick(() => { if (root.classList.contains('active')) load(); });
}

export function refresh() { load(); }

async function load() {
  if (fetching) return;
  fetching = true;
  try {
    if (tab === 'llm') renderLlm(await get('/api/llm'));
    else {
      const { topology } = await get('/api/topology');
      if (tab === 'db') renderDb(topology);
      else renderApp(topology);
    }
  } catch (e) { /* 保持旧数据 */ }
  fetching = false;
}

function stBadge(s) {
  return s === 'running' ? '<span class="st st-ok">SERVING</span>'
    : s === 'degraded' ? '<span class="st st-warn">DEGRADED</span>'
    : '<span class="st st-crit">DOWN</span>';
}

function available(rows, key) {
  return rows.map(r => r.metrics[key]).filter(Number.isFinite);
}

function sumValues(rows, key) {
  const values = available(rows, key);
  return values.length ? values.reduce((a, v) => a + v, 0) : null;
}

function weightedError(rows) {
  const usable = rows.filter(r => Number.isFinite(r.metrics.errorRate) && Number.isFinite(r.metrics.rpm));
  const rpm = usable.reduce((a, r) => a + r.metrics.rpm, 0);
  return rpm > 0 ? usable.reduce((a, r) => a + r.metrics.errorRate * r.metrics.rpm, 0) / rpm : null;
}

function fmt(v, digits = 1, unit = '') {
  return Number.isFinite(v) ? `${v.toFixed(digits)}${unit ? `<small> ${unit}</small>` : ''}` : 'N/A';
}

function hostOf(url) {
  try { return new URL(url).host; } catch (e) { return url; }
}

function renderLlm(rows) {
  const body = root.querySelector('#mon-body');
  const up = rows.filter(r => r.apiOnline);
  const tps = sumValues(rows, 'tps');
  const rpm = sumValues(rows, 'rpm');
  const input = sumValues(rows, 'inputTokensPerMin');
  const output = sumValues(rows, 'outputTokensPerMin');
  const errorRate = weightedError(rows);
  const p95s = available(rows, 'p95Ms');
  const p95 = p95s.length ? Math.max(...p95s) : null;
  const ranked = rows.filter(r => Number.isFinite(r.metrics.tps)).sort((a, b) => b.metrics.tps - a.metrics.tps);

  body.innerHTML = `
    <div class="kpi-band llm-kpis">
      <div class="kpi"><div class="lb">在线端点</div><div class="vl">${up.length}<small>/ ${rows.length} API</small></div><div class="sub">真实 /v1/models 探测</div></div>
      <div class="kpi k-toxic"><div class="lb">总吞吐</div><div class="vl">${fmt(tps, 1, 'TOK/S')}</div><div class="sub">输出 Tokens 实测速率</div></div>
      <div class="kpi k-cyan"><div class="lb">请求速率</div><div class="vl">${fmt(rpm, 1, 'RPM')}</div><div class="sub">相邻计数器区间</div></div>
      <div class="kpi"><div class="lb">输入 Tokens/min</div><div class="vl">${fmt(input, 0)}</div><div class="sub">PROMPT TOKENS</div></div>
      <div class="kpi"><div class="lb">输出 Tokens/min</div><div class="vl">${fmt(output, 0)}</div><div class="sub">GENERATION TOKENS</div></div>
      <div class="kpi k-red"><div class="lb">区间错误率</div><div class="vl">${fmt(errorRate, 2, '%')}</div><div class="sub">失败 / 请求增量</div></div>
      <div class="kpi"><div class="lb">P95 延迟</div><div class="vl">${fmt(p95, 0, 'MS')}</div><div class="sub">端点最慢 P95</div></div>
      <div class="kpi k-cyan"><div class="lb">成本</div><div class="vl">¥0.00</div><div class="sub">本地端点 · 无鉴权</div></div>
    </div>
    <div class="split-3 mb12">
      <div class="panel"><div class="panel-t">吞吐排行 <span class="tail">AVAILABLE TOK/S</span></div><div class="chart-box lg"><canvas class="chart" id="llm-rank"></canvas></div></div>
      <div class="panel"><div class="panel-t">引擎分布 <span class="tail">ENGINE</span></div><div class="chart-box lg"><canvas class="chart" id="llm-donut"></canvas></div></div>
    </div>
    ${rows.length ? '' : '<div class="docker-empty">尚无模型端点 · 在「网络拓扑」页点击「发现」后，识别到的 vLLM / SGLang / Ollama 等模型服务会自动加入</div>'}
    <div class="llm-grid">${rows.map(llmCard).join('')}</div>`;

  const rank = $id('llm-rank');
  if (rank) hbars(rank, ranked.map(r => ({
    label: `${r.model} @${hostOf(r.baseUrl)}`,
    value: r.metrics.tps,
    text: r.metrics.tps.toFixed(1),
    color: r.status === 'running' ? PAL.amber : PAL.dim
  })));
  const dn = $id('llm-donut');
  if (dn) {
    const engines = {};
    rows.forEach(r => { engines[r.engine] = (engines[r.engine] || 0) + 1; });
    const colors = ['#ffb000', '#4fd8c9', '#9dff3f'];
    donut(dn, Object.entries(engines).map(([, value], i) => ({ value, color: colors[i % colors.length] })), { center: String(rows.length), centerSub: 'ENDPOINTS' });
    const legend = Object.entries(engines).map(([engine, count], i) => `<span style="margin-right:10px"><i style="display:inline-block;width:8px;height:8px;background:${colors[i % colors.length]};margin-right:4px"></i>${esc(engine)}×${count}</span>`).join('');
    dn.parentElement.insertAdjacentHTML('beforeend', `<div style="font-size:10px;color:var(--dim);letter-spacing:1px;padding-top:6px">${legend}</div>`);
  }
}

function llmCard(r) {
  const s = r.metrics;
  const down = r.status !== 'running';
  const sglang = String(r.engine || '').toLowerCase() === 'sglang';
  const sglangStats = sglang ? `
        <div class="llm-stat"><div class="k">缓存命中率</div><div class="v">${fmt(s.cacheHitRate, 1, '%')}</div></div>
        <div class="llm-stat"><div class="k">引擎利用率</div><div class="v">${fmt(s.utilization, 1, '%')}</div></div>
        <div class="llm-stat"><div class="k">活跃 Token / 容量</div><div class="v">${fmt(s.activeTokens, 0)}<small> / ${Number.isFinite(s.tokenCapacity) ? s.tokenCapacity.toFixed(0) : 'N/A'}</small></div></div>
        <div class="llm-stat"><div class="k">最大并发</div><div class="v">${fmt(s.maxRunningRequests, 0)}</div></div>
        <div class="llm-stat"><div class="k">加速器</div><div class="v">${esc(s.accelerator || 'N/A')}<small> × ${Number.isFinite(s.acceleratorCount) ? s.acceleratorCount : 'N/A'}</small></div></div>
        <div class="llm-stat"><div class="k">引擎版本</div><div class="v">${esc(s.engineVersion || 'N/A')}</div></div>` : '';
  return `
    <div class="llm-card ${down ? 'down' : ''}">
      <div class="llm-head">
        <span class="llm-name">${esc(r.model)}</span>
        <span style="margin-left:auto">${stBadge(r.status)}</span>
      </div>
      <div class="llm-endpoint">${esc(r.baseUrl)}</div>
      <div class="llm-tags">
        <span class="type-tag type-llm">${esc(r.engine)}</span>
        <span class="type-tag">${esc(r.source)}</span>
        <span class="type-tag">${r.origin === 'discovered' ? '拓扑发现' : '手动配置'}</span>
        <span class="type-tag">响应 ${Number.isFinite(r.responseMs) ? `${r.responseMs}ms` : 'N/A'}</span>
        <span class="type-tag">成本 ¥0.00</span>
      </div>
      <div class="llm-stats llm-real-stats">
        <div class="llm-stat"><div class="k">运行请求</div><div class="v">${fmt(s.running, 0)}</div></div>
        <div class="llm-stat"><div class="k">等待请求</div><div class="v">${fmt(s.waiting, 0)}</div></div>
        <div class="llm-stat"><div class="k">输入 Tokens/min</div><div class="v">${fmt(s.inputTokensPerMin, 0)}</div></div>
        <div class="llm-stat"><div class="k">输出 Tokens/min</div><div class="v">${fmt(s.outputTokensPerMin, 0)}</div></div>
        <div class="llm-stat"><div class="k">TPS</div><div class="v">${fmt(s.tps, 1)}</div></div>
        <div class="llm-stat"><div class="k">RPM</div><div class="v">${fmt(s.rpm, 1)}</div></div>
        <div class="llm-stat"><div class="k">TTFT P95</div><div class="v">${fmt(s.ttftP95Ms, 0, 'MS')}</div></div>
        <div class="llm-stat"><div class="k">P95 延迟</div><div class="v">${fmt(s.p95Ms, 0, 'MS')}</div></div>
        <div class="llm-stat"><div class="k">P99 延迟</div><div class="v">${fmt(s.p99Ms, 0, 'MS')}</div></div>
        <div class="llm-stat"><div class="k">KV CACHE</div><div class="v">${fmt(s.kvCacheUsage, 1, '%')}</div></div>
        ${sglangStats}
        <div class="llm-stat"><div class="k">区间错误率</div><div class="v">${fmt(s.errorRate, 2, '%')}</div></div>
        <div class="llm-stat"><div class="k">探测成功 / 失败</div><div class="v">${r.successes} / ${r.failures}</div></div>
      </div>
      <div class="llm-error"><b>最近错误</b> ${esc(r.lastError || '无')}</div>
    </div>`;
}

// ---------- 应用 / 数据库:来自拓扑发现 ----------

function hostNames(topo) {
  return new Map((topo.hosts || []).map(h => [h.hostId, h]));
}

function edgeCounts(topo) {
  const inbound = new Map(), outbound = new Map();
  for (const e of topo.edges || []) {
    inbound.set(e.to, (inbound.get(e.to) || 0) + 1);
    outbound.set(e.from, (outbound.get(e.from) || 0) + 1);
  }
  return { inbound, outbound };
}

const portText = s => (s.ports || []).slice(0, 4).map(p => p.published ? `${p.published}→${p.port}` : p.port).join(', ') || '—';
const svcState = s => s.state === 'missing' ? 'down' : 'running';

function emptyHint(topo) {
  return topo.discoveredAt ? '' : '<div class="docker-empty">尚未进行拓扑发现 · 请在「网络拓扑」页点击「发现」</div>';
}

function renderApp(topo) {
  const body = root.querySelector('#mon-body');
  const hosts = hostNames(topo);
  const { inbound, outbound } = edgeCounts(topo);
  const apps = (topo.services || []).filter(s => s.hostId && (s.category === 'app' || s.category === 'gateway'));
  const up = apps.filter(a => a.state !== 'missing').length;
  const docker = apps.filter(a => a.deploy === 'docker' || a.deploy === 'k8s').length;
  const gateways = apps.filter(a => a.category === 'gateway').length;
  body.innerHTML = `
    <div class="kpi-band" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="lb">应用 / 网关</div><div class="vl">${up}<small>/ ${apps.length} UP</small></div><div class="sub">跨 ${new Set(apps.map(a => a.hostId)).size} 节点</div></div>
      <div class="kpi k-cyan"><div class="lb">容器化部署</div><div class="vl">${docker}<small>DOCKER</small></div><div class="sub">其余为直接部署 / SYSTEMD</div></div>
      <div class="kpi k-toxic"><div class="lb">网关入口</div><div class="vl">${gateways}<small>GATEWAY</small></div><div class="sub">NGINX / CADDY / TRAEFIK …</div></div>
      <div class="kpi k-red"><div class="lb">已消失服务</div><div class="vl">${apps.length - up}<small>MISSING</small></div><div class="sub">上次发现后不见了</div></div>
    </div>
    ${emptyHint(topo)}
    <div class="app-grid">
      ${apps.map(a => `
        <div class="app-card">
          <div style="display:flex;align-items:baseline;gap:9px">
            <span style="font-family:var(--font-disp);font-size:16px;font-weight:700;letter-spacing:1px;color:var(--bone)">${esc(a.name)}</span>
            <span style="font-size:9px;color:var(--dimmer)">@${esc(hosts.get(a.hostId)?.name || '')} :${esc(portText(a))}</span>
            <span style="margin-left:auto">${stBadge(svcState(a))}</span>
          </div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            <span class="type-tag ${a.category === 'gateway' ? 'type-agent' : 'type-app'}">${a.category === 'gateway' ? '网关' : '应用'}</span>
            <span class="type-tag">${esc(a.kind)}</span>
            <span class="type-tag">${esc(DEPLOY[a.deploy] || a.deploy)}</span>
            ${a.state === 'new' ? '<span class="type-tag type-llm">NEW</span>' : ''}
          </div>
          <div class="svc-mini">
            <span>上游 <b style="color:var(--amber-hi)">${inbound.get(a.id) || 0}</b></span><span>下游 ${outbound.get(a.id) || 0}</span>
            <span>${esc(a.image || a.unit || a.process || '')}</span>
          </div>
        </div>`).join('')}
    </div>`;
}

function renderDb(topo) {
  const body = root.querySelector('#mon-body');
  const hosts = hostNames(topo);
  const { inbound } = edgeCounts(topo);
  const rows = (topo.services || []).filter(s => s.hostId && s.category === 'data');
  const up = rows.filter(r => r.state !== 'missing').length;
  const engines = {};
  rows.forEach(r => { engines[r.kind] = (engines[r.kind] || 0) + 1; });
  body.innerHTML = `
    <div class="kpi-band" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi k-cyan"><div class="lb">数据库 / 中间件实例</div><div class="vl">${up}<small>/ ${rows.length} UP</small></div><div class="sub">${esc(Object.keys(engines).slice(0, 4).join(' · ') || '—')}</div></div>
      <div class="kpi"><div class="lb">被引用连接</div><div class="vl">${fmtNum(rows.reduce((a, r) => a + (inbound.get(r.id) || 0), 0))}</div><div class="sub">来自拓扑关系</div></div>
      <div class="kpi"><div class="lb">容器化</div><div class="vl">${rows.filter(r => r.deploy === 'docker' || r.deploy === 'k8s').length}<small>DOCKER</small></div><div class="sub">其余为直接部署</div></div>
      <div class="kpi k-red"><div class="lb">已消失</div><div class="vl">${rows.length - up}<small>MISSING</small></div><div class="sub">上次发现后不见了</div></div>
    </div>
    <div class="split-3 mb12">
      <div class="panel"><div class="panel-t">被依赖排行 <span class="tail">UPSTREAM SERVICES</span></div><div class="chart-box lg"><canvas class="chart" id="db-rank"></canvas></div></div>
      <div class="panel"><div class="panel-t">引擎分布 <span class="tail">ENGINE</span></div><div class="chart-box lg"><canvas class="chart" id="db-donut"></canvas></div></div>
    </div>
    ${emptyHint(topo)}
    <div class="db-grid">
      ${rows.map(r => `
        <div class="llm-card ${r.state === 'missing' ? 'down' : ''}">
          <div class="llm-head">
            <span class="llm-name" style="color:var(--cyan)">${esc(r.name)}</span>
            <span class="llm-dev">@${esc(hosts.get(r.hostId)?.name || '')} · :${esc(portText(r))}</span>
            <span style="margin-left:auto">${stBadge(svcState(r))}</span>
          </div>
          <div class="llm-tags">
            <span class="type-tag type-db">${esc(r.kind)}</span>
            <span class="type-tag">${r.meta && r.meta.version ? `v${esc(r.meta.version)}` : '版本未知'}</span>
            <span class="type-tag">${esc(DEPLOY[r.deploy] || r.deploy)}</span>
          </div>
          <div class="llm-stats">
            <div class="llm-stat"><div class="k">依赖它的服务</div><div class="v">${inbound.get(r.id) || 0}</div></div>
            <div class="llm-stat"><div class="k">进程 / 容器</div><div class="v" style="font-size:12px">${esc(r.containerName || r.process || '—')}</div></div>
            <div class="llm-stat"><div class="k">首次发现</div><div class="v" style="font-size:12px">${new Date(r.firstSeen).toLocaleDateString()}</div></div>
          </div>
        </div>`).join('')}
    </div>`;
  const rank = $id('db-rank');
  if (rank) hbars(rank, [...rows].sort((a, b) => (inbound.get(b.id) || 0) - (inbound.get(a.id) || 0)).slice(0, 12).map(r => ({
    label: `${r.name} @${hosts.get(r.hostId)?.name || ''}`, value: inbound.get(r.id) || 0, text: String(inbound.get(r.id) || 0), color: '#4fd8c9'
  })));
  const dn = $id('db-donut');
  if (dn && rows.length) {
    const palette = ['#4fd8c9', '#ffb000', '#9dff3f', '#e08bff', '#ff8a4f', '#7fa8ff'];
    donut(dn, Object.values(engines).map((value, i) => ({ value, color: palette[i % palette.length] })), { center: String(rows.length), centerSub: 'INSTANCES' });
  }
}
