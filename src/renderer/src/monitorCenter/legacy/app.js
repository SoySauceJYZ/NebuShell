import { connect, onTick, onEvent, onLink, get, fmtTime, replay } from './api.js';
import { setChartTheme } from './charts.js';
import { initDrawer, closeDrawer } from './drawer.js';
import { ctx, $id, $, $$, every, listen, disposeAll, visible } from './dom.js';
import * as overview from './views/overview.js';
import * as services from './views/services.js';
import * as topology from './views/topology.js';
import * as monitor from './views/monitor.js';
import * as devices from './views/devices.js';

const VIEWS = { overview, services, topology, monitor, devices };
const recentEvents = [];

// 原 index.html 的骨架(只多了全屏按钮)。
export const TEMPLATE = `
<div id="app">
  <header class="hdr">
    <div class="hdr-brand">
      <div class="brand-mark">⌁</div>
      <div>
        <div class="brand-name">GRID-WATCH</div>
        <div class="brand-sub">WASTELAND DC OPS · SECTOR 07</div>
      </div>
    </div>
    <nav class="hdr-nav">
      <button class="nav-btn active" data-view="overview">总览大屏<span class="kbd">FLEET · [1]</span></button>
      <button class="nav-btn" data-view="services">服务配置<span class="kbd">DOCKER · [2]</span></button>
      <button class="nav-btn" data-view="topology">网络拓扑<span class="kbd">TOPOLOGY · [3]</span></button>
      <button class="nav-btn" data-view="monitor">监控中心<span class="kbd">LLM / DB / APP · [4]</span></button>
      <button class="nav-btn" data-view="devices">设备管理<span class="kbd">DEVICES · [5]</span></button>
    </nav>
    <div class="hdr-right">
      <div class="skin-sw" id="skin-sw">
        <button class="skin-btn active" data-skin="amber">AMBER 琥珀</button>
        <button class="skin-btn" data-skin="pipboy">☢ PIP-BOY</button>
      </div>
      <div class="skin-sw"><button class="skin-btn fs-btn" id="fs-btn" title="全屏大屏模式 (F11 / Esc 退出)">⛶<span class="fs-text"> 全屏</span></button></div>
      <div class="link-led"><span class="led" id="link-led"></span><span id="link-text">PROBE LINK</span></div>
      <div class="hdr-clock">
        <div class="t" id="clock-t">--:--:--</div>
        <div class="d" id="clock-d">----.--.--</div>
      </div>
    </div>
  </header>

  <main class="main">
    <section class="view active" id="view-overview"></section>
    <section class="view" id="view-services"></section>
    <section class="view" id="view-topology"></section>
    <section class="view" id="view-monitor"></section>
    <section class="view" id="view-devices"></section>
  </main>

  <footer class="ticker">
    <div class="ticker-track" id="ticker-track">等待探针数据……</div>
  </footer>
</div>

<div class="drawer-mask" id="drawer-mask"></div>
<aside class="drawer" id="drawer">
  <div class="dr-head">
    <div>
      <div class="dr-title" id="drawer-title">—</div>
      <div class="dr-sub" id="drawer-sub">—</div>
    </div>
    <button class="dr-close" id="drawer-close">✕</button>
  </div>
  <div class="dr-body" id="drawer-body"></div>
</aside>`;

function switchView(name) {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  const mod = VIEWS[name];
  if (mod && mod.refresh) mod.refresh();
}

function applySkin(name) {
  ctx.app.classList.toggle('theme-pipboy', name === 'pipboy');
  setChartTheme(name);
  $$('.skin-btn[data-skin]').forEach(b => b.classList.toggle('active', b.dataset.skin === name));
  try { localStorage.setItem('gw-skin', name); } catch (e) { /* noop */ }
}

// ---------- 全屏 ----------
// 优先用浏览器 Fullscreen API;被宿主拦截(如嵌入的 webview、iframe 未授权)时
// 退回「窗口内大屏」:把模块铺满整个应用窗口,Esc / 再点一次退出。
const nativeFullscreen = () => !!ctx.root && document.fullscreenElement === ctx.root.host;
const pseudoFullscreen = () => !!ctx.root && ctx.root.host.classList.contains('gw-pseudo-fs');
const isFullscreen = () => nativeFullscreen() || pseudoFullscreen();
function setPseudo(on) {
  ctx.root.host.classList.toggle('gw-pseudo-fs', on);
  syncFullscreen();
}
function toggleFullscreen() {
  if (nativeFullscreen()) { document.exitFullscreen().catch(() => {}); return; }
  if (pseudoFullscreen()) { setPseudo(false); return; }
  const host = ctx.root.host;
  let settled = false;
  const fallback = () => { if (!settled && ctx.root && !nativeFullscreen()) { settled = true; setPseudo(true); } };
  if (document.fullscreenEnabled && host.requestFullscreen) {
    host.requestFullscreen({ navigationUI: 'hide' }).then(() => { settled = true; }, fallback);
    setTimeout(fallback, 700);
  } else fallback();
}
function syncFullscreen() {
  if (!ctx.root) return;
  if (nativeFullscreen() && pseudoFullscreen()) ctx.root.host.classList.remove('gw-pseudo-fs');
  const on = isFullscreen();
  const btn = $id('fs-btn');
  if (btn) { btn.innerHTML = on ? '⛶<span class="fs-text"> 退出全屏</span>' : '⛶<span class="fs-text"> 全屏</span>'; btn.classList.toggle('active', on); }
  ctx.app.classList.toggle('is-fullscreen', on);
}

