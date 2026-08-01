/**
 * 6.2 记忆确认卡（D-3 分级确认）。
 * 敏感事实展示此卡：[记住] [仅本次聊天] [修改]
 */
export interface ConfirmCardProps {
  fact: string;
  onRemember?: () => void;
  onThisSessionOnly?: () => void;
  onEdit?: () => void;
}

export function ConfirmCard({ fact, onRemember, onThisSessionOnly, onEdit }: ConfirmCardProps) {
  return (
    <div className="memory-confirm-card">
      <p>我可以记住：&ldquo;{fact}&rdquo;</p>
      <div className="memory-confirm-actions">
        <button onClick={onRemember}>记住</button>
        <button onClick={onThisSessionOnly}>仅本次聊天</button>
        <button onClick={onEdit}>修改</button>
      </div>
    </div>
  );
}
