/**
 * 角色选择页 —— 面板内切换桌宠皮肤。
 *
 * 展示 character-registry 中全部角色卡片（缩略图 + 名字 + 描述），
 * 点击卡片调用 petProfile.setCharacter → Main 保存 profile + 重载桌宠窗。
 * 当前选中态从 petProfile.get() 读取（切换后立即高亮，桌宠窗后台重载）。
 */
import { Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { PetId } from '@pet/protocol';

import { listCharacters } from '../pet/character-registry.js';

export interface CharacterSelectProps {
  /** 返回上一视图 */
  onBack: () => void;
}

export function CharacterSelect(_props: CharacterSelectProps) {
  const characters = listCharacters();
  const [currentId, setCurrentId] = useState<PetId | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    void window.pet.petProfile.get().then((profile) => {
      setCurrentId(profile.petId);
    });
  }, []);

  const handleSelect = useCallback(
    async (petId: PetId) => {
      if (petId === currentId || switching) return;
      setSwitching(true);
      try {
        // setCharacter 保存 profile + 触发 Main 重载桌宠窗；返回切换后的 petId
        await window.pet.petProfile.setCharacter(petId);
        setCurrentId(petId);
      } finally {
        setSwitching(false);
      }
    },
    [currentId, switching],
  );

  return (
    <div className="character-select" data-testid="character-select">
      <p className="character-select__hint">点击卡片即可切换桌宠形象，下次启动自动保持。</p>
      <div className="character-cards" role="radiogroup" aria-label="可选角色">
        {characters.map((c) => {
          const selected = c.id === currentId;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`character-card${selected ? ' character-card--selected' : ''}`}
              disabled={switching}
              onClick={() => void handleSelect(c.id)}
            >
              <CharacterThumbnail petId={c.id} />
              <div className="character-card__info">
                <strong className="character-card__name">{c.displayName}</strong>
                <span className="character-card__desc">{c.description}</span>
              </div>
              {selected ? (
                <span className="character-card__badge" aria-label="当前角色">
                  <Check size={16} aria-hidden="true" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 角色缩略图：星屿用 SVG 头像，CodeNoNo 用 spritesheet 静态帧 */
function CharacterThumbnail({ petId }: { petId: PetId }) {
  if (petId === 'codenono') {
    return <div className="character-thumb character-thumb--codenono" aria-hidden="true" />;
  }
  return <div className="character-thumb character-thumb--star-isle" aria-hidden="true" />;
}
