/** @deprecated 已被 features/asset-library 取代，请勿新引用 */
/**
 * AssetContextPanel - 资产详情上下文面板
 *
 * 参考 zeroexo-asset-manager-v2.html 的 .context-panel 设计。
 * 显示资产的基本信息、参考素材、关联提示词、引用信息。
 * 仅在 full 模式下显示。
 */

import { X } from 'lucide-react';
import type { ContextPanelProps } from './types.js';
import { createStyles } from './styles.js';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n/config';

/** 状态标签 */
function statusLabel(status?: string): string {
  if (status === 'active') return i18n.t('assetBrowser.statusActive');
  if (status === 'draft') return i18n.t('assetBrowser.statusDraft');
  if (status === 'archived') return i18n.t('assetBrowser.statusArchived');
  return i18n.t('assetBrowser.statusUnknown');
}

/** 类型标签 */
function typeLabel(type?: string): string {
  const map: Record<string, string> = {
    character: i18n.t('assetBrowser.typeCharacter'),
    prop: i18n.t('assetBrowser.typeProp'),
    scene: i18n.t('assetBrowser.typeScene'),
    prompt: i18n.t('assetBrowser.typePrompt'),
    material: i18n.t('assetBrowser.typeMaterial'),
  };
  return map[type || ''] || i18n.t('assetBrowser.typeMaterial');
}

export function AssetContextPanel({
  asset,
  onClose,
  theme,
}: ContextPanelProps): React.ReactElement {
  const s = createStyles(theme);
  const { t } = useTranslation();
  const visible = !!asset;

  return (
    <div style={s.contextPanel(visible)}>
      {/* 头部 */}
      <div style={s.contextHeader()}>
        <span style={s.contextTitle()}>
          {asset ? asset.title : t('assetBrowser.selectAssetToView')}
        </span>
        {asset && (
          <button
            type="button"
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', color: theme.toolbar.textMuted,
              borderRadius: 6, cursor: 'pointer',
            }}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* 内容 */}
      <div style={s.contextBody()}>
        {!asset ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: theme.toolbar.textMuted, fontSize: 13 }}>
            <p dangerouslySetInnerHTML={{ __html: t('assetBrowser.emptyHint') }} />
          </div>
        ) : (
          <>
            {/* 基本信息 */}
            <div style={s.contextSection()}>
              <div style={s.contextSectionTitle()}>{t('assetBrowser.basicInfo')}</div>
              <div style={s.contextRow()}>
                <span style={s.contextLabel()}>{t('assetBrowser.typeLabel')}</span>
                <span style={s.contextValue()}>{typeLabel(asset.type)}</span>
              </div>
              <div style={s.contextRow()}>
                <span style={s.contextLabel()}>{t('assetBrowser.statusLabel')}</span>
                <span style={s.contextValue()}>
                  <span style={{ ...s.statusDot(asset.status || 'active'), display: 'inline-block', marginRight: 5, verticalAlign: 'middle' }} />
                  {statusLabel(asset.status)}
                </span>
              </div>
              {asset.tags && asset.tags.length > 0 && (
                <div style={s.contextRow()}>
                  <span style={s.contextLabel()}>{t('assetBrowser.tagsLabel')}</span>
                  <span style={s.contextValue()}>
                    {asset.tags.map((tag, i) => (
                      <span key={i} style={{
                        display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                        fontSize: 10, marginRight: 3, marginBottom: 2,
                        background: theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                        color: theme.toolbar.textMuted, border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
                      }}>
                        {tag}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <div style={s.contextRow()}>
                <span style={s.contextLabel()}>{t('assetBrowser.referenceCount')}</span>
                <span style={s.contextValue()}>{t('assetBrowser.referenceCountValue', { count: asset.refs || 0 })}</span>
              </div>
              <div style={s.contextRow()}>
                <span style={s.contextLabel()}>{t('assetBrowser.modifiedAt')}</span>
                <span style={s.contextValue()}>{asset.updatedAt || i18n.t('assetBrowser.statusUnknown')}</span>
              </div>
            </div>

            {/* 关联提示词（仅角色类型显示） */}
            {asset.type === 'character' && (
              <div style={s.contextSection()}>
                <div style={s.contextSectionTitle()}>{t('assetBrowser.relatedPrompts')}</div>
                <div style={{
                  background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                  border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'}`,
                  borderRadius: 8, padding: '8px 10px', fontSize: 11, color: theme.toolbar.textMuted, lineHeight: 1.6, marginBottom: 6,
                }}>
                  Cinematic close-up of {asset.title}, soft rim light, shallow depth of field, emotional expression
                </div>
              </div>
            )}

            {/* 被引用 */}
            <div style={s.contextSection()}>
              <div style={s.contextSectionTitle()}>{t('assetBrowser.referencedBy')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px',
                  background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                  border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'}`,
                  borderRadius: 9999, fontSize: 11, color: theme.toolbar.textMuted, cursor: 'pointer',
                }}>
                  镜头_001
                </span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px',
                  background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                  border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'}`,
                  borderRadius: 9999, fontSize: 11, color: theme.toolbar.textMuted, cursor: 'pointer',
                }}>
                  镜头_007
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}