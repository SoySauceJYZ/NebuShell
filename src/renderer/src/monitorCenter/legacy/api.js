// 传输层:原项目经 fetch('/api/...') + SSE 访问独立采集服务;
// 在 NebuShell 里改为 window.api.monitorCenter(IPC / Web 版 WebSocket),对外签名保持不变。
import { $, ctx, onDispose, visible } from './dom.js';

const listeners = new Set();
const eventListeners = new Set();
const linkListeners = new Set();

export const store = {
  connected: false,
  locked: false,
  devices: [],
  totals: null,
  lastTick: 0
};

const mc = () => window.api.monitorCenter;

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function route(method, path, body) {
  const url = new URL(path, 'http://local');
  const p = url.pathname.replace(/\/+$/, '');
  let m;
  if (method === 'GET') {
    if (p === '/api/events') return mc().events(Number(url.searchParams.get('limit')) || 50);
    if (p === '/api/devices') return mc().devices();
    if ((m = p.match(/^\/api\/devices\/([^/]+)$/))) {
      const d = await mc().device(decodeURIComponent(m[1]));
      if (!d) throw httpError('设备不存在', 404);
      return d;
    }
    if (p === '/api/services') return mc().services();
    if (p === '/api/llm') return mc().llm();
    if (p === '/api/overview') return mc().totals();
    if (p === '/api/topology') return mc().topology();
    if (p === '/api/physical-devices') return mc().managed();
  }
  if (method === 'PATCH' && (m = p.match(/^\/api\/physical-devices\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1]);
    let rows = null;
    if (body && body.enabled !== undefined) rows = await mc().setEnabled(id, !!body.enabled);
    if (body && body.sortOrder !== undefined) rows = await mc().setOrder(id, Number(body.sortOrder));
    return rows;
  }
  if (method === 'POST') {
    if ((m = p.match(/^\/api\/physical-devices\/([^/]+)\/test$/))) return mc().test(decodeURIComponent(m[1]));
    if (p === '/api/discover') return mc().discover(body && body.hostIds);
    if (p === '/api/discover/cancel') return mc().cancelDiscovery();
  }
  throw httpError(`不支持的接口：${method} ${p}`, 404);
}

/** IPC 抛出的错误会带上 "Error invoking remote method ..." 前缀,去掉只留原因。 */
function cleanError(e) {
  const msg = String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  return Object.assign(new Error(msg), { status: e && e.status });
}

export async function api(path, opts = {}) {
  try {
    return await route((opts.method || 'GET').toUpperCase(), path, opts.body);
  } catch (e) {
    throw cleanError(e);
  }
}

export const get = p => api(p);
export const post = (p, body) => api(p, Object.assign({ method: 'POST' }, body !== undefined ? { body } : {}));
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = p => api(p, { method: 'DELETE' });

export function onTick(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onEvent(fn) { eventListeners.add(fn); return () => eventListeners.delete(fn); }
export function onLink(fn) { linkListeners.add(fn); }
function emitLink() { linkListeners.forEach(fn => { try { fn(store.connected && !store.locked, store.locked); } catch (e) { /* noop */ } }); }

let lastData = null;
let missedEvents = [];

function dispatch(data, events) {
  listeners.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
  if (events.length) eventListeners.forEach(fn => { try { fn(events.slice()); } catch (e) { console.error(e); } });
}

/** 回到前台:用最近一次快照重绘,并补发隐藏期间的事件。 */
export function replay() {
  const events = missedEvents;
  missedEvents = [];
  if (lastData) dispatch(lastData, events);
}

/** 订阅主进程的 2 秒快照推送(替代原 /api/stream SSE)。 */
export function connect() {
  const off = mc().onTick(data => {
    if (!data || data.type !== 'tick') return;
    store.devices = data.devices;
    store.totals = data.totals;
    store.lastTick = data.t;
    const wasLocked = store.locked, wasConnected = store.connected;
    store.locked = !!data.locked;
    store.connected = true;
    if (wasLocked !== store.locked || !wasConnected) emitLink();
    lastData = data;
    // 模块不在屏幕上时不重绘,只攒下事件;回到前台时由 replay() 一次补上
    if (!visible()) {
      if (data.events && data.events.length) missedEvents = missedEvents.concat(data.events).slice(-50);
      return;
    }
    dispatch(data, data.events || []);
  });
  // 超过 8 秒没有推送 → 链路灯变红
  const watch = setInterval(() => {
    const stale = !store.lastTick || Date.now() - store.lastTick > 8000;
    if (stale === store.connected) { store.connected = !stale; emitLink(); }
  }, 2000);
  onDispose(() => {
    off();
    clearInterval(watch);
    listeners.clear();
    eventListeners.clear();
    linkListeners.clear();
    store.connected = false;
    lastData = null;
    missedEvents = [];
  });
}

export function fmtUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n * 10) / 10);
}

export function fmtTime(t) {
  const d = new Date(t);
  const p = x => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function toast(msg, err = false) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    ctx.app.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('err', err);
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}
