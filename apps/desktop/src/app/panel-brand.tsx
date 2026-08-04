import type { StarIsleVisualState } from '../pet/pet-renderer.js';
import { StarIsleVisual } from '../pet/star-isle-visual.js';

interface PanelBrandProps {
  subtitle?: string;
  /** 头像尺寸：默认 68（启动加载）；hero 72（登录页） */
  size?: 'default' | 'hero';
  /** 实时视觉状态（如聊天流式时的 speaking 说话态） */
  state?: StarIsleVisualState;
}

export function PanelBrand({ subtitle, size = 'default', state }: PanelBrandProps) {
  return (
    <div className="panel-brand">
      <div
        className={
          size === 'hero' ? 'panel-brand__avatar panel-brand__avatar--hero' : 'panel-brand__avatar'
        }
        aria-hidden="true"
      >
        {/* full variant + CSS 圆形裁剪：自然聚焦头部区域，避免 head viewBox 取景误差 */}
        <StarIsleVisual state={state} />
      </div>
      <div className="panel-brand__copy">
        <strong>星屿</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </div>
  );
}
