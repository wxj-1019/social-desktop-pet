/**
 * PetBubble —— 星屿说话气泡。null 文本不渲染；固定 .pet-speech 类，
 * role=status / aria-live=polite 供读屏与测试定位。
 * 键盘可达（UI 收口）：tabIndex + Enter/Space 直达聊天（与指针点击同路径）。
 */
export function PetBubble({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div
      className="pet-speech"
      role="status"
      aria-live="polite"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.pet?.panel?.open({ view: 'chat' });
        }
      }}
    >
      {text}
    </div>
  );
}
