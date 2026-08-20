import { useEffect, useState } from 'react';

import { adminApi, type BondsStats, type PetsStats } from '../api.js';

/** 角色 ID → 显示名（与 character-registry 一致） */
const CHARACTER_LABELS: Record<string, string> = {
  'star-isle': '星屿',
  codenono: 'CodeNoNo',
  'cream-kitten': '奶盖',
};

/** 性格模式 → 中文（设计 6.1：温柔陪伴/活泼朋友/安静伙伴） */
const PERSONALITY_LABELS: Record<string, string> = {
  warm: '温柔陪伴',
  lively: '活泼朋友',
  quiet: '安静伙伴',
};

/** 羁绊阶段 → 中文徽章（first_meet 紫 / familiar 蓝 / trusted 绿） */
const STAGE_PILLS: Record<string, [string, string]> = {
  first_meet: ['初次见面', 'pill'],
  familiar: ['熟悉伙伴', 'pill muted'],
  trusted: ['默契朋友', 'pill ok'],
};

function StagePill({ stage }: { stage: string }) {
  const [label, cls] = STAGE_PILLS[stage] ?? [stage, 'pill muted'];
  return <span className={cls}>{label}</span>;
}

export function PetsPage() {
  const [pets, setPets] = useState<PetsStats | null>(null);
  const [bonds, setBonds] = useState<BondsStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .petsStats()
      .then((d) => {
        if (!cancelled) setPets(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    adminApi
      .bondsStats()
      .then((d) => {
        if (!cancelled) setBonds(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const personalityTotal = pets?.byPersonality.reduce((s, p) => s + p.count, 0) ?? 0;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>宠物与羁绊</h2>
          <p className="page-desc">
            宠物名册分布与用户羁绊深度统计（羁绊数值只读，运营不直接调整）
          </p>
        </div>
      </div>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!error && !pets && <p className="muted">加载中…</p>}

      {pets && (
        <>
          <h3>宠物名册</h3>
          <div className="stat-grid">
            <div className="stat-card violet">
              <div className="stat-row">
                <div>
                  <div className="stat-value">{pets.total.toLocaleString('zh-CN')}</div>
                  <div className="stat-label">宠物总数</div>
                </div>
              </div>
            </div>
            {Object.entries(pets.byCharacter).map(([id, count]) => (
              <div className="stat-card" key={id}>
                <div className="stat-row">
                  <div>
                    <div className="stat-value">{count.toLocaleString('zh-CN')}</div>
                    <div className="stat-label">{CHARACTER_LABELS[id] ?? id}</div>
                  </div>
                </div>
              </div>
            ))}
            <div className="stat-card blue">
              <div className="stat-row">
                <div>
                  <div className="stat-value">{pets.customNamed.toLocaleString('zh-CN')}</div>
                  <div className="stat-label">自定义命名</div>
                </div>
              </div>
            </div>
          </div>

          {pets.byPersonality.length > 0 && (
            <>
              <h3>性格模式分布</h3>
              <div className="table-panel">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>性格模式</th>
                      <th>数量</th>
                      <th>占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pets.byPersonality.map((p) => (
                      <tr key={p.mode}>
                        <td className="cell-strong">{PERSONALITY_LABELS[p.mode] ?? p.mode}</td>
                        <td>{p.count.toLocaleString('zh-CN')}</td>
                        <td className="muted">
                          {personalityTotal > 0
                            ? `${((p.count / personalityTotal) * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {bonds && (
        <>
          <h3>羁绊分布</h3>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-row">
                <div>
                  <div className="stat-value">{bonds.total.toLocaleString('zh-CN')}</div>
                  <div className="stat-label">羁绊总数</div>
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-row">
                <div>
                  <div className="stat-value">
                    {(bonds.byStage['first_meet'] ?? 0).toLocaleString('zh-CN')}
                  </div>
                  <div className="stat-label">初次见面</div>
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-row">
                <div>
                  <div className="stat-value">
                    {(bonds.byStage['familiar'] ?? 0).toLocaleString('zh-CN')}
                  </div>
                  <div className="stat-label">熟悉伙伴</div>
                </div>
              </div>
            </div>
            <div className="stat-card green">
              <div className="stat-row">
                <div>
                  <div className="stat-value">
                    {(bonds.byStage['trusted'] ?? 0).toLocaleString('zh-CN')}
                  </div>
                  <div className="stat-label">默契朋友</div>
                </div>
              </div>
            </div>
            <div className="stat-card blue">
              <div className="stat-row">
                <div>
                  <div className="stat-value">{bonds.avgProgress}</div>
                  <div className="stat-label">活跃羁绊平均进度</div>
                </div>
              </div>
            </div>
          </div>

          <h3>TOP 羁绊榜（按有效共同事件进度）</h3>
          <div className="table-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>双方用户</th>
                  <th>宠物</th>
                  <th>阶段</th>
                  <th>进度</th>
                </tr>
              </thead>
              <tbody>
                {bonds.topBonds.map((b) => (
                  <tr key={b.bondId}>
                    <td className="cell-strong">
                      {b.userAEmail}
                      <span className="muted"> ↔ </span>
                      {b.userBEmail}
                    </td>
                    <td>
                      {b.petAName} ↔ {b.petBName}
                    </td>
                    <td>
                      <StagePill stage={b.stage} />
                    </td>
                    <td>{b.progress}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bonds.topBonds.length === 0 && <p className="muted">暂无活跃羁绊</p>}
        </>
      )}
    </section>
  );
}
