/**
 * LanguageSwitcher - 语言切换按钮(触发 LanguageDialog 弹窗)
 *
 * 共享组件,统一所有页面(包括登录页、政策公告页、顶栏等)的语言切换入口。
 * 设计:与换肤按钮行为一致,点击打开居中弹窗,屏幕中心显示。
 * 触发器:Globe 图标(纯 icon,无文字后缀)。
 * 语言偏好持久化到 localStorage('zeroexo:lang')。
 */

import { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import type { AppLang } from '@/i18n/config.js';
import { LanguageDialog } from '@/shared/components/language-dialog.js';

export interface LanguageSwitcherProps {
  theme: ThemeConfig;
  /** 纯条目模式(导航菜单中使用,去掉按钮样式) */
  plain?: boolean;
}

export function LanguageSwitcher({ theme, plain = false }: LanguageSwitcherProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.language as AppLang) || 'zh';
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleOpen = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setDialogOpen(false);
  }, []);

  const plainStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    cursor: 'pointer',
    color: theme.toolbar.text,
    fontSize: 13,
  };

  return (
    <>
      {plain ? (
        <span style={plainStyle} onClick={handleOpen}>
          {t(`language.${currentLang}`)}
        </span>
      ) : (
        <Tooltip title={t(`language.${currentLang}`)}>
          <Button
            type="text"
            icon={<Languages size={14} />}
            onClick={handleOpen}
            style={{ width: 32, height: 32, padding: 0, color: theme.toolbar.text }}
          />
        </Tooltip>
      )}
      {dialogOpen && (
        <LanguageDialog
          theme={theme}
          currentLang={currentLang}
          onClose={handleClose}
        />
      )}
    </>
  );
}