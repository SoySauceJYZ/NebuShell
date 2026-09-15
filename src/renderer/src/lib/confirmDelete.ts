import type { FileEntry } from '../components/sftp/FileTable'

/**
 * 删除前的确认框。三个文件面板(SFTP / 容器 / 本机)共用一份措辞。
 *
 * 目录现在是**递归删除**(rm -rf 语义,非空也删),所以这里必须把这件事说清楚 ——
 * 以前的提示是「目录必须为空才能删除」,那是相反的语义,照抄会误导人。
 */
export function confirmDelete(targets: FileEntry[]): Promise<boolean> {
  if (targets.length === 0) return Promise.resolve(false)
  const dirCount = targets.filter((t) => t.type === 'directory').length
  const names = targets.map((t) => t.name)
  const listed =
    names.length <= 10
      ? names.join('、')
      : `${names.slice(0, 10).join('、')} …(共 ${names.length} 项)`

  const lines: string[] = []
  if (targets.length > 1) lines.push(listed)
  lines.push(
    dirCount > 0 ? '目录会连同里面的内容一并删除(rm -rf),删除后无法恢复。' : '删除后无法恢复。'
  )

  return window.api.dialog.confirm({
    message:
      targets.length === 1
        ? `确定删除 “${targets[0].name}”?`
        : `确定删除选中的 ${targets.length} 项?`,
    detail: lines.join('\n\n'),
    confirmLabel: '删除',
    cancelLabel: '取消'
  })
}
