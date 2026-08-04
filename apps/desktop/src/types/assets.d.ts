/**
 * 静态资产模块声明 —— 让 TS 识别 Vite 的资产 import。
 * Vite 在 dev/prod 都会把 import 解析为 URL 字符串（'self' 源，CSP 零改动）。
 */
declare module '*.webp' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.jpeg' {
  const src: string;
  export default src;
}
