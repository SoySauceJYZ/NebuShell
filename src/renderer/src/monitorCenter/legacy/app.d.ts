// 类型声明:legacy/ 下是从 resource-monitor 原样移植的原生 JS 前端。
export const TEMPLATE: string
export function mount(shadowRoot: ShadowRoot, hooks?: { openHosts?: () => void }): void
/** 模块重新可见时调用:补绘最新数据、恢复动画。 */
export function resume(): void
export function unmount(): void
