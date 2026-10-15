import { get } from '../api.js';
import { every, visible } from '../dom.js';

let root = null;
let groups = [];
let fetching = false;
let lastFetchAt = 0;
const expanded = new Set();
const collapsedGroups = new Set();
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[c]);

const DOCKER_STATUS = {
  available:['可用','st-ok','Docker 服务正常'], pending:['等待采集','st-dim','等待首次 Docker 探测'],
  not_installed:['未安装','st-warn','目标机未检测到 Docker，请由管理员按运维规范安装'],
  permission_denied:['权限不足','st-crit','当前 SSH 用户无权访问 Docker，请由管理员调整 Docker 权限'],
  daemon_unavailable:['守护进程不可用','st-crit','Docker 已安装但 daemon 不可访问，请检查服务状态'],
  unreachable:['主机不可达','st-crit','请检查主机网络与 SSH 服务'], auth_failed:['SSH认证失败','st-crit','请在 NebuShell「主机」页核对 SSH 凭据'],
  error:['采集异常','st-crit','Docker 命令执行异常，请查看最近错误']
};

export function mount(el) {
  root = el;
  root.innerHTML = `<div class="sect-h">DOCKER CONTAINER MONITOR / Docker容器监控矩阵<span class="svc-refresh-note">每15秒刷新 · 只读监控</span></div><div class="kpi-band docker-kpis" id="docker-kpis"></div><div id="svc-list"></div>`;
  root.querySelector('#svc-list').addEventListener('click', event => {
    const head = event.target.closest('.svc-group-h');
    if (head) {
      const id = head.dataset.g;
      collapsedGroups.has(id) ? collapsedGroups.delete(id) : collapsedGroups.add(id);
      render(); return;
    }
    const row = event.target.closest('tr.row');
    if (row) {
      const id = row.dataset.svc;
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      render();
    }
  });
  load(true);
  every(15000, () => { if (root?.classList.contains('active') && visible()) load(); });
}

export function refresh() { load(Date.now() - lastFetchAt > 5000); }

async function load(force = false) {
  if (fetching || (!force && Date.now() - lastFetchAt < 10000)) return;
  fetching = true;
  try { groups = await get('/api/services'); lastFetchAt = Date.now(); render(); }
  catch (_) { /* 保持最近一次成功数据 */ }
  finally { fetching = false; }
}

