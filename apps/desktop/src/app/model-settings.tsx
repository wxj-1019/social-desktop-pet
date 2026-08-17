/**
 * 模型设置页（BYOK，OpenAI 兼容端点）。
 * 密钥只存 Main 侧加密文件（safeStorage），渲染层回读仅 hasApiKey 布尔值；
 * 配置并启用后，本地模式聊天走真实模型，失败自动回退规则引擎。
 */
import { Bot } from 'lucide-react';
import { useEffect, useState } from 'react';

const PLACEHOLDERS = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-…（留空保留已保存的密钥）',
  model: 'gpt-4o-mini / glm-4-flash / …',
};

export function ModelSettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    void window.pet?.localLlm?.getView().then((view) => {
      setEnabled(view.enabled);
      setBaseUrl(view.baseUrl);
      setModel(view.model);
      setHasKey(view.hasApiKey);
      setLoaded(true);
    });
  }, []);

  async function save() {
    const trimmedUrl = baseUrl.trim();
    const trimmedModel = model.trim();
    if (!trimmedUrl || !trimmedModel || (!apiKey && !hasKey)) {
      setStatus('error');
      return;
    }
    setStatus('saving');
    try {
      const view = await window.pet?.localLlm?.save({
        enabled,
        baseUrl: trimmedUrl,
        apiKey,
        model: trimmedModel,
      });
      if (view) {
        setHasKey(view.hasApiKey);
        setBaseUrl(view.baseUrl);
        setModel(view.model);
      }
      setApiKey('');
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  if (!loaded) {
    return (
      <main className="settings-page" aria-label="模型设置">
        <div className="friends-state" role="status">
          <span className="soft-loader" aria-hidden="true" />
          <p>正在读取模型配置…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="settings-page" aria-label="模型设置">
      <div className="view-heading">
        <div className="view-heading__identity">
          <span className="view-heading__avatar" aria-hidden="true">
            <Bot size={18} />
          </span>
          <div>
            <p className="eyebrow">本地 BYOK</p>
            <h2>模型</h2>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__head">
          <span className="settings-item__icon" aria-hidden="true">
            <Bot size={16} />
          </span>
          <div>
            <strong>本地模型（OpenAI 兼容）</strong>
            <small>
              填入自己的服务即可让本地聊天走真实模型；密钥加密存本机，不配置则用内置回应
            </small>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label="启用本地模型"
          />
        </div>
        <div className="settings-section__body">
          <label className="settings-field">
            <span>接口基址</span>
            <input
              type="url"
              value={baseUrl}
              placeholder={PLACEHOLDERS.baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setStatus('idle');
              }}
              aria-label="本地模型接口基址"
            />
          </label>
          <label className="settings-field">
            <span>模型名</span>
            <input
              type="text"
              value={model}
              placeholder={PLACEHOLDERS.model}
              onChange={(e) => {
                setModel(e.target.value);
                setStatus('idle');
              }}
              aria-label="本地模型名称"
            />
          </label>
          <label className="settings-field">
            <span>API Key{hasKey ? '（已保存）' : ''}</span>
            <input
              type="password"
              value={apiKey}
              placeholder={hasKey ? PLACEHOLDERS.apiKey : 'sk-…'}
              onChange={(e) => {
                setApiKey(e.target.value);
                setStatus('idle');
              }}
              aria-label="本地模型 API Key"
              autoComplete="off"
            />
          </label>
          <div className="settings-section__actions">
            <button type="button" onClick={() => void save()} disabled={status === 'saving'}>
              {status === 'saving' ? '保存中…' : '保存模型配置'}
            </button>
            {status === 'saved' && <small className="ok">已保存</small>}
            {status === 'error' && <small className="err">请填全基址/模型/密钥后重试</small>}
          </div>
        </div>
      </div>
    </main>
  );
}
