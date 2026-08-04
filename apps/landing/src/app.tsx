/**
 * Waitlist 落地页 —— 第 0–1 周交付物（4.3 传播循环入口）。
 * 收集邮箱 → POST /waitlist（自建后端 D-13；13.2 邀请邮件待邮件供应商接入）。
 * 开发默认连本机后端，部署时经 VITE_WAITLIST_API 指向线上 API。
 */
import { useState } from 'react';

type SubmitState = 'idle' | 'submitting' | 'done' | 'error';

/** 后端 API 基址（landing 独立部署，跨源请求由服务端 /waitlist CORS 放开） */
const WAITLIST_API = import.meta.env.VITE_WAITLIST_API ?? 'http://127.0.0.1:8787';

export function App() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [errorText, setErrorText] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
