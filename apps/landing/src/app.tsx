/**
 * Waitlist 落地页 —— 第 0–1 周交付物。
 * 收集邮箱 → 提交到后端 Edge Function（第 11–14 周接入）或临时 Supabase 表。
 * 设计稿 4.3 传播循环：生成邀请卡 → 好友网页预览 → 安装。
 */
import { useState } from 'react';

type SubmitState = 'idle' | 'submitting' | 'done' | 'error';

export function App() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SubmitState>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState('error');
      return;
    }
    setState('submitting');
    try {
      // TODO(第11-14周): POST 到 waitlist Edge Function（写 waitlist 表 + 触发邀请邮件）
      await new Promise((r) => setTimeout(r, 600)); // 骨架阶段模拟
      setState('done');
    } catch {
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
            {state === 'error' && <p className="error">请输入有效邮箱地址。</p>}
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
