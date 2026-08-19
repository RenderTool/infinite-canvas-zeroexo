/*
 * AI 测试页面 - 多 Tab 测试平台
 *
 * 支持语言 / 图像 / 语音 / 视频四种生成类型测试。
 * 各 Tab 独立管理渠道选择和模型列表,数据兼容共享。
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, message, Modal, Card } from 'antd';
import {
  MessageOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import BreadcrumbLayout from '@/components/BreadcrumbLayout';
import { apiGet, apiFetch, showApiError } from '@/services/api-client';
import ImageWorkbench from '@/components/ai-test/ImageWorkbench';
import VoiceTab from '@/components/ai-test/VoiceTab';
import VideoTab from '@/components/ai-test/VideoTab';
import ChatMessageList from '@/components/ai-test/ChatMessageList';
import ChatInputBar from '@/components/ai-test/ChatInputBar';
import type { Message } from '@/components/ai-test/chat-types';
import type { ProviderItem, ModelOption } from '@/components/ai-test/types';
import { useChatSession } from '@/components/ai-test/use-chat-session';
import { useChatRestore } from '@/components/ai-test/use-chat-restore';
import {
  estimateMessagesTokens,
  formatDate,
  DEFAULT_CONTEXT_LIMIT,
  AUTO_TRUNCATE_THRESHOLD,
  KEEP_RECENT,
} from '@/components/ai-test/chat-utils';

export default function AiTestPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'text';

  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);

  useEffect(() => {
    const cacheVersion = localStorage.getItem('ai-chat-cache-version');
    if (cacheVersion !== 'v3') {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('ai-test-chat:')) {
            keysToRemove.push(key);
          }
        }
        for (const key of keysToRemove) {
          localStorage.removeItem(key);
        }
        localStorage.setItem('ai-chat-cache-version', 'v3');
      } catch { /* ignore */ }
    }
  }, []);

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [truncatedCount, setTruncatedCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [thinkingMode, setThinkingMode] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const {
    messages,
    setMessages,
    loadSession,
    refreshSession,
    clearSession,
    prepareSwitch,
  } = useChatSession();

  const handleRestore = useCallback((providerId: string, model: string, msgs: Message[]) => {
    setSelectedProviderId(providerId);
    setSelectedModel(model);
    setMessages(msgs);
  }, [setMessages]);

  useChatRestore({ activeTab, onRestore: handleRestore });

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      const data = await apiGet<{ items: ProviderItem[] }>(
        '/admin/api-providers?type=ai&enabled=true',
      );
      const items = data.items || [];
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();
      const deduped = items.filter((p) => {
        if (seenIds.has(p.id)) return false;
        seenIds.add(p.id);
        if (seenNames.has(p.name)) return false;
        seenNames.add(p.name);
        return true;
      });
      setProviders(deduped);
    } catch (err) {
      showApiError(err, t('aiTest.loadProvidersFailed'));
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const handleRefreshAll = useCallback(async () => {
    await loadProviders();
    if (selectedProviderId && selectedModel) {
      await refreshSession(selectedProviderId, selectedModel);
      message.success(t('aiTest.refreshSuccess'));
    }
  }, [loadProviders, selectedProviderId, selectedModel, refreshSession]);

  const hasCachedModels = useMemo(() => {
    const sel = providers.find((p) => p.id === selectedProviderId);
    return sel?.config?.fetchedModels !== undefined;
  }, [providers, selectedProviderId]);

  const handleTabChange = (key: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', key);
      return next;
    });
  };

  useEffect(() => {
    if (!selectedProviderId) {
      setModelOptions([]);
      setSelectedModel(null);
      return;
    }
    const provider = providers.find((p) => p.id === selectedProviderId);
    const cachedModels = provider?.config?.fetchedModels as Record<string, string[]> | undefined;

    if (cachedModels) {
      const enabledList = provider?.config?.enabledModels as string[] | undefined;
      const enabledSet = enabledList ? new Set(enabledList) : null;
      const opts: ModelOption[] = [];
      const seen = new Set<string>();
      for (const [type, ids] of Object.entries(cachedModels)) {
        if (type !== 'llm') continue;
        ids.forEach((id) => {
          if (seen.has(id)) return;
          seen.add(id);
          if (enabledSet && !enabledSet.has(id)) return;
          opts.push({
            label: `${id}`,
            value: id,
            type,
            iconProvider: (provider?.config?.modelIcons as Record<string, string> | undefined)?.[id.toLowerCase()] || provider?.provider || '',
          });
        });
      }
      setModelOptions(opts);
      if (opts.length > 0) {
        const stillExists = opts.some((o) => o.value === selectedModel);
        if (!stillExists) {
          const scopedLastModel = localStorage.getItem(`ai-chat-last-model:${selectedProviderId}`);
          const globalLastModel = localStorage.getItem('ai-chat-last-model');
          const candidate = scopedLastModel && opts.some((o) => o.value === scopedLastModel)
            ? scopedLastModel
            : (globalLastModel && opts.some((o) => o.value === globalLastModel)
                ? globalLastModel
                : opts[0].value);
          setSelectedModel(candidate);
        }
      } else {
        setSelectedModel(null);
      }
    } else {
      setModelOptions([]);
      if (!selectedModel) setSelectedModel(null);
    }
  }, [selectedProviderId, providers]);

  useEffect(() => {
    if (!selectedProviderId || !selectedModel || sending) return;
    loadSession(selectedProviderId, selectedModel);
  }, [selectedProviderId, selectedModel, sending, loadSession]);

  const tokenUsage = useMemo(() => {
    const used = estimateMessagesTokens(messages);
    const limit = DEFAULT_CONTEXT_LIMIT;
    return { used, limit, percent: Math.min((used / limit) * 100, 100) };
  }, [messages]);

  const shouldTruncate = tokenUsage.percent >= AUTO_TRUNCATE_THRESHOLD * 100;

  useEffect(() => {
    if (messages.length <= KEEP_RECENT) return;
    if (!shouldTruncate) return;
    const dropped = messages.length - KEEP_RECENT;
    setMessages((prev) => prev.slice(-KEEP_RECENT));
    setTruncatedCount((prev) => prev + dropped);
    message.info(t('aiTest.autoTruncate', { pct: Math.round(AUTO_TRUNCATE_THRESHOLD * 100), count: dropped }));
  }, [messages, shouldTruncate, setMessages]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text) return;
    if (!selectedProviderId) { message.warning(t('aiTest.selectChannel')); return; }
    if (!selectedModel) { message.warning(t('aiTest.selectModel')); return; }

    const userMsg: Message = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInputValue('');
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const apiMessages = nextMessages.map((m) => ({ role: m.role, content: m.content }));
      const result = await apiFetch<{ content: string; thinkingContent?: string }>('/admin/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          providerId: selectedProviderId,
          model: selectedModel,
          messages: apiMessages,
          thinkingMode,
        }),
        signal: controller.signal,
      });
      const assistantMsg: Message = { role: 'assistant', content: result.content };
      if (result.thinkingContent) {
        assistantMsg.thinkingContent = result.thinkingContent;
      }
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      showApiError(err, t('aiTest.responseFailed'));
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleSelectProvider = (id: string) => {
    localStorage.setItem('ai-chat-last-provider', id);
    prepareSwitch(id, '__default__');
    setSelectedProviderId(id);
    setSelectedModel(null);
    setMessages([]);
    setTruncatedCount(0);
  };

  useEffect(() => {
    if (selectedModel) {
      localStorage.setItem('ai-chat-last-model', selectedModel);
      if (selectedProviderId) {
        localStorage.setItem(`ai-chat-last-model:${selectedProviderId}`, selectedModel);
      }
    }
  }, [selectedModel, selectedProviderId]);

  useEffect(() => {
    if (providers.length === 0) return;
    if (selectedProviderId) return;
    const lastProvider = localStorage.getItem('ai-chat-last-provider');
    if (lastProvider && providers.some((p) => p.id === lastProvider)) {
      setSelectedProviderId(lastProvider);
    }
  }, [providers, selectedProviderId]);

  const handleCopyMessage = async (idx: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch { /* ignore */ }
  };

  const handleDeleteFrom = (fromIndex: number) => {
    const count = messages.length - fromIndex;
    if (count <= 0) return;
    Modal.confirm({
      title: t('aiTest.deleteSubsequentTitle'),
      content: t('aiTest.deleteSubsequentContent', { count }),
      okText: t('aiTest.deleteSubsequentOk'),
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => {
        setMessages((prev) => prev.slice(0, fromIndex));
        setTruncatedCount(0);
      },
    });
  };

  const handleManualTruncate = () => {
    if (messages.length <= KEEP_RECENT) { message.info(t('aiTest.insufficientMessages', { count: KEEP_RECENT })); return; }
    const dropped = messages.length - KEEP_RECENT;
    Modal.confirm({
      title: t('aiTest.truncateTitle'),
      centered: true,
      content: t('aiTest.truncateContent', { count: dropped, keepRecent: KEEP_RECENT }),
      okText: t('aiTest.truncateOk'),
      okButtonProps: { danger: true },
      onOk: () => {
        setMessages((prev) => prev.slice(-KEEP_RECENT));
        setTruncatedCount((prev) => prev + dropped);
        message.success(t('aiTest.truncated', { count: dropped }));
      },
    });
  };

  const handleNewChat = () => {
    if (!selectedProviderId || !selectedModel) return;
    if (messages.length > 0) {
      Modal.confirm({
        title: t('aiTest.newChatTitle'),
        content: t('aiTest.newChatContent'),
        centered: true,
        onOk: () => clearSession(selectedProviderId, selectedModel),
      });
    } else {
      clearSession(selectedProviderId, selectedModel);
    }
  };

  const handleExport = () => {
    if (messages.length === 0) { message.info(t('aiTest.noExportData')); return; }
    setExporting(true);
    try {
      const providerName = providers.find((p) => p.id === selectedProviderId)?.name || 'unknown';
      const timestamp = formatDate(new Date()).replace(/[/:]/g, '-');
      const content =
        `# AI 对话 - ${providerName}\n` +
        `- 模型: ${selectedModel || 'N/A'}\n` +
        `- 导出时间: ${new Date().toLocaleString('zh-CN')}\n` +
        (truncatedCount > 0 ? `- 已截断历史: ${truncatedCount} 条\n` : '') +
        `\n` +
        messages.map((m) => `## ${m.role === 'user' ? '用户' : 'AI'}\n\n${m.content}\n`).join('---\n\n');
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-test-${providerName}-${timestamp}.md`;
      a.click();
      URL.revokeObjectURL(url);
      message.success(t('aiTest.exportSuccess'));
    } finally { setExporting(false); }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const hasMessages = messages.length > 0;
  const canTruncate = messages.length > KEEP_RECENT;
  const inputDisabled = !selectedProviderId || !selectedModel;

  const tabItems = [
    {
      key: 'text',
      label: <span><MessageOutlined style={{ marginRight: 4, verticalAlign: -2 }} />{t('ai.type.llm')}</span>,
      children: (
        <Card
          size="small"
          style={{ borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 'max(calc(100vh - 155px), 450px)' }}
          styles={{ body: { padding: 0, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageOutlined style={{ fontSize: 14 }} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>{t('aiTest.tab.text')}</span>
              {selectedModel && (
                <span style={{ 
                  padding: '0 8px', 
                  background: 'var(--color-primary-light)', 
                  borderRadius: 4, 
                  fontSize: 11, 
                  color: 'var(--color-primary)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4
                }} onClick={() => {
                  navigator.clipboard.writeText(selectedModel).then(() => message.success(t('aiTest.modelIdCopied')));
                }}>
                  {selectedModel}
                </span>
              )}
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8, gap: 8 }}>
            <ChatMessageList
              messages={messages}
              sending={sending}
              truncatedCount={truncatedCount}
              copiedIdx={copiedIdx}
              onCopyMessage={handleCopyMessage}
              onDeleteFrom={handleDeleteFrom}
              messagesEndRef={messagesEndRef}
            />
            <ChatInputBar
              inputValue={inputValue}
              onInputChange={setInputValue}
              onSend={handleSend}
              onStop={handleStop}
              onKeyDown={handleKeyDown}
              sending={sending}
              disabled={inputDisabled}
              providers={providers}
              providersLoading={providersLoading}
              selectedProviderId={selectedProviderId}
              onSelectProvider={handleSelectProvider}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              modelOptions={modelOptions}
              hasCachedModels={hasCachedModels}
              tokenUsage={tokenUsage}
              thinkingMode={thinkingMode}
              onToggleThinkingMode={setThinkingMode}
              onNewChat={handleNewChat}
              onManualTruncate={handleManualTruncate}
              onExport={handleExport}
              exporting={exporting}
              hasMessages={hasMessages}
              canTruncate={canTruncate}
              onRefreshProviders={handleRefreshAll}
            />
          </div>
        </Card>
      ),
    },
    {
      key: 'image',
      label: <span><PictureOutlined style={{ marginRight: 4, verticalAlign: -2 }} />{t('ai.type.image')}</span>,
      children: <ImageWorkbench providers={providers} providersLoading={providersLoading} onRefreshProviders={handleRefreshAll} />,
      forceRender: true,
    },
    {
      key: 'video',
      label: <span><VideoCameraOutlined style={{ marginRight: 4, verticalAlign: -2 }} />{t('ai.type.video')}</span>,
      children: <VideoTab providers={providers} providersLoading={providersLoading} onRefreshProviders={handleRefreshAll} />,
    },
    {
      key: 'voice',
      label: <span><AudioOutlined style={{ marginRight: 4, verticalAlign: -2 }} />{t('ai.type.audio')}</span>,
      children: <VoiceTab providers={providers} providersLoading={providersLoading} />,
    },
  ];

  return (
    <>
      <BreadcrumbLayout items={[{ title: t('aiTest.title') }]}>
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={tabItems}
        />
      </BreadcrumbLayout>
    </>
  );
}