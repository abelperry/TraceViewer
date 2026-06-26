import { useCallback, useRef } from 'react';

/**
 * 列宽拖拽手柄。放在列容器内（列需 position: relative）。
 * 拖动时实时更新宽度，限制在 [min, max] 之间。
 */
export function ColResizer({
  width,
  setWidth,
  min = 160,
  max = 640,
}: {
  width: number;
  setWidth: (w: number) => void;
  min?: number;
  max?: number;
}) {
  const startX = useRef(0);
  const startW = useRef(0);
  const dragging = useRef(false);

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging.current) return;
      const next = Math.min(max, Math.max(min, startW.current + (e.clientX - startX.current)));
      setWidth(next);
    },
    [min, max, setWidth],
  );

  const onUp = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }, [onMove]);

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return <div className="col-resizer" onMouseDown={onDown} title="拖动调整宽度" />;
}
