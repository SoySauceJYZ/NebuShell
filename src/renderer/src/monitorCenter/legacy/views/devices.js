import { get, post, patch, toast } from '../api.js';
import { ctx } from '../dom.js';

let root = null;
let rows = [];
let loading = false;

const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[c]);
const statusText = { online:'在线', degraded:'采集异常', auth_failed:'认证失败', unreachable:'不可达', unsupported:'不支持', disabled:'已停用', pending:'等待采集' };
const statusClass = status => status === 'online' ? 'st-ok' : status === 'disabled' || status === 'pending' ? 'st-dim' : status === 'degraded' || status === 'unsupported' ? 'st-warn' : 'st-crit';
const authText = { password: '密码', key: '私钥', credential: '密钥库凭据' };

// 设备来自 NebuShell 主机库(加密保险库)——这里只控制是否纳入监控与显示顺序,凭据在「主机」页维护。
export function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="devman-head"><div><div class="sect-h">设备管理 · PHYSICAL DEVICE CONTROL</div><div class="devman-note">设备即 NebuShell「主机」页中已配置的服务器，凭据保存在加密保险库中，本页不读取也不显示密码。新增 / 编辑主机请前往「主机」页；此处只控制是否纳入监控与显示顺序。</div></div><div class="devman-actions"><button class="btn" data-action="hosts">管理主机</button><button class="btn ghost" data-action="refresh">刷新</button></div></div>
    <div class="kpi-band devman-kpis" id="devman-kpis"></div>
    <div class="panel devman-panel"><div class="devman-table-wrap"><table class="svc-table devman-table"><thead><tr><th>设备</th><th>地址</th><th>系统 / 认证</th><th>状态</th><th>最后采集</th><th>最近错误</th><th>排序</th><th>操作</th></tr></thead><tbody id="devman-body"></tbody></table></div></div>`;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  load();
}

export function refresh() { load(); }

async function load() {
  if (loading) return;
  loading = true;
  const refresh = root?.querySelector('[data-action="refresh"]');
  if (refresh) refresh.disabled = true;
  try { rows = await get('/api/physical-devices'); render(); }
  catch (error) { toast(error.message, true); }
  finally { loading = false; if (refresh) refresh.disabled = false; }
}

function render() {
  const enabled = rows.filter(row => row.enabled).length;
  const online = rows.filter(row => row.enabled && row.status === 'online').length;
  const abnormal = rows.filter(row => row.enabled && row.status !== 'online' && row.status !== 'pending').length;
  root.querySelector('#devman-kpis').innerHTML = [
    ['设备总数', rows.length, '主机库全部主机', ''], ['启用设备', enabled, '纳入采集与矩阵', 'k-cyan'],
    ['在线设备', online, '最近采集成功', 'k-toxic'], ['异常设备', abnormal, '不可达 / 认证 / 采集异常', 'k-red']
  ].map(([label,value,sub,cls]) => `<div class="kpi ${cls}"><div class="lb">${label}</div><div class="vl">${value}</div><div class="sub">${sub}</div></div>`).join('');
  root.querySelector('#devman-body').innerHTML = rows.length ? rows.map(row => `
    <tr class="${row.enabled ? '' : 'disabled'}">
      <td><b>${esc(row.name)}</b><small>${esc(row.hostname || row.username)}</small></td><td class="addr">${esc(row.username)}@${esc(row.host)}:${row.port}</td>
      <td>${esc(row.osName || row.osType || 'unknown')}<small>SSH · ${esc(authText[row.authType] || row.authType)}</small></td>
      <td><span class="st ${statusClass(row.status)}">${statusText[row.status] || esc(row.status)}</span></td>
      <td>${row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : '从未成功'}</td><td class="devman-error" title="${esc(row.lastError || '')}">${esc(row.lastError || '无')}</td>
      <td><input class="devman-order" type="number" data-order="${esc(row.id)}" value="${row.sortOrder}"></td>
      <td><div class="devman-row-actions"><button class="btn ghost" data-action="test" data-id="${esc(row.id)}" ${row.enabled ? '' : 'disabled'}>测试</button><button class="btn ghost" data-action="toggle" data-id="${esc(row.id)}">${row.enabled ? '停用' : '启用'}</button><button class="btn ghost" data-action="hosts">编辑</button></div></td>
    </tr>`).join('') : '<tr><td colspan="8" class="devman-empty">主机库中还没有服务器（或保险库未解锁）· 请先在「主机」页添加</td></tr>';
}

function onClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'refresh') return load();
  if (action === 'hosts') return ctx.hooks.openHosts && ctx.hooks.openHosts();
  const row = rows.find(item => item.id === button.dataset.id);
  if (!row) return;
  if (action === 'toggle') return run(button, () => patch(`/api/physical-devices/${row.id}`, { enabled: !row.enabled }), row.enabled ? '设备已停用' : '设备已启用');
  if (action === 'test') return run(button, () => post(`/api/physical-devices/${row.id}/test`), '连接测试完成');
}

async function onChange(event) {
  const input = event.target.closest('[data-order]');
  if (!input) return;
  try { await patch(`/api/physical-devices/${input.dataset.order}`, { sortOrder: Number(input.value) }); toast('排序已更新'); await load(); }
  catch (error) { toast(error.message, true); }
}

async function run(button, task, message) {
  button.disabled = true;
  const old = button.textContent;
  button.textContent = '处理中…';
  try { await task(); toast(message); await load(); }
  catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.textContent = old; }
}
