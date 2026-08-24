import { useEffect, useRef, useState, useCallback } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DOMPurify from 'dompurify';
import {
  Brain, Car, ChartColumn, Check, CirclePause, Clapperboard, ClipboardList,
  Download, Droplets, FileText, Moon, MousePointerClick, Package, Palette, PawPrint,
  PenLine, Plus, RefreshCw, RotateCcw, Search, Settings, Sparkles, Square, Sunrise, Target,
  TrendingUp, Video, Wallet, Zap,
} from 'lucide-react';
import './AgentDock.css';

/**
 * @deprecated 已被 DockContent（真连后端 SSE）替代，保留仅作历史参考。
 * 本组件为纯前端 mock（sleep + streamText + 硬编码 6 步 TVC 演示流程），
 * 不再被 AgentDock 引用。
 */

// ====== 工具函数 ======
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type LucideIcon = typeof Check;

/** 将 lucide 图标渲染为内联 SVG 字符串(供 imperative innerHTML 模板使用) */
function icon(Icon: LucideIcon, size = 14, strokeWidth = 2): string {
  return renderToStaticMarkup(<Icon size={size} strokeWidth={strokeWidth} />);
}

/** 消毒用户/AI 生成的 HTML,防止 XSS 注入(所有动态 innerHTML 赋值前调用) */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}

function extractProduct(brief: string): string {
  const m = brief.match(/(?:for|TVC for)\s+([^,.\n]+?)(?:,|\.|\n|$)/i);
  return m?.[1]?.trim() ?? 'your product';
}

/** HTML tag-aware slice - 只计数可见字符 */
function safeSlice(html: string, count: number): string {
  let visible = 0, i = 0, inTag = false;
  while (i < html.length && visible < count) {
    if (html[i] === '<') inTag = true;
    if (!inTag) visible++;
    if (html[i] === '>') inTag = false;
    i++;
  }
  while (i < html.length && inTag) {
    if (html[i] === '>') { i++; break; }
    i++;
  }
  return html.slice(0, i);
}

function stripLen(html: string): number {
  return html.replace(/<[^>]*>/g, '').length;
}

