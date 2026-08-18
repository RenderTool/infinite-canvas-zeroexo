/**
 * PolicyPage - 政策公告页面（沉浸式布局）
 *
 * 无边框、无阴影、无分割线的沉浸式设计。
 * 顶部粘性导航栏（返回 ← + 标题 + 刷新 ↻），左侧 220px 目录导航，右侧 Markdown 内容区。
 * 从 GET /api/policies 获取列表，分组为"政策"/"公告"。
 * 点击菜单项从 GET /api/policies/:key 加载内容。
 */

import { useEffect, useState, useCallback, useRef, type CSSProperties } from 'react';
import { useTheme, AnimatedThemeToggler } from '@zeroexo/plugin-theme';
import { X, RefreshCw, Loader2, Menu } from 'lucide-react';
import { Button, Tooltip } from 'antd';
import { LogoIcon } from '@/assets/ico/index.js';
import { apiGet } from '@/services/api-client.js';
import ReactMarkdown from 'react-markdown';
import { LanguageSwitcher } from '@/shared/components/language-switcher.js';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { FALLBACK_POLICIES } from '@/shared/data/policy-fallback.js';

interface PolicyItem {
  id: string;
  key: string;
  title: string;
  type: 'policy' | 'announcement';
  updatedAt: string;
}

interface PolicyDetail {
  id: string;
  key: string;
  title: string;
  content: string;
  updatedAt: string;
  type: 'policy' | 'announcement';
}

