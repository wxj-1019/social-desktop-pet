import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app.js';
import { PocApp } from './poc/poc-app.js';
import './styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// PoC 模式：URL 带 ?poc 时进入窗口能力自检（第 1–2 周门禁；透明/穿透/多屏）
const isPoc = new URLSearchParams(window.location.search).has('poc');

createRoot(el).render(<React.StrictMode>{isPoc ? <PocApp /> : <App />}</React.StrictMode>);
