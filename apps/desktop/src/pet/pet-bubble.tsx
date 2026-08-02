/**
 * PetBubble —— 星屿说话气泡。null 文本不渲染；固定 .pet-speech 类，
 * role=status / aria-live=polite 供读屏与测试定位。
 */
export function PetBubble({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="pet-speech" role="status" aria-live="polite">
      {text}
    </div>
  );
}
