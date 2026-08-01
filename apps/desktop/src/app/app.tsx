import { Bubble } from '@pet/ui';
import { useEffect, useState } from 'react';

/** 主应用骨架。第 3 周起接入 Pet Renderer / Chat / Friends 等。 */
export function App() {
  const [version, setVersion] = useState('loading');

  useEffect(() => {
    // 8.3 preload 暴露的版本化 API（类型见 src/types/pet-api.d.ts）
    if (window.pet) setVersion(window.pet.version);
  }, []);

  return (
    <div className="pet-stage">
      <Bubble text={`AI 桌宠骨架（v${version}）`} />
      {/* 7.1 PetStateMachine + Cubism Renderer 将在此挂载 */}
    </div>
  );
}
