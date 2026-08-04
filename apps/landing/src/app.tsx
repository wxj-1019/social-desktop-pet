/**
 * Waitlist 落地页 —— 第 0–1 周交付物（4.3 传播循环入口）。
 * 收集邮箱 → POST /waitlist（自建后端 D-13）；邀请兑换（4.3 状态机）：
 * 邀请邮件链接带 ?code=&email= 自动预填，提交 → POST /waitlist/claim。
 * 开发默认连本机后端，部署时经 VITE_WAITLIST_API 指向线上 API。
 */
import { useState } from 'react';

type SubmitState = 'idle' | 'submitting' | 'done' | 'error';
type ClaimState = 'idle' | 'submitting' | 'done' | 'error';

/** 后端 API 基址（landing 独立部署，跨源请求由服务端 /waitlist CORS 放开） */
const WAITLIST_API = import.meta.env.VITE_WAITLIST_API ?? 'http://127.0.0.1:8787';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function App() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [errorText, setErrorText] = useState('');

  // 邀请兑换（邮件链接 ?code=&email= 预填）
  const params = new URLSearchParams(window.location.search);
  const [claimCode, setClaimCode] = useState(params.get('code') ?? '');
  const [claimEmail, setClaimEmail] = useState(params.get('email') ?? '');
  const [claimState, setClaimState] = useState<ClaimState>('idle');
  const [claimError, setClaimError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!EMAIL_PATTERN.test(email)) {
      setErrorText('请输入有效邮箱地址。');
      setState('error');
      return;
    }
    setState('submitting');
    try {
      const res = await fetch(`${WAITLIST_API}/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 409) {
        // 已在名单：按成功展示（避免让用户以为报名失败）
        setState('done');
        return;
      }
      if (!res.ok) throw new Error(`waitlist ${res.status}`);
      setState('done');
    } catch {
      setErrorText('报名暂时失败，请稍后再试。');
      setState('error');
    }
  }

  /** 邀请兑换：校验码（invited → joined） */
  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (!EMAIL_PATTERN.test(claimEmail) || claimCode.length !== 8) {
      setClaimError('请输入有效的邮箱和 8 位兑换码。');
      setClaimState('error');
      return;
    }
    setClaimState('submitting');
    try {
      const res = await fetch(`${WAITLIST_API}/waitlist/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: claimEmail, code: claimCode }),
      });
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const reasons: Record<string, string> = {
          invalid_code: '兑换码不正确，请检查后重试。',
          expired: '兑换码已过期（30 天有效）。',
          not_invited: '该邮箱暂未收到邀请。',
          already_joined: '该邮箱已兑换过邀请。',
        };
        setClaimError(reasons[body.error ?? 'invalid_code'] ?? '兑换失败，请稍后再试。');
        setClaimState('error');
        return;
      }
      if (!res.ok) throw new Error(`claim ${res.status}`);
      setClaimState('done');
    } catch {
      setClaimError('兑换暂时失败，请稍后再试。');
      setClaimState('error');
    }
  }

  return (
    <main className="landing">
      <section className="hero">
        <h1>
          一只会记住你、
          <br />
          也能去好友电脑旅行的 AI 桌宠。
        </h1>
        <p className="sub">面向真实好友共同养成的跨平台桌面陪伴 · 18+ 邀请制</p>

        {state === 'done' ? (
          <div className="success">
            <h2>已加入等待名单 🎉</h2>
            <p>我们会在邀请制 Beta 开放时通知你（成对招募：带上一位好友一起体验效果最佳）。</p>
          </div>
        ) : (
          <form className="waitlist" onSubmit={submit}>
            <input
              type="email"
              placeholder="你的邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={state === 'submitting'}
              aria-label="邮箱"
            />
            <button type="submit" disabled={state === 'submitting'}>
              {state === 'submitting' ? '提交中…' : '加入等待名单'}
            </button>
            {state === 'error' && <p className="error">{errorText}</p>}
          </form>
        )}

        {claimState === 'done' ? (
          <div className="success">
            <h2>兑换成功 🎉</h2>
            <p>邀请已生效，注册星屿账号后即可进入 Beta 体验。</p>
          </div>
        ) : (
          <form className="waitlist waitlist--claim" onSubmit={claim}>
            <input
              type="email"
              placeholder="邀请邮箱"
              value={claimEmail}
              onChange={(e) => setClaimEmail(e.target.value)}
              disabled={claimState === 'submitting'}
              aria-label="邀请邮箱"
            />
            <input
              type="text"
              placeholder="8 位兑换码"
              value={claimCode}
              onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
              disabled={claimState === 'submitting'}
              aria-label="兑换码"
            />
            <button type="submit" disabled={claimState === 'submitting'}>
              {claimState === 'submitting' ? '兑换中…' : '兑换邀请码'}
            </button>
            {claimState === 'error' && <p className="error">{claimError}</p>}
          </form>
        )}

        <ul className="features">
          <li>异步拜访好友桌面，不留即时回复压力</li>
          <li>经确认的长期记忆，可见、可改、可删</li>
          <li>低打扰桌面常驻，不抢焦点</li>
        </ul>

        <p className="note">
          MVP 面向 Windows 10/11（macOS 后续）。桌宠是 AI，不是真人、医生或心理咨询服务。
        </p>
      </section>
    </main>
  );
}
