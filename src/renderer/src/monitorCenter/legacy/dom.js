// 原项目直接操作 document;移植进 NebuShell 后整个界面挂在一个 Shadow DOM 里。
// 这里提供作用域内的查询函数,并登记定时器/监听器,卸载时统一清理。

export const ctx = {
  /** @type {ShadowRoot|null} */
  root: null,
  /** @type {HTMLElement|null} .gw-root 容器(主题 class、全屏都作用在它上面) */
  app: null,
  /** @type {Array<() => void>} */
  disposers: [],
  /** React 外壳传入的回调(例如打开 NebuShell 的「主机」页) */
  hooks: {}
};

export const $id = id => ctx.root ? ctx.root.getElementById(id) : null;
export const $ = sel => ctx.root ? ctx.root.querySelector(sel) : null;
export const $$ = sel => ctx.root ? ctx.root.querySelectorAll(sel) : [];

export function onDispose(fn) { ctx.disposers.push(fn); }

export function every(ms, fn) {
  const t = setInterval(fn, ms);
  onDispose(() => clearInterval(t));
  return t;
}

export function listen(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  onDispose(() => target.removeEventListener(type, fn, opts));
}

/**
 * 按需运行的逐帧循环:shouldRun() 为假时彻底停掉 requestAnimationFrame(不空转),
 * 需要时调用返回的 wake() 重新启动。
 */
export function frameLoop(fn, shouldRun = () => true) {
  let raf = 0, running = false, alive = true;
  const step = () => {
    if (!alive || !shouldRun()) { running = false; raf = 0; return; }
    fn();
    raf = requestAnimationFrame(step);
  };
  const wake = () => {
    if (!alive || running || !shouldRun()) return;
    running = true;
    raf = requestAnimationFrame(step);
  };
  onDispose(() => { alive = false; if (raf) cancelAnimationFrame(raf); });
  wake();
  return wake;
}

export function disposeAll() {
  const list = ctx.disposers.splice(0);
  for (const fn of list.reverse()) { try { fn(); } catch (e) { console.error(e); } }
}

/** 模块当前是否真的在屏幕上:标签页在后台(display:none)或窗口最小化时为假。 */
export function visible() {
  if (!ctx.app || document.visibilityState === 'hidden') return false;
  return ctx.app.offsetParent !== null || document.fullscreenElement === ctx.root?.host;
}
