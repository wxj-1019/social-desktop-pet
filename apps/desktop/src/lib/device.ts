/**
 * 设备标识（9.8 设备维度）—— 渲染进程生成一次并持久化。
 * 首次登录注册设备；后续登录复用同一 device_id。
 */
const KEY = 'pet:deviceId';

export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(KEY, id);
  return id;
}
