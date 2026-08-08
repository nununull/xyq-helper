import { computed, onBeforeUnmount, shallowRef } from 'vue'

interface PictureInPictureOptions {
  width: number
  height: number
}

interface DocumentPictureInPictureController {
  requestWindow(options: PictureInPictureOptions): Promise<Window>
}

type PictureInPictureHost = Window & {
  documentPictureInPicture?: DocumentPictureInPictureController
}

/** 创建答案画中画窗口，并提供可供 Vue Teleport 挂载的容器。 */
export function useAnswerPictureInPicture() {
  const pictureInPictureWindow = shallowRef<Window | null>(null)
  const mountTarget = shallowRef<HTMLElement | null>(null)
  const error = shallowRef('')
  const supported = 'documentPictureInPicture' in window
  const opened = computed(() => Boolean(pictureInPictureWindow.value && !pictureInPictureWindow.value.closed))

  /** 将主页面样式复制到画中画文档，保持答案组件的视觉风格一致。 */
  function copyApplicationStyles(targetDocument: Document): void {
    const styleNodes = document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
      'link[rel="stylesheet"], style',
    )
    for (const styleNode of styleNodes) {
      targetDocument.head.append(styleNode.cloneNode(true))
    }

    const overrides = targetDocument.createElement('style')
    overrides.textContent = `
      html, body {
        min-width: 0;
        min-height: 100%;
        overflow: hidden;
        background: #080e0d;
      }
      body { margin: 0; }
      #answer-picture-in-picture-root { height: 100vh; }
    `
    targetDocument.head.append(overrides)
  }

  /** 清理已经关闭的画中画窗口引用。 */
  function releaseWindow(expectedWindow?: Window): void {
    if (expectedWindow && pictureInPictureWindow.value !== expectedWindow) return
    mountTarget.value = null
    pictureInPictureWindow.value = null
  }

  /** 打开始终置顶的答案画中画窗口。 */
  async function open(): Promise<void> {
    error.value = ''
    if (opened.value) {
      pictureInPictureWindow.value?.focus()
      return
    }

    const controller = (window as PictureInPictureHost).documentPictureInPicture
    if (!controller) {
      error.value = '当前浏览器不支持悬浮答案，请使用最新版 Chrome 或 Edge'
      return
    }

    try {
      const floatingWindow = await controller.requestWindow({ width: 320, height: 180 })
      floatingWindow.document.title = '梦幻答题助手 · 悬浮答案'
      copyApplicationStyles(floatingWindow.document)

      const target = floatingWindow.document.createElement('div')
      target.id = 'answer-picture-in-picture-root'
      floatingWindow.document.body.append(target)

      pictureInPictureWindow.value = floatingWindow
      mountTarget.value = target
      floatingWindow.addEventListener('pagehide', () => releaseWindow(floatingWindow), { once: true })
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '悬浮答案窗口打开失败'
      releaseWindow()
    }
  }

  /** 关闭答案画中画窗口。 */
  function close(): void {
    const floatingWindow = pictureInPictureWindow.value
    releaseWindow(floatingWindow ?? undefined)
    if (floatingWindow && !floatingWindow.closed) floatingWindow.close()
  }

  /** 在打开与关闭状态之间切换。 */
  async function toggle(): Promise<void> {
    if (opened.value) close()
    else await open()
  }

  onBeforeUnmount(close)

  return {
    supported,
    opened,
    mountTarget,
    error,
    open,
    close,
    toggle,
  }
}
