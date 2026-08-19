import React from 'react';
import { createRoot } from 'react-dom/client';

import { AppPanel } from './app/app.js';
import { getCharacterManifest } from './pet/character-manifests.js';
import { getCharacterConfig } from './pet/character-registry.js';
import { PetExperience } from './pet/pet-experience.js';
import { PocApp } from './poc/poc-app.js';
import './styles.css';
import './app/panel.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// 分流：?poc → 窗口能力自检（第 1–2 周门禁）；surface=pet → 桌宠直连交互面；
// 默认 → 主应用面板（Task 11：聊天驱动星屿动作，AppPanel 化）
const params = new URLSearchParams(window.location.search);
let root: React.ReactNode;
if (params.has('poc')) {
  root = <PocApp />;
} else if (params.get('surface') === 'pet') {
  // 角色皮肤：?character=codenono 选择 spritesheet 角色；缺省/未知 → 星屿
  const character = getCharacterConfig(params.get('character') ?? undefined);
  root = (
    <PetExperience
      VisualComponent={character.VisualComponent}
      rendererFactory={character.rendererFactory}
      petName={character.petName}
      manifest={getCharacterManifest(character.id)}
    />
  );
} else {
  root = <AppPanel />;
}

createRoot(el).render(<React.StrictMode>{root}</React.StrictMode>);
