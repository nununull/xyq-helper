import { onBeforeUnmount, ref, type Ref } from 'vue'

interface FavoriteDrag {
  categoryId: string
  targetId: string
  after: boolean
  pointerId: number
  handle: HTMLElement
  startY: number
  x: number
  y: number
  moved: boolean
}

/** 用同一套指针事件处理鼠标和触屏排序，只在松手时提交新位置。 */
export function useFavoriteSorting(
  list: Ref<HTMLElement | null>,
  reorder: (categoryId: string, targetId: string, after: boolean) => Promise<void>,
  disabled: () => boolean,
) {
  const drag = ref<FavoriteDrag | null>(null)
  let animationFrame = 0

  /** 根据指针命中的收藏行及上下半区确定插入位置。 */
  function updateTarget(): void {
    const current = drag.value
    if (!current?.moved || !list.value) return
    const target = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>('[data-favorite-id]')
    if (!target || !list.value.contains(target)) {
      current.targetId = ''
      return
    }
    current.targetId = target.dataset.favoriteId ?? ''
    const bounds = target.getBoundingClientRect()
    current.after = current.y >= bounds.top + bounds.height / 2
  }

  /** 拖到收藏列表边缘时自动滚动，让屏幕外的收藏也能参与排序。 */
  function scrollAtEdge(): void {
    const current = drag.value
    const container = list.value
    if (!current?.moved || !container) return
    const bounds = container.getBoundingClientRect()
    if (current.x >= bounds.left && current.x <= bounds.right && current.y >= bounds.top && current.y <= bounds.bottom) {
      if (current.y < bounds.top + 20) container.scrollTop -= 5
      else if (current.y > bounds.bottom - 20) container.scrollTop += 5
    }
    updateTarget()
    animationFrame = requestAnimationFrame(scrollAtEdge)
  }

  /** 从手柄捕获主指针，避免排序手势触发任务切换或页面滚动。 */
  function startDrag(event: PointerEvent, categoryId: string): void {
    if (event.button !== 0 || !event.isPrimary || disabled() || drag.value) return
    const handle = event.currentTarget as HTMLElement
    event.preventDefault()
    handle.focus()
    handle.setPointerCapture(event.pointerId)
    drag.value = { categoryId, targetId: '', after: false, pointerId: event.pointerId, handle, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false }
  }

  /** 超过轻触阈值才开始排序，并同步更新插入提示线。 */
  function moveDrag(event: PointerEvent): void {
    const current = drag.value
    if (!current || event.pointerId !== current.pointerId) return
    current.x = event.clientX
    current.y = event.clientY
    if (!current.moved && Math.abs(current.y - current.startY) < 5) return
    current.moved = true
    updateTarget()
    if (!animationFrame) animationFrame = requestAnimationFrame(scrollAtEdge)
  }

  /** 取消拖动并释放指针与动画帧；取消或移出列表不改变已保存顺序。 */
  function cancelDrag(): void {
    const current = drag.value
    drag.value = null
    cancelAnimationFrame(animationFrame)
    animationFrame = 0
    if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId)
  }

  /** 松手后仅提交列表内部的有效移动，点击手柄和取消操作均不保存。 */
  async function finishDrag(event: PointerEvent): Promise<void> {
    if (event.pointerId !== drag.value?.pointerId) return
    moveDrag(event)
    const current = drag.value
    cancelDrag()
    if (current?.moved && current.targetId) await reorder(current.categoryId, current.targetId, current.after)
  }

  onBeforeUnmount(cancelDrag)
  return { drag, startDrag, moveDrag, finishDrag, cancelDrag }
}
