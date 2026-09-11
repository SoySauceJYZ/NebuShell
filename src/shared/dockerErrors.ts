/**
 * docker 报错 → 可操作的中文提示。主进程(容器文件后端)与渲染层(容器面板)共用一份,
 * 保证同一个错误在哪儿看到都是同样的措辞。匹配不到的原样返回(截断),不吞掉信息。
 */

const RULES: Array<{ re: RegExp; msg: string }> = [
  {
    re: /cannot connect to the docker daemon|is the docker daemon running|docker daemon is not running/i,
    msg: 'Docker 服务未运行(请在该主机上启动 docker:systemctl start docker)'
  },
  {
    re: /permission denied while trying to connect to the docker daemon|dial unix .*docker\.sock: connect: permission denied/i,
    msg: '当前用户无权访问 Docker(可把用户加入 docker 组后重新登录,或改用免密 sudo)'
  },
  {
    re: /no such container|no such object|is not a valid container/i,
    msg: '容器不存在(可能已被删除,刷新列表看看)'
  },
  {
    re: /is not running|container .* is not running/i,
    msg: '容器未在运行(该操作需要容器处于运行状态)'
  },
  {
    re: /container .* is paused/i,
    msg: '容器已暂停,请先恢复(unpause)再操作'
  },
  {
    re: /you cannot remove a running container/i,
    msg: '运行中的容器不能直接删除,请先停止,或使用强制删除'
  },
  {
    re: /port is already allocated|address already in use|bind: address already in use/i,
    msg: '端口已被占用(先停掉占用该端口的容器/进程,或改用别的端口)'
  },
  {
    re: /no space left on device/i,
    msg: '磁盘空间不足(可以用「清理」里的 prune 回收未使用的镜像/卷/构建缓存)'
  },
  {
    re: /image is being used by (running )?container|conflict: unable to (delete|remove)/i,
    msg: '该镜像正被容器占用,需先删除相关容器(或强制删除)'
  },
  {
    re: /volume is in use/i,
    msg: '该卷正被容器使用,需先删除相关容器'
  },
  {
    re: /has active endpoints/i,
    msg: '该网络上仍有容器连着,需先断开或删除这些容器'
  },
  {
    re: /executable file not found|OCI runtime exec failed|starting container process caused/i,
    msg: '容器内没有可用的 shell/工具,无法执行该操作(可能是 distroless 镜像)'
  },
  {
    re: /manifest unknown|pull access denied|repository does not exist/i,
    msg: '镜像不存在或无权拉取(检查镜像名/标签与登录状态)'
  }
]

/** 把一段 docker stderr 映射成中文提示;没有命中规则时回落到原文(最多 500 字)。 */
export function mapDockerError(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return '操作失败'
  for (const r of RULES) {
    if (r.re.test(s)) return r.msg
  }
  return s.slice(0, 500)
}