export function PolicyPage({ policyKey }: { policyKey?: string }): React.ReactElement {
  const { theme } = useTheme();
  const { i18n } = useTranslation();
  const isDark = theme.mode === 'dark';

  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<PolicyDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const initialPolicyKeyRef = useRef(policyKey);
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // 获取列表
  const fetchList = useCallback(() => {
    setLoadingList(true);
    const lang = i18n.language?.startsWith('zh') ? 'zh' : i18n.language === 'ja' ? 'ja' : 'en';
    apiGet<{ key: string; title: string; type: string; updatedAt: string }[]>(`/policies?lang=${lang}`)
      .then((data) => {
        const items: PolicyItem[] = data.map((d) => ({
          id: d.key,
          key: d.key,
          title: d.title,
          type: d.type as 'policy' | 'announcement',
          updatedAt: d.updatedAt,
        }));
        setPolicies(items);
        if (items.length > 0) {
          const targetKey = initialPolicyKeyRef.current ?? items[0]?.key ?? null;
          setActiveKey(targetKey);
        }
      })
      .catch(() => {
        // 后端不可用时，使用备用列表
        const fallbackList: PolicyItem[] = FALLBACK_POLICIES.map((p) => ({
          id: p.key,
          key: p.key,
          title: p.title,
          type: p.type,
          updatedAt: '',
        }));
        setPolicies(fallbackList);
        if (fallbackList.length > 0) {
          const targetKey = initialPolicyKeyRef.current ?? fallbackList[0]?.key ?? null;
          setActiveKey(targetKey);
        }
      })
      .finally(() => {
        setLoadingList(false);
      });
  }, [i18n.language]);

  useEffect(() => {
    fetchList();
  }, [i18n.language, fetchList]);

  const fetchDetail = useCallback((key: string) => {
    setLoadingDetail(true);
    const lang = i18n.language?.startsWith('zh') ? 'zh' : i18n.language === 'ja' ? 'ja' : 'en';
    apiGet<{ key: string; title: string; content: string; type: string; updatedAt: string }>(`/policies/${key}?lang=${lang}`)
      .then((data) => {
        setDetail({
          id: data.key,
          key: data.key,
          title: data.title,
          content: data.content,
          type: data.type as 'policy' | 'announcement',
          updatedAt: data.updatedAt,
        });
      })
      .catch(() => {
        // 后端不可用时，使用备用内容
        const fallback = FALLBACK_POLICIES.find((p) => p.key === key);
        if (fallback) {
          // 根据语言选择对应标题
          let fbTitle = fallback.title;
          if (lang === 'en' && fallback.titleEn) fbTitle = fallback.titleEn;
          else if (lang === 'ja' && fallback.titleJa) fbTitle = fallback.titleJa;
          setDetail({
            id: fallback.key,
            key: fallback.key,
            title: fbTitle,
            content: fallback.content,
            type: fallback.type,
            updatedAt: '',
          });
        } else {
          setDetail(null);
        }
      })
      .finally(() => {
        setLoadingDetail(false);
      });
  }, [i18n.language]);

  // 选中项变化或语言变化时加载详情
  useEffect(() => {
    if (!activeKey) return;
    fetchDetail(activeKey);
  }, [activeKey, fetchDetail]);

  const handleBack = useCallback(() => {
    window.history.back();
  }, []);

  const handleRefresh = useCallback(() => {
    fetchList();
    if (activeKey) {
      fetchDetail(activeKey);
    }
  }, [activeKey, fetchDetail, fetchList]);

  // 按类型分组
  const policyItems = policies.filter((p) => p.type === 'policy');
  const announcementItems = policies.filter((p) => p.type === 'announcement');

  const textColor = theme.toolbar?.text || '#000';
  const textMuted = theme.toolbar?.textMuted || 'rgba(0,0,0,0.4)';
  const accent = theme.toolbar?.accent || '#ff1a2c';

  // 渲染分组菜单
  const renderGroup = (items: PolicyItem[], groupLabel: string) => {
    if (items.length === 0) return null;
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{
          padding: '6px 16px 4px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: textMuted,
          opacity: 0.6,
        }}>
          {groupLabel}
        </div>
        {items.map((item) => {
          const isActive = activeKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveKey(item.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 16px',
                border: 'none',
                background: isActive
                  ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)')
                  : 'transparent',
                color: isActive ? textColor : textMuted,
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isActive ? accent : 'transparent',
                flexShrink: 0,
              }} />
              <span style={{ flex: 1, textAlign: 'left' }}>{item.title}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div style={pageStyle(theme)}>
      {/* 移动端侧边栏遮罩 */}
      {isMobile && mobileMenuOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 99,
          }}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* 左侧导航目录 */}
      <div style={{
        ...navSidebarStyle,
        ...(isMobile
          ? {
              position: 'fixed' as const,
              left: 0,
              top: 0,
              bottom: 0,
              zIndex: 100,
              background: theme.canvas?.background || '#f5f5f5',
              transform: mobileMenuOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
              boxShadow: mobileMenuOpen ? '4px 0 24px rgba(0,0,0,0.15)' : 'none',
            }
          : {}),
      }}>
        {/* LOGO */}
        <div style={logoContainerStyle}>
          <LogoIcon size={28} style={{ flexShrink: 0 }} />
        </div>
        <div style={navListStyle}>
          {loadingList ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <Loader2 size={18} style={{ animation: 'zeroexo-spin 1s linear infinite', opacity: 0.5 }} />
            </div>
          ) : policies.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, opacity: 0.4, textAlign: 'center' }}>
              暂无内容
            </div>
          ) : (
            <>
              {renderGroup(policyItems, '政策')}
              {renderGroup(announcementItems, '公告')}
            </>
          )}
        </div>
      </div>

      {/* 右侧内容区 */}
      <div style={contentWrapperStyle}>
        {/* 顶部粘性导航栏 */}
        <div style={topNavStyle(isMobile)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {isMobile && (
              <Button
                type="text"
                icon={<Menu size={16} />}
                onClick={() => setMobileMenuOpen(true)}
                style={{ width: 32, height: 32, padding: 0, color: theme.toolbar.text, flexShrink: 0 }}
              />
            )}
            <span style={titleStyle(textColor)}>
              {detail?.title ?? '政策公告'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <Tooltip title="刷新">
            <Button
              type="text"
              icon={<RefreshCw size={14} />}
              onClick={handleRefresh}
              style={{ width: 32, height: 32, padding: 0, color: theme.toolbar.text }}
            />
            </Tooltip>
            <LanguageSwitcher theme={theme} />
            <AnimatedThemeToggler
              iconSize={14}
              style={{ width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.toolbar.text }}
            />
            <Tooltip title="关闭">
            <Button
              type="text"
              icon={<X size={14} />}
              onClick={handleBack}
              style={{ width: 32, height: 32, padding: 0, color: theme.toolbar.text }}
            />
            </Tooltip>
          </div>
        </div>

        {/* Markdown 内容 */}
        <div style={scrollContentStyle}>
          {loadingDetail ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
              <Loader2 size={24} style={{ animation: 'zeroexo-spin 1s linear infinite', opacity: 0.5 }} />
            </div>
          ) : detail ? (
            <div style={markdownWrapperStyle(isMobile)}>
              {detail.updatedAt && (
                <p style={{ ...mdDateStyle(textMuted), marginBottom: 24 }}>
                  最后更新：{new Date(detail.updatedAt).toLocaleDateString('zh-CN')}
                </p>
              )}
              <div style={mdBodyStyle(isDark)}>
                <ReactMarkdown
                  components={{
                    h2: ({ children, ...props }) => (
                      <h2 style={mdH2Style(textColor)} {...props}>{children}</h2>
                    ),
                    h3: ({ children, ...props }) => (
                      <h3 style={mdH3Style(textColor)} {...props}>{children}</h3>
                    ),
                    p: ({ children, ...props }) => (
                      <p style={mdPStyle(isDark)} {...props}>{children}</p>
                    ),
                    ul: ({ children, ...props }) => (
                      <ul style={mdUlStyle} {...props}>{children}</ul>
                    ),
                    li: ({ children, ...props }) => (
                      <li style={mdLiStyle(isDark)} {...props}>{children}</li>
                    ),
                    a: ({ children, href, ...props }) => (
                      <a
                        style={mdLinkStyle(accent)}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        {...props}
                      >
                        {children}
                      </a>
                    ),
                    strong: ({ children, ...props }) => (
                      <strong style={{ fontWeight: 600, color: textColor }} {...props}>{children}</strong>
                    ),
                    code: ({ children, ...props }) => (
                      <code style={mdCodeStyle(isDark)} {...props}>{children}</code>
                    ),
                    pre: ({ children, ...props }) => (
                      <pre style={mdPreStyle(isDark)} {...props}>{children}</pre>
                    ),
                    blockquote: ({ children, ...props }) => (
                      <blockquote style={mdBlockquoteStyle(accent, isDark)} {...props}>{children}</blockquote>
                    ),
                  }}
                >
                  {detail.content}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 80, opacity: 0.4, fontSize: 14 }}>
              请从左侧选择一个项目
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== 样式（无边框、无阴影、无分割线） =====

function pageStyle(theme: any): CSSProperties {
  return {
    display: 'flex',
    height: '100%',
    width: '100%',
    overflow: 'hidden',
    background: theme.canvas?.background || '#f5f5f5',
  };
}

const navSidebarStyle: CSSProperties = {
  width: 220,
  minWidth: 220,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'transparent',
};

const logoContainerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '16px 16px 8px',
  flexShrink: 0,
};

const navListStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '16px 0',
};

const contentWrapperStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  minWidth: 0,
};

function topNavStyle(isMobile: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: isMobile ? '10px 12px' : '12px 24px',
    position: 'sticky',
    top: 0,
    zIndex: 10,
    background: 'transparent',
  };
}

function titleStyle(color: string): CSSProperties {
  return {
    fontSize: 15,
    fontWeight: 600,
    color,
    fontFamily: "'Sora', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  };
}

const scrollContentStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
};

function markdownWrapperStyle(isMobile: boolean): CSSProperties {
  return {
    maxWidth: isMobile ? '100%' : 800,
    margin: '0 auto',
    padding: isMobile ? '0 16px 48px' : '0 32px 64px',
  };
}

function mdDateStyle(color: string): CSSProperties {
  return {
    fontSize: 13,
    color,
    margin: '0 0 32px',
  };
}

function mdBodyStyle(isDark: boolean): CSSProperties {
  return {
    lineHeight: 1.8,
    color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.7)',
  };
}

function mdH2Style(color: string): CSSProperties {
  return {
    fontFamily: "'Sora', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    fontSize: 24,
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color,
    margin: '40px 0 16px',
    paddingTop: 8,
  };
}

function mdH3Style(color: string): CSSProperties {
  return {
    fontFamily: "'Sora', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color,
    margin: '28px 0 12px',
  };
}

function mdPStyle(isDark: boolean): CSSProperties {
  return {
    fontSize: 15,
    lineHeight: 1.8,
    color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.7)',
    margin: '0 0 16px',
    textAlign: 'justify' as const,
  };
}

const mdUlStyle: CSSProperties = {
  listStyle: 'disc',
  paddingLeft: 24,
  margin: '0 0 16px',
};

function mdLiStyle(isDark: boolean): CSSProperties {
  return {
    fontSize: 15,
    lineHeight: 1.8,
    color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.7)',
    margin: '0 0 4px',
  };
}

function mdLinkStyle(accent: string): CSSProperties {
  return {
    color: accent,
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  };
}

function mdCodeStyle(isDark: boolean): CSSProperties {
  return {
    fontSize: '0.9em',
    padding: '2px 6px',
    borderRadius: 4,
    background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  };
}

function mdPreStyle(isDark: boolean): CSSProperties {
  return {
    padding: 12,
    borderRadius: 8,
    overflowX: 'auto',
    background: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)',
    margin: '0 0 16px',
  };
}

function mdBlockquoteStyle(accent: string, isDark: boolean): CSSProperties {
  return {
    borderLeft: `4px solid ${accent}`,
    paddingLeft: 16,
    margin: '0 0 16px',
    color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
    fontStyle: 'italic',
    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
    padding: '4px 0 4px 16px',
  };
}