/** 设置页：桌宠大小 / 气泡开关 / 减弱动态（大小写回 Main setPetScale，其余写 petProfile）。 */
import { Bell, BellOff, Maximize2, Settings2, Turtle } from 'lucide-react';
import { useEffect, useState } from 'react';

/** 设置页滑块范围（60%–140%，Main 端 MIN/MAX_PET_SCALE 内） */
const SCALE_MIN = 0.6;
const SCALE_MAX = 1.4;

export function SettingsPage() {
  const [bubbleEnabled, setBubbleEnabled] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [petScale, setPetScale] = useState(1);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void window.pet?.petProfile.get().then((profile) => {
      setBubbleEnabled(profile.bubbleEnabled);
      setReducedMotion(profile.reducedMotion);
      setLoaded(true);
    });
    void window.pet?.getPetScale?.().then((scale) => {
      if (typeof scale === 'number') setPetScale(scale);
    });
  }, []);

  async function save(next: { bubbleEnabled?: boolean; reducedMotion?: boolean }) {
    const profile = await window.pet.petProfile.get();
    const updated = { ...profile, ...next };
    const saved = await window.pet.petProfile.set(updated);
    setBubbleEnabled(saved.bubbleEnabled);
    setReducedMotion(saved.reducedMotion);
  }

  if (!loaded) {
    return (
      <main className="settings-page" aria-label="设置">
        <div className="friends-state" role="status">
          <span className="soft-loader" aria-hidden="true" />
          <p>正在加载设置…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="settings-page" aria-label="设置">
      <div className="view-heading">
        <div className="view-heading__identity">
          <span className="view-heading__avatar" aria-hidden="true">
            <Settings2 size={18} />
          </span>
          <div>
            <p className="eyebrow">偏好</p>
            <h2>设置</h2>
          </div>
        </div>
      </div>

      <div className="settings-list">
        <label className="settings-item">
          <span className="settings-item__icon" aria-hidden="true">
            <Maximize2 size={16} />
          </span>
          <span className="settings-item__text">
            <strong>桌宠大小</strong>
            <small>当前 {Math.round(petScale * 100)}%（也可以右键星屿快速切换）</small>
          </span>
          <input
            className="settings-item__range"
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={0.05}
            value={petScale}
            onChange={(e) => {
              const scale = Number(e.target.value);
              setPetScale(scale);
              window.pet?.setPetScale?.(scale);
            }}
            aria-label="桌宠大小调节"
          />
        </label>

        <label className="settings-item">
          <span className="settings-item__icon" aria-hidden="true">
            {bubbleEnabled ? <Bell size={16} /> : <BellOff size={16} />}
          </span>
          <span className="settings-item__text">
            <strong>说话气泡</strong>
            <small>聊天和互动时星屿会冒泡说话</small>
          </span>
          <input
            type="checkbox"
            checked={bubbleEnabled}
            onChange={(e) => void save({ bubbleEnabled: e.target.checked })}
            aria-label="说话气泡开关"
          />
        </label>

        <label className="settings-item">
          <span className="settings-item__icon" aria-hidden="true">
            <Turtle size={16} />
          </span>
          <span className="settings-item__text">
            <strong>减弱动态效果</strong>
            <small>减少星屿的动作幅度，适合容易晕动的人</small>
          </span>
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(e) => void save({ reducedMotion: e.target.checked })}
            aria-label="减弱动态效果开关"
          />
        </label>
      </div>
    </main>
  );
}