function fmtNumber(value, digits = 1) { return Number.isFinite(value) ? Number(value).toFixed(digits) : '—'; }
function fmtBytes(value) {
  if (!Number.isFinite(value)) return '—';
  const units = ['B','KiB','MiB','GiB','TiB']; let n = value, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function fmtTime(value) { return value ? new Date(value).toLocaleString() : '尚未采集'; }
function stateBadge(container) {
  const state = container.state || 'unknown';
  const cls = state === 'running' && container.health !== 'unhealthy' ? 'st-ok' : state === 'restarting' || container.health === 'unhealthy' ? 'st-crit' : state === 'paused' || state === 'created' ? 'st-warn' : 'st-dim';
  return `<span class="st ${cls}">${esc(state.toUpperCase())}</span>`;
}
function healthBadge(health) {
  const cls = health === 'healthy' ? 'st-ok' : health === 'unhealthy' ? 'st-crit' : health === 'starting' ? 'st-warn' : 'st-dim';
  return `<span class="st ${cls}">${esc((health || 'none').toUpperCase())}</span>`;
}

function renderKpis() {
  const containers = groups.flatMap(group => group.containers || []);
  const available = groups.filter(group => group.dockerStatus === 'available').length;
  const running = containers.filter(container => container.state === 'running').length;
  const cpu = containers.reduce((sum, item) => sum + (Number(item.cpuPercent) || 0), 0);
  const memory = containers.reduce((sum, item) => sum + (Number(item.memoryUsedBytes) || 0), 0);
  root.querySelector('#docker-kpis').innerHTML = [
    ['Docker可用主机',`${available}/${groups.length}`,'已成功访问 daemon','k-cyan'], ['容器总数',containers.length,'运行与停止容器',''],
    ['运行中',running,'RUNNING','k-toxic'], ['停止 / 异常',containers.length - running,'非运行状态','k-red'],
    ['CPU 合计',`${cpu.toFixed(1)}%`,'运行容器瞬时值',''], ['内存使用合计',fmtBytes(memory),'可获取容器合计','k-cyan']
  ].map(([label,value,sub,cls]) => `<div class="kpi ${cls}"><div class="lb">${label}</div><div class="vl">${value}</div><div class="sub">${sub}</div></div>`).join('');
}

function detail(container) {
  const cells = [
    ['完整容器 ID', container.id], ['创建时间', container.createdAt], ['运行状态', container.status], ['端口映射', container.ports || '无'],
    ['CPU', Number.isFinite(container.cpuPercent) ? `${container.cpuPercent}%` : '不可用'], ['内存', container.memoryUsage || '不可用'],
    ['网络 IO', container.networkIO || '不可用'], ['块 IO', container.blockIO || '不可用'], ['PIDs', container.pids ?? '不可用'],
    ['重启次数', container.restartCount ?? 0], ['Compose 项目', container.composeProject || '无'], ['Compose 服务', container.composeService || '无']
  ];
  return `<tr class="detail"><td colspan="11"><div class="detail-grid">${cells.map(([k,v]) => `<div class="d-cell"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div></td></tr>`;
}

function render() {
  if (!root) return;
  renderKpis();
  const box = root.querySelector('#svc-list');
  box.innerHTML = groups.length ? groups.map(group => {
    const open = !collapsedGroups.has(group.deviceId);
    const ds = DOCKER_STATUS[group.dockerStatus] || DOCKER_STATUS.error;
    const containers = group.containers || [];
    const rows = containers.map(container => {
      const key = `${group.deviceId}:${container.id}`;
      const row = `<tr class="row" data-svc="${esc(key)}"><td>${stateBadge(container)}</td><td class="docker-name">${esc(container.name || '未命名')}</td><td class="docker-image" title="${esc(container.image)}">${esc(container.image)}</td><td class="mono">${esc(String(container.id || '').slice(0, 12))}</td><td class="docker-ports" title="${esc(container.ports)}">${esc(container.ports || '—')}</td><td>${fmtNumber(container.cpuPercent)}%</td><td>${esc(container.memoryUsage || '—')}<small>${fmtNumber(container.memoryPercent)}%</small></td><td>${esc(container.networkIO || '—')}</td><td>${container.pids ?? '—'}</td><td>${healthBadge(container.health)}</td><td>${container.restartCount ?? 0}</td></tr>`;
      return row + (expanded.has(key) ? detail(container) : '');
    }).join('');
    const advice = group.dockerStatus !== 'available' ? `<div class="docker-unavailable"><b>${esc(ds[0])}</b> · ${esc(ds[2])}${group.error ? `<small>${esc(group.error)}</small>` : ''}</div>` : group.error ? `<div class="docker-partial">部分指标不可用：${esc(group.error)}</div>` : '';
    return `<div class="svc-group"><div class="svc-group-h" data-g="${esc(group.deviceId)}"><span class="gn">${open ? '▾' : '▸'} ${esc(group.name)}</span><span class="gi">${esc(group.ip)} · ${esc(group.os)}</span><span class="docker-version">Docker ${esc(group.dockerVersion || '—')} · ${esc(fmtTime(group.lastCollectedAt))}</span><span class="cnt"><span class="st ${ds[1]}">${esc(ds[0])}</span><span class="st ${group.summary.running === group.summary.total ? 'st-ok' : 'st-warn'}">${group.summary.running}/${group.summary.total} RUNNING</span></span></div>${open ? `${advice}${group.dockerStatus === 'available' ? (containers.length ? `<div class="docker-table-wrap"><table class="svc-table docker-table"><thead><tr><th>状态</th><th>名称</th><th>镜像</th><th>ID</th><th>端口</th><th>CPU</th><th>内存</th><th>网络IO</th><th>PIDs</th><th>健康</th><th>重启</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="docker-empty">未发现容器</div>') : ''}` : ''}</div>`;
  }).join('') : '<div class="docker-empty">尚无启用监控的主机</div>';
}
