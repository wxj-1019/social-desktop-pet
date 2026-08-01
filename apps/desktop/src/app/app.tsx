import { Bubble } from '@pet/ui';
import { useEffect, useState } from 'react';

import { usePetStateMachine } from '../pet/use-pet-state-machine.js';

/** 主应用骨架。第 3 周起接入 Pet Renderer / Chat / Friends 等。 */
export function App() {
  const [version, setVersion] = useState('loading');
  // 7.1 状态机已接入（第 3 周接 Live2D MotionController：state → motion）
  const pet = usePetStateMachine();

  useEffect(() => {
    // 8.3 preload 暴露的版本化 API（类型见 src/types/pet-api.d.ts）
    if (window.pet) setVersion(window.pet.version);
  }, []);

  return (
    <div className="pet-stage">
      <Bubble text={`AI 桌宠骨架（v${version} · ${pet.state}）`} />
      {/* 7.1 Live2D MotionController 将按 pet.state 播放对应动画 */}
    </div>
  );
}
