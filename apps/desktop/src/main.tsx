import React from 'react';
import { createRoot } from 'react-dom/client';

import { AppPanel } from './app/app.js';
import { PetExperience } from './pet/pet-experience.js';
import { PocApp } from './poc/poc-app.js';
import './styles.css';
import './app/panel.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// 分流：?poc → 窗口能力自检（第 1–2 周门禁）；surface=pet → 星屿直连交互面；
// 默认 → 主应用面板（Task 11：聊天驱动星屿动作，AppPanel 化）
const params = new URLSearchParams(window.location.search);
const root = params.has('poc') ? (
  <PocApp />
) : params.get('surface') === 'pet' ? (
  <PetExperience />
) : (
  <AppPanel />
);

createRoot(el).render(<React.StrictMode>{root}</React.StrictMode>);