/**
 * 挂载整个 GRID-WATCH 界面。
 * @param {ShadowRoot} shadowRoot  已经放入样式和 TEMPLATE 的影子根
 * @param {{ openHosts?: () => void }} hooks
 */
export function mount(shadowRoot, hooks = {}) {
  ctx.root = shadowRoot;
  ctx.app = shadowRoot.querySelector('.gw-root');
  ctx.hooks = hooks;
  recentEvents.length = 0;

  initDrawer();
  let saved = 'amber';
  try { saved = localStorage.getItem('gw-skin') || 'amber'; } catch (e) { /* noop */ }
  applySkin(saved);
  listen($id('skin-sw'), 'click', e => {
    const b = e.target.closest('.skin-btn');
    if (b) applySkin(b.dataset.skin);
  });
  for (const [name, mod] of Object.entries(VIEWS)) {
    mod.mount($id(`view-${name}`));
  }

  listen($('.hdr-nav'), 'click', e => {
    const b = e.target.closest('.nav-btn');
    if (b) switchView(b.dataset.view);
  });

  listen($id('fs-btn'), 'click', toggleFullscreen);
  listen(document, 'fullscreenchange', syncFullscreen);

  // 快捷键只在最近一次点击落在监控中心里、且标签页可见时生效(不抢终端的按键)
  let inside = false;
  listen(document, 'pointerdown', e => { inside = e.composedPath().includes(ctx.app); }, true);
  listen(document, 'keydown', e => {
    if (!visible() || (!inside && !isFullscreen())) return;
    const target = e.composedPath()[0];
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
    if (e.key === 'Escape' && pseudoFullscreen() && !$id('drawer').classList.contains('open')) { setPseudo(false); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const map = { 1: 'overview', 2: 'services', 3: 'topology', 4: 'monitor', 5: 'devices' };
    if (map[e.key]) switchView(map[e.key]);
  });

  const clock = () => {
    const d = new Date();
    const p = x => String(x).padStart(2, '0');
    $id('clock-t').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    $id('clock-d').textContent = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} SECTOR-07`;
  };
  clock();
  every(1000, clock);

  onLink((ok, locked) => {
    $id('link-led').classList.toggle('off', !ok);
    $id('link-text').textContent = ok ? 'PROBE LINK' : locked ? 'VAULT LOCKED' : 'LINK LOST';
  });

  onEvent(evs => {
    recentEvents.unshift(...evs.reverse());
    if (recentEvents.length > 14) recentEvents.length = 14;
    renderTicker();
  });

  onTick(data => renderTicker(data.totals));

  get('/api/events?limit=12').then(evs => {
    recentEvents.push(...evs);
    renderTicker();
  }).catch(() => {});

  connect();
}

/** 模块重新出现在屏幕上:用最新快照重绘,并刷新当前视图(拓扑页会重新启动逐帧动画)。 */
export function resume() {
  if (!ctx.root) return;
  replay();
  const act = $('.view.active');
  const mod = act && VIEWS[act.id.replace(/^view-/, '')];
  if (mod && mod.refresh) mod.refresh();
}

export function unmount() {
  if (nativeFullscreen()) document.exitFullscreen().catch(() => {});
  if (pseudoFullscreen()) ctx.root.host.classList.remove('gw-pseudo-fs');
  closeDrawer();
  disposeAll();
  ctx.root = null;
  ctx.app = null;
}

let lastTotals = null;
function renderTicker(totals) {
  if (totals) lastTotals = totals;
  const t = lastTotals;
  const el = $id('ticker-track');
  if (!el) return;
  const stat = t ? `节点 <b>${t.devices}</b> · GPU <b>${t.gpus}</b> 均载 <b>${t.gpuUtilAvg ?? 'N/A'}%</b> · 显存 <b>${t.vramUsed ?? 'N/A'}/${t.vramTotal ?? 'N/A'}GB</b> · 推理 <b>${t.tpsTotal} tok/s</b> · 服务 <b>${t.svcUp}/${t.svcTotal}</b> · 功耗 <b>${t.powerKw ?? 'N/A'}KW</b> · 告警24H <b>${t.alerts24h}</b>` : '探针同步中';
  const evs = recentEvents.slice(0, 8).map(e => `[${fmtTime(e.t)}] ${e.device}: ${e.msg}`).join(' ｜ ');
  el.innerHTML = `${stat}&nbsp;&nbsp;▚&nbsp;&nbsp;${escapeHtml(evs) || '暂无事件'}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
