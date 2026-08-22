/**
 * ViewHeading —— 面板页统一标题区（UI 收口组件）。
 * 头像（角色视觉或图标）+ eyebrow 眉题 + h2 主标题 + 可选右侧操作区。
 * 此前 friends/memories/settings/model-settings 四处复制同构 JSX，此为唯一实现。
 */
import type { ReactNode } from 'react';

export function ViewHeading({
  avatar,
  eyebrow,
  title,
  headingId,
  actions,
}: {
  avatar: ReactNode;
  eyebrow: string;
  title: ReactNode;
  /** main[aria-labelledby] 指向的 h2 id（无障碍关联，可选） */
  headingId?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="view-heading">
      <div className="view-heading__identity">
        <span className="view-heading__avatar" aria-hidden="true">
          {avatar}
        </span>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={headingId}>{title}</h2>
        </div>
      </div>
      {actions}
    </div>
  );
}
