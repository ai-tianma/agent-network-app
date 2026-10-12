import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

type HoverTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Keep pointer-only state in one row: moving the mouse must not rerender the table.
 * Native DOM enter/leave do not flicker when crossing nested Pressable cells.
 * No wrapper element, so row layout, keyboard navigation and drag targets stay intact.
 */
export default function TaskListRowHover({ enabled, resetKey, children }: {
  enabled: boolean;
  resetKey?: string;
  children: (hovered: boolean, ref: (element: HoverTarget | null) => void) => ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const detach = useRef<(() => void) | null>(null);
  const rowRef = useCallback((element: HoverTarget | null) => {
    detach.current?.();
    detach.current = null;
    if (!enabled || !element?.addEventListener) return;
    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    detach.current = () => {
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
    };
  }, [enabled]);
  useEffect(() => { setHovered(false); }, [enabled, resetKey]);
  // React calls the ref with null on removal, detaching both listeners.
  return children(enabled && hovered, rowRef);
}
