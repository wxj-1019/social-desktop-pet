/**
 * 设置页：桌宠大小 / 气泡开关 / 减弱动态 / 勿扰 / 鼠标穿透。
 * 大小写回 Main setPetScale；气泡/减弱动态写 petProfile（main 广播给桌宠窗即时生效）；
 * 勿扰/穿透经 Main 单一入口（runtime + 托盘同步），初始值与后续变化由运行时快照驱动。
 * 本地模型（BYOK）已独立为「模型」tab，见 model-settings.tsx。
 */
import {
  Bell,
  BellOff,
  EyeOff,
  Maximize2,
  MousePointerClick,
  Rocket,
  Settings2,
  Turtle,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import type { PetRuntimeSnapshot } from '@pet/protocol';

import { CharacterVisual, useCurrentCharacter } from '../pet/character-visual.js';

/** 设置页滑块范围（60%–140%，Main 端 MIN/MAX_PET_SCALE 内） */
const SCALE_MIN = 0.6;
const SCALE_MAX = 1.4;

export function SettingsPage() {
  const { config } = useCurrentCharacter();
  const [bubbleEnabled, setBubbleEnabled] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [petScale, setPetScale] = useState(1);
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [dnd, setDnd] = useState(false);
  const [passThrough, setPassThrough] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void window.pet?.petProfile?.get().then((profile) => {
      setBubbleEnabled(profile.bubbleEnabled);
      setReducedMotion(profile.reducedMotion);
      setLoaded(true);
    });
    void window.pet?.getPetScale?.().then((scale) => {
      if (typeof scale === 'number') setPetScale(scale);
    });
    void window.pet?.autoLaunch?.get().then((enabled) => {
      if (typeof enabled === 'boolean') setAutoLaunch(enabled);
    });
    // 勿扰/穿透：快照为唯一状态源（托盘、SAO 菜单、本页三处入口同源反射）
    const runtime = window.pet?.petRuntime;
    if (runtime) {
      void runtime.getSnapshot().then((snapshot: PetRuntimeSnapshot) => {
        setDnd(snapshot.dnd);
        setPassThrough(snapshot.passThrough);
      });
      const off = runtime.onSnapshot((snapshot: PetRuntimeSnapshot) => {
        setDnd(snapshot.dnd);
        setPassThrough(snapshot.passThrough);
      });
      return off;
    }
    return undefined;
  }, []);

  async function save(next: { bubbleEnabled?: boolean; reducedMotion?: boolean }) {
    const profile = await window.pet?.petProfile?.get();
    if (!profile) return;
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

        <div className="settings-item settings-item--preview" aria-hidden="true">
          <span className="settings-item__icon settings-item__icon--preview">
            <div
              className="settings-preview-pet"
              style={{
                width: `${Math.round(34 * petScale)}px`,
                height: `${Math.round(34 * petScale)}px`,
              }}
            >
              <CharacterVisual />
            </div>
          </span>
          <span className="settings-item__text">
            <strong>实时预览</strong>
            <small>{`${config.petName}大小随上方滑块即时变化`}</small>
          </span>
          <span className="settings-preview-value">{Math.round(petScale * 100)}%</span>
        </div>

        <label className="settings-item">
          <span className="settings-item__icon" aria-hidden="true">
            <Rocket size={16} />
          </span>
          <span className="settings-item__text">
            <strong>开机自启</strong>
            <small>随 Windows 一起启动，星屿每天等你（正式版生效）</small>
          </span>
          <input
            type="checkbox"
            checked={autoLaunch}
            onChange={(e) => {
              const enabled = e.target.checked;
              setAutoLaunch(enabled);
              window.pet?.autoLaunch?.set?.(enabled);
            }}
            aria-label="开机自启开关"
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
            <small>减少动作幅度，让动画更安静，适合容易晕动的人</small>
          </span>
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(e) => void save({ reducedMotion: e.target.checked })}
            aria-label="减弱动态效果开关"
          />
        </label>

        <label className="settings-item">
          <span className="settings-item__icon" aria-hidden="true">
            {dnd ? <BellOff size={16} /> : <Bell size={16} />}
          </span>
          <span className="settings-item__text">
            <strong>勿扰模式</strong>
            <small>开启后星屿保持安静，不冒泡不闲逛</small>
          </span>
          <input
            type="checkbox"
            checked={dnd}
            onChange={(e) => {
              setDnd(e.target.checked);
              window.pet?.petRuntime?.setDnd?.(e.target.checked);
            }}
            aria-label="勿扰模式开关"
          />
        </label>

        <label className="settings-item">
          <span className="settings-item__icon" aria-hidden="true">
            <MousePointerClick size={16} />
          </span>
          <span className="settings-item__text">
            <strong>鼠标穿透</strong>
            <small>开启后点击会穿过桌宠；关闭即可恢复交互</small>
          </span>
          <input
            type="checkbox"
            checked={passThrough}
            onChange={(e) => {
              setPassThrough(e.target.checked);
              window.pet?.petRuntime?.setPassThrough?.(e.target.checked);
            }}
            aria-label="鼠标穿透开关"
          />
        </label>

        <div className="settings-item">
          <span className="settings-item__icon" aria-hidden="true">
            <EyeOff size={16} />
          </span>
          <span className="settings-item__text">
            <strong>隐藏桌宠</strong>
            <small>临时收起星屿；从托盘"显示桌宠"恢复</small>
          </span>
          <button
            type="button"
            className="settings-item__action"
            onClick={() => window.pet?.petRuntime?.setHidden?.(true)}
          >
            收起
          </button>
        </div>
      </div>
    </main>
  );
}