// ====== 主组件 ======
export function TvcAgentShell(): React.ReactElement {
  const convRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pipelineRef = useRef<HTMLDivElement>(null);

  // 使用 ref 避免异步闭包中的 stale 问题
  const stopRef = useRef(false);
  const pendingResumeRef = useRef<(() => void) | null>(null);
  const skipVoteRef = useRef<(() => void) | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepData, setStepData] = useState<Record<string, string>>({});
  const [firstAIMessage, setFirstAIMessage] = useState(true);
  const [firstUserMessage, setFirstUserMessage] = useState(true);

  const scrollBottom = useCallback(() => {
    if (convRef.current) {
      convRef.current.scrollTop = convRef.current.scrollHeight;
    }
  }, []);

  const getConv = useCallback(() => convRef.current, []);

  // ===== 流式输出引擎 =====
  const streamText = useCallback((el: HTMLElement, html: string, speed = 18): Promise<void> => {
    return new Promise((resolve) => {
      if (!html.includes('<')) {
        // 纯文本模式
        let i = 0;
        const cur = document.createElement('span');
        cur.className = 'stream-cursor';
        el.appendChild(cur);
        const tick = () => {
          if (i >= html.length) {
            cur.remove();
            resolve();
            return;
          }
          const chunk = 2 + Math.floor(Math.random() * 3);
          el.insertBefore(document.createTextNode(html.slice(i, i + chunk)), cur);
          i += chunk;
          scrollBottom();
          setTimeout(tick, speed + Math.random() * 15);
        };
        tick();
      } else {
        // HTML 模式 - tag-aware 切片(先整体消毒,再对安全 HTML 切片,防止用户输入 XSS)
        const safeHtml = sanitizeHtml(html);
        let i = 0;
        const tick = () => {
          if (stopRef.current) { resolve(); return; }
          const visible = safeSlice(safeHtml, i);
          el.innerHTML = visible + '<span class="stream-cursor"></span>';
          if (i >= stripLen(safeHtml)) {
            el.querySelector('.stream-cursor')?.remove();
            resolve();
            return;
          }
          i += 3 + Math.floor(Math.random() * 4);
          scrollBottom();
          setTimeout(tick, speed + Math.random() * 10);
        };
        tick();
      }
    });
  }, [scrollBottom]);

  // ===== 消息行 =====
  const addUserMessage = useCallback((text: string) => {
    const conv = getConv();
    if (!conv) return;
    const row = document.createElement('div');
    row.className = 'msg-row user-row';
    let avatarHtml = '';
    if (firstUserMessage) {
      avatarHtml = `<div class="avatar user-avatar" title="You">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </div>`;
    }
    row.innerHTML = `${avatarHtml}<div class="user-bubble"></div>`;
    row.querySelector('.user-bubble')!.textContent = text;
    conv.appendChild(row);
    scrollBottom();
  }, [firstUserMessage, getConv, scrollBottom]);

  const addAIMessageContainer = useCallback((): HTMLElement | null => {
    const conv = getConv();
    if (!conv) return null;
    const row = document.createElement('div');
    row.className = 'msg-row ai-row';
    let avatarHtml = '';
    if (firstAIMessage) {
      avatarHtml = `<div class="avatar ai-avatar" title="ZeroExo Agent">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 2l2.4 5.6L20 9l-5.6 2.4L12 17l-2.4-5.6L4 9l5.6-1.4z"/></svg>
      </div>`;
    }
    row.innerHTML = `${avatarHtml}<div class="ai-body"></div>`;
    conv.appendChild(row);
    scrollBottom();
    return row.querySelector('.ai-body') as HTMLElement | null;
  }, [firstAIMessage, getConv, scrollBottom]);

  const addAIBlock = useCallback((html: string) => {
    const body = addAIMessageContainer();
    if (!body) return null;
    body.innerHTML = sanitizeHtml(html);
    scrollBottom();
    return body;
  }, [addAIMessageContainer, scrollBottom]);

  // ===== 思考块 =====
  const createThinkingBlock = useCallback((text: string): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'thinking';
    wrap.innerHTML = `
      <div class="thinking-label">
        <svg class="chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2"><path d="M9.5 2A2.5 2.5 0 0012 4.5v.5h.5a2.5 2.5 0 010 5H12v1a2.5 2.5 0 01-5 0V5A2.5 2.5 0 019.5 2z"/><path d="M14.5 10A2.5 2.5 0 0012 12.5v.5h-.5a2.5 2.5 0 010-5H12V7a2.5 2.5 0 015 0v5a2.5 2.5 0 01-2.5 2.5z"/></svg>
        Thinking
      </div>
      <div class="thinking-text"></div>
    `;
    const tc = wrap.querySelector('.thinking-text') as HTMLElement;
    setTimeout(() => {
      streamText(tc, text, 6).then(() => {
        wrap.classList.add('open');
        (wrap.querySelector('.thinking-label') as HTMLElement).onclick = () => wrap.classList.toggle('open');
      });
    }, 300);
    return wrap;
  }, [streamText]);

  // ===== 子代理块 =====
  const createSubAgent = useCallback((name: string, icon: string, task: string) => {
    const block = document.createElement('div');
    block.className = 'sub-agent';
    block.innerHTML = `
      <div class="sub-agent-header">
        <div class="sub-agent-icon">${icon}</div>
        <span class="sub-agent-name">${name}</span>
        <span class="sub-agent-status" data-status>running…</span>
      </div>
      <div class="sub-agent-body" data-body></div>
    `;
    (block.querySelector('[data-body]') as HTMLElement).textContent = task;
    return {
      el: block,
      setResult(result: string) {
        const body = block.querySelector('[data-body]') as HTMLElement;
        body.innerHTML = sanitizeHtml(result);
        const status = block.querySelector('[data-status]') as HTMLElement;
        status.textContent = '✓ done';
        status.style.color = '#4ade80';
      },
      setError(err: string) {
        const body = block.querySelector('[data-body]') as HTMLElement;
        body.innerHTML = sanitizeHtml(`<span style="color:#f87171">${err}</span>`);
        const status = block.querySelector('[data-status]') as HTMLElement;
        status.textContent = '✗ error';
        status.style.color = '#f87171';
      },
    };
  }, []);

  // ===== 步骤块 =====
  const createStep = useCallback((num: number, title: string, icon: string) => {
    const conv = getConv();
    if (!conv) return null;
    const stepEl = document.createElement('div');
    stepEl.className = 'step-block active expanded';
    stepEl.innerHTML = `
      <div class="step-header" data-header>
        <div class="step-icon">${icon || num}</div>
        <span class="step-title">${title}</span>
        <span class="step-status" data-status>in progress…</span>
        <svg class="step-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </div>
      <div class="step-content" data-content></div>
    `;
    (stepEl.querySelector('[data-header]') as HTMLElement).onclick = () => stepEl.classList.toggle('expanded');
    conv.appendChild(stepEl);
    scrollBottom();
    return {
      el: stepEl,
      content: stepEl.querySelector('[data-content]') as HTMLElement,
      setDone() {
        stepEl.classList.remove('active');
        stepEl.classList.add('done');
        (stepEl.querySelector('[data-status]') as HTMLElement).textContent = '✓ complete';
        stepEl.querySelector('.step-icon')!.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>';
      },
      setStatus(text: string) {
        (stepEl.querySelector('[data-status]') as HTMLElement).textContent = text;
      },
    };
  }, [getConv, scrollBottom]);

  // ===== 继续栏 =====
  const addContinueBar = useCallback((fromStep: number, nextLabel: string) => {
    const conv = getConv();
    if (!conv) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const row = document.createElement('div');
      row.className = 'continue-bar';
      row.innerHTML = `
        <div class="c-dot"></div>
        <span class="c-label">Step ${fromStep} ✓ — Continue to <strong>${nextLabel}</strong></span>
        <span class="c-arrow">→</span>
      `;
      conv.appendChild(row);
      scrollBottom();
      let resolved = false;
      const proceed = () => {
        if (resolved) return;
        resolved = true;
        row.style.opacity = '.5';
        (row.querySelector('.c-dot') as HTMLElement).style.animation = 'none';
        resolve(true);
      };
      row.onclick = proceed;
      pendingResumeRef.current = () => { proceed(); };
      setTimeout(() => { if (!resolved) proceed(); }, 4000);
    });
  }, [getConv, scrollBottom]);

  // ===== 管道更新 =====
  const updatePipeline = useCallback((stepNum: number) => {
    const mini = pipelineRef.current;
    if (!mini) return;
    mini.style.display = 'flex';
    const dots = mini.querySelectorAll('.pipe-dot');
    const lines = mini.querySelectorAll('.pipe-line');
    dots.forEach((d, i) => {
      d.classList.remove('active', 'done');
      if (i < stepNum) d.classList.add('done');
      else if (i === stepNum) d.classList.add('active');
    });
    lines.forEach((l, i) => {
      if (i < stepNum) l.classList.add('done');
      else l.classList.remove('done');
    });
  }, []);

  // ===== 状态设置 =====
  const setStatus = useCallback((type: string, text: string) => {
    const el = document.getElementById('top-status-sub');
    if (!el) return;
    el.className = 'agent-brand-sub';
    const dotColor = type === 'done' ? '#4ade80' : type === 'working' ? '#fbbf24' : '#a5b4fc';
    const isPulse = type !== 'done';
    el.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dotColor};${isPulse ? 'animation:pulse-dot 1.2s ease-in-out infinite' : ''};margin-right:4px;vertical-align:middle"></span>${text}`;
  }, []);

  // ===== 清除所有 =====
  const clearAll = useCallback(() => {
    setIsGenerating(false);
    stopRef.current = true;
    setCurrentStep(0);
    setStepData({});
    setFirstAIMessage(true);
    setFirstUserMessage(true);
    const mini = pipelineRef.current;
    if (mini) mini.style.display = 'none';
    setStatus('thinking', 'Idle — waiting for brief');
    const conv = getConv();
    if (conv) {
      conv.innerHTML = `
        <div class="welcome-wrap" id="welcome">
          <div class="welcome-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg></div>
          <h1 style="font-size:19px;font-weight:700;color:#f1f5f9;margin-bottom:6px">What TVC do you want to create?</h1>
          <p style="font-size:12.5px;color:#64748b;max-width:420px;margin:0 auto 20px;line-height:1.6">Describe your product, audience, and vibe. I'll handle strategy → script → storyboard → video.</p>
          <div style="margin-bottom:20px" id="quick-chips"></div>
        </div>
      `;
      const chips = conv.querySelector('#quick-chips')!;
      const quickData = [
        { ic: Droplets, q: "Create a 15-second TVC for Aurora Skincare, a premium anti-aging serum. Target: women 35-55, affluent, wellness-focused. Tone: serene, scientific, luxe. Key message: 'Time bends for those who care.'", label: 'Aurora Skincare' },
        { ic: Car, q: 'A 15-second TVC for a luxury electric SUV, targeting affluent millennials, cinematic and aspirational tone', label: 'Luxury EV' },
        { ic: Zap, q: 'A high-energy 15s ad for a new energy drink, Gen Z audience, bold neon aesthetics', label: 'Energy Drink' },
        { ic: PawPrint, q: 'A heartwarming 15-second spot for a pet adoption campaign, emotional storytelling', label: 'Pet Adoption' },
      ];
      quickData.forEach((d) => {
        const btn = document.createElement('button');
        btn.className = 'quick-chip';
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '5px';
        const icEl = document.createElement('span');
        icEl.style.display = 'inline-flex';
        icEl.innerHTML = icon(d.ic, 12);
        btn.appendChild(icEl);
        btn.appendChild(document.createTextNode(d.label));
        btn.dataset.q = d.q;
        btn.onclick = () => {
          if (inputRef.current) {
            inputRef.current.value = d.q;
            sendMessage();
          }
        };
        chips.appendChild(btn);
      });
    }
    if (inputRef.current) inputRef.current.focus();
  }, [setStatus, getConv]);

  // ===== 中断处理 =====
  const handleUserInterruption = useCallback((text: string) => {
    addUserMessage(text);
    const lower = text.toLowerCase();

    // "continue" / "yes" / "ok" → 恢复
    if (lower.match(/\b(continue|resume|go on|proceed|keep going|yes|ok|sure|next)\b/)) {
      if (pendingResumeRef.current) {
        const r = pendingResumeRef.current;
        pendingResumeRef.current = null;
        addAIBlock(`<span class="note ok">→ Resuming pipeline…</span>`);
        r();
        return;
      }
      addAIBlock(`<span class="note ok">→ Picking up where we left off…</span>`);
      if (skipVoteRef.current) { skipVoteRef.current(); skipVoteRef.current = null; }
      return;
    }

    // "stop" / "halt" / "pause" → 暂停
    if (lower.match(/\b(stop|halt|pause|wait|cancel)\b/)) {
      stopRef.current = true;
      if (pendingResumeRef.current) { pendingResumeRef.current(); pendingResumeRef.current = null; }
      addAIBlock(`<span class="note warn">${icon(CirclePause, 12)} Pipeline paused. Say "continue" to resume, or give me a new brief to start over.</span>`);
      return;
    }

    // "skip" → 跳过当前步骤
    if (lower.match(/\b(skip|pass|move on)\b/)) {
      if (skipVoteRef.current) { skipVoteRef.current(); skipVoteRef.current = null; }
      if (pendingResumeRef.current) { const r = pendingResumeRef.current; pendingResumeRef.current = null; r(); }
      addAIBlock(`<span class="note warn">→ Skipping current step…</span>`);
      return;
    }

    // "restart" → 重新开始
    if (lower.match(/\b(restart|start over|new brief|reset)\b/)) {
      stopRef.current = true;
      if (pendingResumeRef.current) { pendingResumeRef.current(); pendingResumeRef.current = null; }
      addAIBlock(`<span class="note">→ Restarting…</span>`);
      setTimeout(() => clearAll(), 800);
      return;
    }

    // 侧边聊天
    respondToSideChat(text);
  }, [addUserMessage, addAIBlock, clearAll]);

  // ===== 侧边聊天响应 =====
  const respondToSideChat = useCallback(async (text: string) => {
    const body = addAIMessageContainer();
    if (!body) return;
    const lower = text.toLowerCase();

    let response: string;
    if (lower.match(/\b(hello|hi|hey|yo)\b/)) {
      response = `Hey! I'm in the middle of your TVC pipeline. Say <strong>"continue"</strong> to resume, <strong>"stop"</strong> to abort, or chat with me about anything else.`;
    } else if (lower.match(/\b(what|status|progress|where)\b/)) {
      response = `We're currently on <strong>Step ${currentStep}</strong> of 6.<br><br>Say <strong>"continue"</strong> to proceed, or <strong>"stop"</strong> to halt.`;
    } else if (lower.match(/\b(help|commands|options)\b/)) {
      response = `While the pipeline is running, you can say:<br>• <strong>"continue"</strong> → proceed to next step<br>• <strong>"stop"</strong> → halt the pipeline<br>• <strong>"skip"</strong> → skip current step<br>• <strong>"restart"</strong> → start over with new brief<br>• Or just chat with me about anything!`;
    } else {
      const responses = [
        `I'm currently in the middle of your TVC pipeline. You can:<br>• Say <strong>"continue"</strong> to resume the next step<br>• Say <strong>"stop"</strong> to halt everything<br>• Give me a new brief to start over<br><br>What would you like?`,
        `I'm still working on your video project. Want me to <strong>continue</strong> where I left off, or shall we change direction?`,
        `I can chat, but I'm mid-pipeline on your TVC. Just say <strong>"continue"</strong> and I'll pick up the next step. Or give me a new instruction.`,
      ];
      response = responses[Math.floor(Math.random() * responses.length)] ?? '';
    }
    await streamText(body, response, 15);
  }, [addAIMessageContainer, currentStep, streamText]);

  // ===== 导出报告 =====
  const exportReport = useCallback(() => {
    const text = `ZeroExo Agent — TVC Report
================================
Direction: ${stepData.direction || 'N/A'}
Variant: ${stepData.variant || 'N/A'}
Script: ${stepData.script || 'N/A'}
Deliverables: 4 files (4K MP4, 1080p MP4, Social MP4, Transcript)
Total Cost: 400 credits
`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'videoforge-report.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [stepData]);

  // ===== 发送消息 =====
  const sendMessage = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';

    if (isGenerating) {
      handleUserInterruption(text);
      return;
    }

    setFirstAIMessage(true);
    setFirstUserMessage(true);
    addUserMessage(text);
    const w = document.getElementById('welcome');
    if (w) w.remove();
    startAgentFlow(text);
  }, [isGenerating, addUserMessage, handleUserInterruption]);

  // ===== 启动 Agent 流程 =====
  const startAgentFlow = useCallback(async (brief: string) => {
    setIsGenerating(true);
    stopRef.current = false;
    setCurrentStep(0);
    setStepData({ brief });

    setStatus('thinking', 'Analyzing brief…');

    // ===== STEP 1: ANALYZE BRIEF =====
    const s1 = createStep(1, 'Analyze Brief', icon(Brain));
    if (!s1) return;
    setCurrentStep(1);
    updatePipeline(0);

    const t1 = createThinkingBlock(`Parsing user brief...
Detected intent: video generation request
Extracting: product="${extractProduct(brief)}"
Duration: 15s, format: TVC
Identifying target audience and emotional tone...
Checking brand voice and visual references...
Constraints: 15s max, 4K output, MP4
Ready to present analysis.`);
    const indented1 = document.createElement('div');
    indented1.className = 'indented';
    indented1.appendChild(t1);
    s1.content.appendChild(indented1);
    await sleep(1200);

    const researchAgent = createSubAgent('Research Agent', icon(Search), 'Searching for brand references and competitor TVCs...');
    const indented2 = document.createElement('div');
    indented2.className = 'indented';
    indented2.appendChild(researchAgent.el);
    s1.content.appendChild(indented2);
    await sleep(800);
    researchAgent.setResult(`Found 12 reference TVCs for premium skincare.<br>Top motifs: golden hour slow-mo, lab close-ups, transformation reveal.<br>Avg brand recall: 52% for 15s spots in this category.`);
    await sleep(500);

    const analysisBody = addAIMessageContainer();
    if (analysisBody) {
      await streamText(analysisBody, `<strong>Brief Analysis</strong>\n\nI've parsed your brief. Here's what I understand:\n\n• <strong>Product</strong>: ${extractProduct(brief)} — premium positioning\n• <strong>Duration</strong>: 15 seconds (standard TVC slot)\n• <strong>Tone</strong>: Cinematic, emotional, luxury\n• <strong>Target</strong>: Affluent demographic, 30-55\n• <strong>Key challenge</strong>: 15s is tight — maximum emotional impact per second\n\nBefore I draft the script, I need to lock in the <strong>creative direction</strong>. Let me show you options…`);
    }

    s1.setDone();
    setStatus('working', 'Step 1 ✓ → Creative Direction');
    await addContinueBar(1, 'Step 2: Creative Direction →');

    if (stopRef.current) return;

    // ===== STEP 2: CREATIVE DIRECTION (POLL) =====
    const s2 = createStep(2, 'Creative Direction', icon(Target));
    if (!s2) return;
    setCurrentStep(2);
    updatePipeline(1);

    const t2 = createThinkingBlock(`Need to propose creative directions.
Evaluating approaches based on:
- Product category (luxury skincare)
- Target demographic (affluent women 35-55)
- Emotional triggers (youth, confidence, science)
- Platform constraints (15s max)
Ranking by brand fit and predicted engagement...`);
    const ind2 = document.createElement('div');
    ind2.className = 'indented';
    ind2.appendChild(t2);
    s2.content.appendChild(ind2);
    await sleep(1000);

    const s2body = addAIMessageContainer();
    if (s2body) {
      await streamText(s2body, `<strong>Step 2: Creative Direction</strong>\n\nFor a 15-second luxury TVC, I see 4 viable creative approaches. <strong>Pick the one that matches your vision</strong> — this drives everything downstream (script, shots, music, color grading):`);
    }

    const pollWrap = document.createElement('div');
    pollWrap.style.cssText = 'margin:8px 0';
    pollWrap.innerHTML = `<div class="section-label">${icon(MousePointerClick, 11)} Select creative direction</div><div id="poll-opts"></div>`;
    s2.content.appendChild(pollWrap);

    const directions = [
      { label: 'Cinematic Lifestyle', desc: 'Slow-mo, golden hour, aspirational living scenes', pct: 42 },
      { label: 'Bold & Disruptive', desc: 'Fast cuts, contrast lighting, attention-grabbing opener', pct: 28 },
      { label: 'Emotional Story', desc: 'Narrative arc, human connection, subtle product placement', pct: 20 },
      { label: 'Minimalist Premium', desc: 'Clean, Apple-style, product hero, single bold statement', pct: 10 },
    ];
    const pc = pollWrap.querySelector('#poll-opts')!;
    let voteResolver: ((value: string | null) => void) | null = null;

    directions.forEach((d, idx) => {
      const btn = document.createElement('button');
      btn.className = 'poll-opt';
      btn.innerHTML = `<span style="flex:1;text-align:left"><span style="font-weight:600;color:#e2e8f0">${d.label}</span><span style="display:block;font-size:10.5px;color:#64748b;margin-top:2px">${d.desc}</span></span><span class="poll-bar-track"><span class="poll-bar-fill" style="background:#6366f1;width:0%"></span></span><span class="poll-pct">0%</span>`;
      btn.onclick = () => {
        if (!voteResolver) return;
        pc.querySelectorAll('.poll-opt').forEach((o, i) => {
          o.classList.add('voted');
          const fill = o.querySelector('.poll-bar-fill') as HTMLElement;
          const pct = o.querySelector('.poll-pct') as HTMLElement;
          if (i === idx) {
            o.classList.add('winner');
            fill.style.width = '100%';
            pct.textContent = 'Selected';
          } else {
            fill.style.width = ((directions[i]?.pct ?? 0) * 0.5) + '%';
            pct.textContent = (directions[i]?.pct ?? 0) + '%';
          }
        });
        (pollWrap.querySelector('.section-label') as HTMLElement).innerHTML = `<span style="color:#10b981">${icon(Check, 11)} Locked:</span> <strong style="color:#e2e8f0">${d.label}</strong>`;
        const r = voteResolver;
        voteResolver = null;
        r(d.label);
      };
      pc.appendChild(btn);
    });

    skipVoteRef.current = () => {
      if (voteResolver) {
        const r = voteResolver;
        voteResolver = null;
        const firstBtn = pc.querySelector('.poll-opt') as HTMLElement;
        if (firstBtn) firstBtn.click();
        r('Cinematic Lifestyle (auto-selected)');
      }
    };

    const chosenDir = await new Promise<string | null>((r) => {
      voteResolver = r;
      const checkStop = setInterval(() => {
        if (stopRef.current && voteResolver) {
          clearInterval(checkStop);
          const rv = voteResolver;
          voteResolver = null;
          rv(null);
        }
      }, 200);
    });
    skipVoteRef.current = null;

    if (chosenDir === null) {
      addAIBlock(`<span class="note warn">${icon(CirclePause, 12)} Creative direction step skipped (stopped).</span>`);
      return;
    }
    setStepData((prev) => ({ ...prev, direction: chosenDir }));

    const t2b = createThinkingBlock(`Direction locked: ${chosenDir}
Translating to visual language...
Selecting color palette, lighting approach, pacing rhythm.
Handing off to Script Agent...`);
    const ind2b = document.createElement('div');
    ind2b.className = 'indented';
    ind2b.appendChild(t2b);
    s2.content.appendChild(ind2b);
    await sleep(800);

    const scriptAgent = createSubAgent('Script Agent', icon(PenLine), `Receiving direction: "${chosenDir}"\nDrafting 15s script with hook + CTA...`);
    const ind2c = document.createElement('div');
    ind2c.className = 'indented';
    ind2c.appendChild(scriptAgent.el);
    s2.content.appendChild(ind2c);
    await sleep(1000);
    scriptAgent.setResult(`Script draft v1 ready (4 scenes, 15s total).\nHook-to-CTA ratio: 3:2 ✓\nEmotional arc: curiosity → trust → desire → action`);

    s2.setDone();
    setStatus('working', 'Step 2 ✓ → Script & Hook');
    await addContinueBar(2, 'Step 3: Script & Hook →');

    if (stopRef.current) return;

    // ===== STEP 3: SCRIPT & HOOK =====
    const s3 = createStep(3, 'Script & Hook', icon(PenLine));
    if (!s3) return;
    setCurrentStep(3);
    updatePipeline(2);

    const t3 = createThinkingBlock(`Script Agent delivered draft v1.
Reviewing for: hook strength (first 3s), brand message clarity,
CTA effectiveness (last 2s), overall pacing.
Checking scene transitions and VO sync...`);
    const ind3a = document.createElement('div');
    ind3a.className = 'indented';
    ind3a.appendChild(t3);
    s3.content.appendChild(ind3a);
    await sleep(1000);

    const s3body = addAIMessageContainer();
    if (s3body) {
      await streamText(s3body, `<strong>Step 3: Script & Hook</strong>\n\nGreat — <strong>${chosenDir}</strong> it is. Here's the 15-second script. Every second counts, so I need to nail the <strong>hook</strong> (first 3s) and the <strong>CTA</strong> (last 2s):`);
    }

    const scriptBox = document.createElement('div');
    scriptBox.style.cssText = 'margin:8px 0;background:#0d1220;border:1px solid #1e293b;border-radius:10px;padding:12px 14px';
    scriptBox.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6366f1">${icon(FileText, 11)} Script Draft v1</span><span style="font-size:10px;color:#64748b">15s · 4 scenes</span></div><div id="script-lines"></div>`;
    s3.content.appendChild(scriptBox);

    const scenes = [
      { t: '0-3s', text: 'HOOK: Extreme close-up — a single drop of serum hitting skin. Slow-mo. Golden light refracts. VO: "What if time could wait?"', c: '#fbbf24' },
      { t: '3-7s', text: 'ESTABLISH: Woman 40s, morning window light, applies serum. Skin glows. Music swells subtly.', c: '#a5b4fc' },
      { t: '7-12s', text: 'TRANSFORM: Split-screen — day 1 vs day 30. Same woman. Radiance amplified. Text: "Clinically proven in 30 days."', c: '#86efac' },
      { t: '12-15s', text: 'CTA: Product hero shot. Logo + tagline: "Aurora — Time bends for those who care." URL.', c: '#f472b6' },
    ];
    const linesC = scriptBox.querySelector('#script-lines')!;
    for (const s of scenes) {
      const line = document.createElement('div');
      line.className = 'scene-line';
      line.innerHTML = `<span class="scene-time">${s.t}</span><span style="color:${s.c}">${s.text}</span>`;
      linesC.appendChild(line);
      await sleep(300);
    }

    const formBox = document.createElement('div');
    formBox.style.cssText = 'margin-top:10px';
    formBox.innerHTML = `
      <div class="section-label">Your review</div>
      <div style="font-size:11.5px;color:#94a3b8;margin-bottom:6px">Approve as-is or request changes:</div>
      <div class="form-row"><label>Feedback (optional — leave blank to approve)</label><textarea class="form-textarea" id="script-fb" placeholder="e.g. Make the hook bolder, shorten scene 2, change CTA text…"></textarea></div>
      <div class="action-btn-row"><button class="btn-primary" id="approve-script">${icon(Check, 12)} Approve Script</button><button class="btn-secondary" id="revise-script">${icon(PenLine, 12)} Request Revisions</button></div>
      <div id="script-result"></div>
    `;
    s3.content.appendChild(formBox);

    await new Promise<void>((resolve) => {
      (formBox.querySelector('#approve-script') as HTMLElement).onclick = () => {
        setStepData((prev) => ({ ...prev, script: 'approved v1' }));
        (formBox.querySelector('#script-result') as HTMLElement).innerHTML = '<span class="note ok">✓ Script approved — continuing…</span>';
        resolve();
      };
      (formBox.querySelector('#revise-script') as HTMLElement).onclick = async () => {
        const fb = (formBox.querySelector('#script-fb') as HTMLTextAreaElement).value.trim() || 'make it more emotional';
        setStepData((prev) => ({ ...prev, script: 'revised: ' + fb }));
        (formBox.querySelector('#script-result') as HTMLElement).innerHTML = sanitizeHtml(`<span class="note warn">${icon(RefreshCw, 11)} Revising with feedback: "${fb}"…</span>`);
        await sleep(1200);
        const revBox = document.createElement('div');
        revBox.style.cssText = 'margin-top:8px;padding:8px 12px;background:rgba(99,102,241,.04);border:1px solid rgba(99,102,241,.15);border-radius:8px;font-size:11.5px;color:#cbd5e1;line-height:1.6';
        revBox.innerHTML = `<strong style="color:#a5b4fc">${icon(FileText, 11)} Script v2 (revised)</strong><br><span style="color:#fbbf24">0-3s:</span> HOOK: Bolder — "Aging is a choice." Black screen, single word fade-in.<br><span style="color:#a5b4fc">3-7s:</span> Woman's hand touching her face, confidence in her eyes.<br><span style="color:#86efac">7-12s:</span> Clinical data overlay, 94% satisfaction rate.<br><span style="color:#f472b6">12-15s:</span> CTA unchanged.`;
        s3.content.appendChild(revBox);
        (formBox.querySelector('#script-result') as HTMLElement).innerHTML = '<span class="note ok">✓ Script v2 ready — continuing…</span>';
        resolve();
      };
    });

    const t3b = createThinkingBlock(`Script locked: ${stepData.script}
Breaking into shot list...
Calculating shot durations to fit 15s constraint...
Planning camera angles and transitions...
Handing off to Storyboard Agent...`);
    const ind3b = document.createElement('div');
    ind3b.className = 'indented';
    ind3b.appendChild(t3b);
    s3.content.appendChild(ind3b);
    await sleep(800);

    s3.setDone();
    setStatus('working', 'Step 3 ✓ → Storyboard & Variants');
    await addContinueBar(3, 'Step 4: Storyboard & Variants →');

    if (stopRef.current) return;

    // ===== STEP 4: STORYBOARD & VARIANTS =====
    const s4 = createStep(4, 'Storyboard & Variants', icon(Clapperboard));
    if (!s4) return;
    setCurrentStep(4);
    updatePipeline(3);

    const boardAgent = createSubAgent('Storyboard Agent', icon(Palette), 'Generating visual variants from script + direction...\nRendering 3 distinct visual treatments...');
    const ind4a = document.createElement('div');
    ind4a.className = 'indented';
    ind4a.appendChild(boardAgent.el);
    s4.content.appendChild(ind4a);
    await sleep(1000);

    const s4body = addAIMessageContainer();
    if (s4body) {
      await streamText(s4body, `<strong>Step 4: Storyboard & Variants</strong>\n\nScript locked. The Storyboard Agent generated <strong>3 visual variants</strong>. This is the key creative decision — <strong>pick your favorite</strong> and I'll render the full video:`);
    }

    const varSection = document.createElement('div');
    varSection.innerHTML = `
      <div class="section-label">${icon(Palette, 11)} Generated Variants — Pick your favorite</div>
      <div class="variant-grid" id="var-grid"></div>
      <div class="note" id="var-hint">${icon(MousePointerClick, 11)} Click a variant to select →</div>
    `;
    s4.content.appendChild(varSection);

    const variants = [
      { name: '"Golden Hour"', meta: 'Warm tones · Natural light · Soft focus', ic: icon(Sunrise, 28), bg: 'linear-gradient(135deg,#f59e0b,#dc2626)' },
      { name: '"Noir Luxe"', meta: 'Dark tones · Dramatic shadows · Sharp contrast', ic: icon(Moon, 28), bg: 'linear-gradient(135deg,#1e1b4b,#0f172a)' },
      { name: '"Clean Future"', meta: 'Cool tones · Minimalist · Product-forward', ic: icon(Sparkles, 28), bg: 'linear-gradient(135deg,#0ea5e9,#6366f1)' },
    ];
    let variantResolver: ((value: typeof variants[0] | null) => void) | null = null;
    const grid = varSection.querySelector('#var-grid')!;
    variants.forEach((v, i) => {
      const card = document.createElement('div');
      card.className = 'variant-card';
      card.innerHTML = `<div class="variant-thumb" style="background:${v.bg}"><span style="color:#fff;display:inline-flex;z-index:1">${v.ic}</span></div><div class="variant-info"><div class="name">Variant ${['A', 'B', 'C'][i]}: ${v.name}</div><div class="meta">${v.meta}</div></div>`;
      card.onclick = () => {
        if (!variantResolver) return;
        grid.querySelectorAll('.variant-card').forEach((c, idx) => {
          if (idx === i) c.classList.add('selected');
        });
        (varSection.querySelector('#var-hint') as HTMLElement).innerHTML = `<span style="color:#10b981">${icon(Check, 11)} Selected:</span> <strong style="color:#e2e8f0">Variant ${['A', 'B', 'C'][i]}: ${v.name}</strong>`;
        const r = variantResolver;
        variantResolver = null;
        r(v);
      };
      grid.appendChild(card);
    });

    skipVoteRef.current = () => {
      if (variantResolver) {
        const r = variantResolver;
        variantResolver = null;
        const firstCard = grid.querySelector('.variant-card') as HTMLElement;
        if (firstCard) firstCard.click();
        r(variants[0] ?? null);
      }
    };

    const chosenVar = await new Promise<typeof variants[0] | null>((r) => {
      variantResolver = r;
      const checkStop2 = setInterval(() => {
        if (stopRef.current && variantResolver) {
          clearInterval(checkStop2);
          const rv = variantResolver;
          variantResolver = null;
          rv(null);
        }
      }, 200);
    });
    skipVoteRef.current = null;

    if (chosenVar === null) {
      addAIBlock(`<span class="note warn">${icon(CirclePause, 12)} Variant selection skipped (stopped).</span>`);
      return;
    }
    setStepData((prev) => ({ ...prev, variant: chosenVar.name }));

    boardAgent.setResult(`3 variants rendered successfully.<br>User selected: <strong>${chosenVar.name}</strong><br>Shot list auto-generated (5 shots, 15s total).`);

    const board = document.createElement('div');
    board.style.cssText = 'margin-top:10px;background:#0d1220;border:1px solid #1e293b;border-radius:10px;padding:12px 14px';
    board.innerHTML = sanitizeHtml(`<div class="section-label green">${icon(ClipboardList, 11)} Shot List — ${chosenVar.name}</div><table class="report-table"><tr><th>Shot</th><th>Angle</th><th>Dur</th><th>Description</th></tr><tr><td>1</td><td>Extreme CU</td><td>0-3s</td><td>Serum drop hitting skin, 240fps slow-mo</td></tr><tr><td>2</td><td>Medium CU</td><td>3-7s</td><td>Woman's face, morning light, applies serum</td></tr><tr><td>3</td><td>Over-shoulder</td><td>7-10s</td><td>Mirror reflection, transformation reveal</td></tr><tr><td>4</td><td>Hero shot</td><td>10-13s</td><td>Product on marble, single light source</td></tr><tr><td>5</td><td>Wide push-in</td><td>13-15s</td><td>Logo + tagline + URL, fade to white</td></tr></table>`);
    s4.content.appendChild(board);

    s4.setDone();
    setStatus('working', 'Step 4 ✓ → Video Generation');
    await addContinueBar(4, 'Step 5: Video Generation →');

    if (stopRef.current) return;

    // ===== STEP 5: VIDEO GENERATION =====
    const s5 = createStep(5, 'Video Generation', icon(Video));
    if (!s5) return;
    setCurrentStep(5);
    updatePipeline(4);

    const renderAgent = createSubAgent('Render Agent', icon(Settings), `Initializing render pipeline...
Engine: ZeroExo Ultra v2.1
Model: vf-u-2.1
Target: 4K · 24fps · 15s`);
    const ind5a = document.createElement('div');
    ind5a.className = 'indented';
    ind5a.appendChild(renderAgent.el);
    s5.content.appendChild(ind5a);
    await sleep(800);

    const s5body = addAIMessageContainer();
    if (s5body) {
      await streamText(s5body, `<strong>Step 5: Video Generation</strong>\n\nRendering the full 15-second TVC now. I'll show real-time progress for each phase. You can <strong>Stop</strong> anytime if you want to change direction:`);
    }

    const progWrap = document.createElement('div');
    progWrap.style.cssText = 'margin-top:8px;background:#0d1220;border:1px solid #1e293b;border-radius:10px;padding:12px 14px';
    progWrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div style="width:7px;height:7px;border-radius:50%;background:#6366f1" class="pulse-dot" id="gen-dot"></div>
        <span style="font-size:12px;font-weight:600;color:#cbd5e1;flex:1" id="gen-stage">Initializing…</span>
        <span style="font-size:10.5px;color:#64748b;font-family:JetBrains Mono,monospace" id="gen-time">0.0s</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="gen-progress" style="width:0%"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#475569;margin-top:2px"><span id="gen-phase">Phase 0/6</span><span id="gen-pct">0%</span></div>
      <div style="margin-top:8px" id="gen-shimmer"></div>
      <div style="margin-top:6px" id="gen-detail"></div>
      <button class="stop-btn" style="margin-top:8px" id="gen-stop">${icon(Square, 11)} Stop generation</button>
    `;
    s5.content.appendChild(progWrap);

    const shCont = progWrap.querySelector('#gen-shimmer')!;
    [96, 88, 92, 60].forEach((w, i) => {
      const s = document.createElement('div');
      s.className = 'shimmer-line';
      s.style.width = w + '%';
      s.style.animationDelay = i * 0.15 + 's';
      shCont.appendChild(s);
    });

    const stages = [
      { label: 'Initializing render pipeline…', dur: 700, cfg: '{"engine":"ZeroExo Ultra","model":"vf-u-2.1","resolution":"4K","fps":24}' },
      { label: 'Generating keyframes from storyboard…', dur: 1000, cfg: `{"shots":5,"style":"${chosenVar.name}","seed":42817}` },
      { label: 'Rendering frames (24fps × 15s = 360 frames)…', dur: 1300, cfg: '{"frame":0,"total":360,"vram":"98%","gpu":"A100×4"}' },
      { label: 'Applying color grading & VFX…', dur: 900, cfg: '{"lut":"cinematic-warm","bloom":0.3,"film_grain":0.05}' },
      { label: 'Synthesizing voiceover & SFX…', dur: 800, cfg: '{"voice":"warm-female-en","sfx":"cinematic-impact","music":"license-cleared"}' },
      { label: 'Encoding final output (H.264 4K + H.265 1080p)…', dur: 700, cfg: '{"formats":["mp4-4k","mp4-1080p","webm"],"bitrate":"25Mbps"}' },
    ];

    (progWrap.querySelector('#gen-stop') as HTMLElement).onclick = () => { stopRef.current = true; };

    const t0 = performance.now();
    const clock = setInterval(() => {
      const el = progWrap.querySelector('#gen-time') as HTMLElement;
      if (el) el.textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
    }, 100);

    let cumPct = 0;
    for (let i = 0; i < stages.length; i++) {
      if (stopRef.current) break;
      const s = stages[i];
      if (!s) continue;
      (progWrap.querySelector('#gen-stage') as HTMLElement).textContent = s.label;
      (progWrap.querySelector('#gen-phase') as HTMLElement).textContent = `Phase ${i + 1}/${stages.length}`;
      (progWrap.querySelector('#gen-detail') as HTMLElement).innerHTML = `<div class="detail-box input"><div class="detail-label">Config</div><pre>${s.cfg}</pre></div>`;
      const sp = cumPct;
      const ep = ((i + 1) / stages.length) * 100;
      const sd = s.dur;
      const st = Date.now();
      await new Promise<void>((res) => {
        const tick = () => {
          if (stopRef.current) { res(); return; }
          const el = Date.now() - st;
          const p = Math.min(ep, sp + ((el / sd) * (ep - sp)));
          (progWrap.querySelector('#gen-progress') as HTMLElement).style.width = p + '%';
          (progWrap.querySelector('#gen-pct') as HTMLElement).textContent = Math.round(p) + '%';
          if (el >= sd) res();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      cumPct = ((i + 1) / stages.length) * 100;
    }
    clearInterval(clock);

    if (stopRef.current) {
      (progWrap.querySelector('#gen-stage') as HTMLElement).textContent = 'Stopped by user';
      (progWrap.querySelector('#gen-stage') as HTMLElement).style.color = '#f87171';
      renderAgent.setError('Render stopped by user');
      const rb = document.createElement('div');
      rb.className = 'action-btn-row';
      rb.innerHTML = `<button class="btn-secondary" id="restart-gen">${icon(RotateCcw, 12)} Restart generation</button>`;
      s5.content.appendChild(rb);
      await new Promise<void>((r) => { (progWrap.querySelector('#restart-gen') as HTMLElement).onclick = () => r(); });
      s5.el.remove();
      return startAgentFlow(brief);
    }

    (progWrap.querySelector('#gen-stage') as HTMLElement).textContent = '✓ Render complete — 15s · 4K · 25Mbps';
    (progWrap.querySelector('#gen-stage') as HTMLElement).style.color = '#4ade80';
    (progWrap.querySelector('#gen-dot') as HTMLElement).style.background = '#4ade80';
    (progWrap.querySelector('#gen-dot') as HTMLElement).style.animation = 'none';
    (progWrap.querySelector('#gen-stop') as HTMLElement).style.display = 'none';
    shCont.innerHTML = '';
    renderAgent.setResult(`Render complete.<br>Output: Aurora_TVC_Final_v1.mp4<br>4K · 25Mbps · 15s · H.264`);

    const preview = document.createElement('div');
    preview.className = 'video-preview';
    preview.style.background = 'linear-gradient(135deg,#1e1b4b,#0f172a)';
    preview.innerHTML = `<div class="play-btn-overlay"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></div><div style="position:absolute;bottom:6px;left:8px;font-size:9.5px;color:#94a3b8">Aurora_TVC_Final_v1.mp4 · 4K · 25Mbps · 00:15</div>`;
    shCont.appendChild(preview);

    s5.setDone();
    setStatus('working', 'Step 5 ✓ → Final Report');
    await addContinueBar(5, 'Step 6: Final Report →');

    if (stopRef.current) return;

    // ===== STEP 6: FINAL REPORT =====
    const s6 = createStep(6, 'Final Report & Delivery', icon(ChartColumn));
    if (!s6) return;
    setCurrentStep(6);
    updatePipeline(5);

    const t6 = createThinkingBlock(`Compiling final report...
Gathering: project metadata, deliverables list,
performance estimates, cost summary.
Auto-filling all fields from session data...`);
    const ind6a = document.createElement('div');
    ind6a.className = 'indented';
    ind6a.appendChild(t6);
    s6.content.appendChild(ind6a);
    await sleep(1000);

    const s6body = addAIMessageContainer();
    if (s6body) {
      await streamText(s6body, `<strong>Step 6: Final Report & Delivery</strong>\n\nVideo generated successfully! Here's the complete project summary — all fields auto-filled from our session:`);
    }

    const report = document.createElement('div');
    report.style.cssText = 'margin-top:8px;background:#0d1220;border:1px solid #1e293b;border-radius:10px;padding:12px 14px';
    report.innerHTML = sanitizeHtml(`
      <div class="section-label green">✓ Project Complete — Aurora TVC v1</div>

      <div class="form-row"><label>Project Name</label><input class="form-input" value="Aurora Skincare — 15s TVC" readonly></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-row"><label>Duration</label><input class="form-input" value="15 seconds" readonly></div>
        <div class="form-row"><label>Resolution</label><input class="form-input" value="3840×2160 (4K)" readonly></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-row"><label>Creative Direction</label><input class="form-input" value="${stepData.direction || 'Cinematic Lifestyle'}" readonly></div>
        <div class="form-row"><label>Visual Style</label><input class="form-input" value="${stepData.variant || 'Variant A'}" readonly></div>
      </div>
      <div class="form-row"><label>Script Status</label><input class="form-input" value="${stepData.script || 'approved v1'}" readonly></div>

      <div class="section-label" style="margin-top:12px">${icon(Package, 11)} Deliverables</div>
      <table class="report-table">
        <tr><th>File</th><th>Format</th><th>Size</th><th>Action</th></tr>
        <tr><td>Aurora_TVC_Final.mp4</td><td>MP4 · H.264 · 4K</td><td>48.2 MB</td><td><span style="font-size:10.5px;color:#6366f1;cursor:pointer">${icon(Download, 10)} DL</span></td></tr>
        <tr><td>Aurora_TVC_1080p.mp4</td><td>MP4 · H.264 · 1080p</td><td>12.8 MB</td><td><span style="font-size:10.5px;color:#6366f1;cursor:pointer">${icon(Download, 10)} DL</span></td></tr>
        <tr><td>Aurora_TVC_Social.mp4</td><td>MP4 · 9:16 · 1080×1920</td><td>8.4 MB</td><td><span style="font-size:10.5px;color:#6366f1;cursor:pointer">${icon(Download, 10)} DL</span></td></tr>
        <tr><td>Aurora_TVC_Transcript.txt</td><td>TXT</td><td>2 KB</td><td><span style="font-size:10.5px;color:#6366f1;cursor:pointer">${icon(Download, 10)} DL</span></td></tr>
      </table>

      <div class="section-label" style="margin-top:12px">${icon(TrendingUp, 11)} Performance Estimate</div>
      <table class="report-table">
        <tr><th>Metric</th><th>Predicted</th><th>Benchmark</th></tr>
        <tr><td>Brand recall (24h)</td><td style="color:#4ade80">68%</td><td>52% (avg)</td></tr>
        <tr><td>Engagement rate</td><td style="color:#4ade80">4.2%</td><td>2.8% (avg)</td></tr>
        <tr><td>Purchase intent lift</td><td style="color:#4ade80">+23%</td><td>+12% (avg)</td></tr>
      </table>

      <div class="section-label" style="margin-top:12px">${icon(Wallet, 11)} Cost Summary</div>
      <div style="display:flex;gap:14px;font-size:11.5px">
        <span style="color:#94a3b8">Generation: <strong style="color:#e2e8f0">320 cr</strong></span>
        <span style="color:#94a3b8">Upscale 4K: <strong style="color:#e2e8f0">80 cr</strong></span>
        <span style="color:#94a3b8">Total: <strong style="color:#10b981">400 cr</strong></span>
      </div>
    `);
    s6.content.appendChild(report);

    const cta = document.createElement('div');
    cta.className = 'action-btn-row';
    cta.innerHTML = `<button class="btn-primary" id="open-editor-btn">${icon(PenLine, 12)} Open in Editor</button><button class="btn-secondary" id="create-another-btn">${icon(Plus, 12)} Create Another</button><button class="btn-secondary" id="export-report-btn">${icon(Download, 12)} Export Report</button>`;
    s6.content.appendChild(cta);

    (cta.querySelector('#open-editor-btn') as HTMLElement).onclick = () => alert('Opening in editor...');
    (cta.querySelector('#create-another-btn') as HTMLElement).onclick = () => clearAll();
    (cta.querySelector('#export-report-btn') as HTMLElement).onclick = () => exportReport();

    const banner = document.createElement('div');
    banner.className = 'complete-banner';
    banner.innerHTML = `<div class="complete-icon">✓</div><div><div style="font-size:12.5px;font-weight:700;color:#f1f5f9">Pipeline complete — all 6 steps finished</div><div style="font-size:11px;color:#64748b">Credits used: 400 · VRAM peak: 98% · Time saved vs manual: ~6h</div></div>`;
    s6.content.appendChild(banner);

    s6.setDone();
    setCurrentStep(7);
    updatePipeline(6);
    setStatus('done', '✓ Pipeline complete · Idle');

    setIsGenerating(false);
    scrollBottom();
  }, [addContinueBar, addAIMessageContainer, createStep, createSubAgent, createThinkingBlock, scrollBottom, setStatus, stepData, streamText, updatePipeline, addAIBlock, clearAll, exportReport]);

  // ===== 键盘事件 =====
  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  // ===== 初始化 =====
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  return (
    <div className="app-shell">
      {/* ====== HEADER ====== */}
      <header className="top-bar">
        <div className="agent-brand">
          <div className="agent-brand-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M12 2l2.4 5.6L20 9l-5.6 2.4L12 17l-2.4-5.6L4 9l5.6-1.4z" /></svg>
          </div>
          <div>
            <div className="agent-brand-name">ZeroExo Agent</div>
            <div className="agent-brand-sub" id="top-status-sub">
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#4ade80', marginRight: 4, verticalAlign: 'middle' }}></span>
              Idle — waiting for brief
            </div>
          </div>
        </div>
        <div className="pipeline-mini" ref={pipelineRef} style={{ display: 'none' }}>
          <div className="pipe-dot" data-step="1"></div><div className="pipe-line"></div>
          <div className="pipe-dot" data-step="2"></div><div className="pipe-line"></div>
          <div className="pipe-dot" data-step="3"></div><div className="pipe-line"></div>
          <div className="pipe-dot" data-step="4"></div><div className="pipe-line"></div>
          <div className="pipe-dot" data-step="5"></div><div className="pipe-line"></div>
          <div className="pipe-dot" data-step="6"></div>
        </div>
      </header>

      {/* ====== CONVERSATION ====== */}
      <div className="conversation" ref={convRef}>
        <div className="welcome-wrap" id="welcome">
          <div className="welcome-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
          </div>
          <h1 style={{ fontSize: 19, fontWeight: 700, color: '#f1f5f9', marginBottom: 6 }}>
            What TVC do you want to create?
          </h1>
          <p style={{ fontSize: 12.5, color: '#64748b', maxWidth: 420, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Describe your product, audience, and vibe. I'll handle strategy → script → storyboard → full video generation.
          </p>
          <div style={{ marginBottom: 20 }} id="quick-chips-init">
            {[
              { ic: Droplets, q: "Create a 15-second TVC for Aurora Skincare, a premium anti-aging serum. Target: women 35-55, affluent, wellness-focused. Tone: serene, scientific, luxe. Key message: 'Time bends for those who care.'", label: 'Aurora Skincare' },
              { ic: Car, q: 'A 15-second TVC for a luxury electric SUV, targeting affluent millennials, cinematic and aspirational tone', label: 'Luxury EV' },
              { ic: Zap, q: 'A high-energy 15s ad for a new energy drink, Gen Z audience, bold neon aesthetics', label: 'Energy Drink' },
              { ic: PawPrint, q: 'A heartwarming 15-second spot for a pet adoption campaign, emotional storytelling', label: 'Pet Adoption' },
            ].map((item) => (
              <button
                key={item.label}
                className="quick-chip"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                onClick={() => {
                  if (inputRef.current) {
                    inputRef.current.value = item.q;
                    inputRef.current.style.height = 'auto';
                    inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
                    sendMessage();
                  }
                }}
              >
                <item.ic size={12} strokeWidth={2} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div style={{ maxWidth: 500, margin: '0 auto', background: '#0d1220', border: '1px solid #1e293b', borderRadius: 10, padding: '12px 14px', textAlign: 'left' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#475569', marginBottom: 5 }}>
              Example brief
            </div>
            <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
              "Create a 15-second commercial for <strong style={{ color: '#cbd5e1' }}>Aurora Skincare</strong>, a premium anti-aging serum. Target: women 35-55. Tone: <em>serene, scientific, luxe</em>. Key message: 'Time bends for those who care.'"
            </p>
          </div>
        </div>
      </div>

      {/* ====== COMPOSER ====== */}
      <div className="composer-bar">
        <textarea
          ref={inputRef}
          className="composer-input"
          rows={1}
          placeholder="Message ZeroExo Agent…  (Enter to send)"
          onKeyDown={handleKey}
          onChange={(e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
          }}
        />
        <button className="send-btn" onClick={sendMessage} title="Send">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
          </svg>
        </button>
      </div>
    </div>
  );
}