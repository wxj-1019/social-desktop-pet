/**
 * PetFallback —— 星屿静态轮廓降级组件。
 *
 * 不播放动画（强制 reducedMotion），用于渲染器不可用 / 加载失败时
 * 保证桌面宠物位仍有角色剪影。复用 StarIsleVisual 同一套原创 SVG。
 */
import { DEFAULT_VISUAL_STATE } from './pet-renderer.js';
import { StarIsleVisual } from './star-isle-visual.js';

export interface PetFallbackProps {
  className?: string;
}

export function PetFallback({ className }: PetFallbackProps) {
  return (
    <div
      className={className ? `pet-fallback ${className}` : 'pet-fallback'}
      data-testid="star-isle-fallback"
    >
      <StarIsleVisual state={{ ...DEFAULT_VISUAL_STATE, reducedMotion: true }} />
    </div>
  );
}
