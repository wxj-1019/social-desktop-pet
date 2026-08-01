/**
 * 窗口能力 PoC —— 第 1–2 周门禁（设计稿 16 章第 2/3 项）。
 *
 * 通过 `POC_MODE=1 pnpm --filter @pet/desktop dev` 启动，
 * 验证（Windows 优先，D-2）：
 *  1. 透明窗口（无黑底、边缘正常）
 *  2. 整窗穿透切换（8.4：setIgnoreMouseEvents + forward）
 *  3. 多屏（跨屏拖拽、负坐标、DPI 变化）
 * 结果记录到 docs/poc-window-capabilities.md。
 */
import { useEffect, useState } from 'react';

// window.pet 类型来自 src/types/pet-api.d.ts（全局声明）

interface DisplayInfo {
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export function PocApp() {
  const [passThrough, setPassThrough] = useState(false);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [windowSize, setWindowSize] = useState({ w: 0, h: 0 });
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    // PoC 专用 IPC（preload: getDisplays → main: poc:getDisplays），读真实多屏数据
    void window.pet
      ?.getDisplays()
      .then((raw) => setDisplays(raw as DisplayInfo[]))
      .catch(() => {
        // 降级：渲染进程自身信息
        setDisplays([
          {
            id: 'primary',
            bounds: {
              x: window.screenX,
              y: window.screenY,
              width: window.innerWidth,
              height: window.innerHeight,
            },
            scaleFactor: window.devicePixelRatio,
          },
        ]);
      });
    setWindowSize({ w: window.innerWidth, h: window.innerHeight });
  }, []);

  function togglePassThrough() {
    const next = !passThrough;
    setPassThrough(next);
    // 8.4：整窗穿透切换（forward:true 让鼠标事件仍进渲染进程，alpha 探测后切回）
    window.pet?.setIgnoreMouseEvents(next);
    setLog((l) => [`${new Date().toISOString()} 穿透切换 → ${next ? 'ON' : 'OFF'}`, ...l]);
  }

  return (
    <div
      className="poc"
      style={{ background: 'transparent', padding: 16, color: '#fff', fontFamily: 'monospace' }}
    >
      <h2>窗口能力 PoC（Windows，D-2）</h2>
      <p>
        版本 {window.pet?.version ?? 'n/a'} · {window.pet?.platform ?? 'n/a'}
      </p>

      <button onClick={togglePassThrough} style={{ padding: 8, marginRight: 8 }}>
        穿透 {passThrough ? 'ON（点击穿透）' : 'OFF'}
      </button>
      <button onClick={() => setLog([])} style={{ padding: 8 }}>
        清空日志
      </button>

      <h3>显示器</h3>
      <ul>
        {displays.map((d) => (
          <li key={d.id}>
            {d.id}: ({d.bounds.x},{d.bounds.y}) {d.bounds.width}×{d.bounds.height} @ {d.scaleFactor}
            x
          </li>
        ))}
      </ul>
      <p>
        窗口尺寸: {windowSize.w}×{windowSize.h} · 位置: ({window.screenX},{window.screenY})
      </p>

      <h3>事件日志</h3>
      <pre style={{ fontSize: 11, maxHeight: 200, overflow: 'auto' }}>
        {log.join('\n') || '(空)'}
      </pre>
    </div>
  );
}
