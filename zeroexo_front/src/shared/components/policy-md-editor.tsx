/**
 * PolicyMdEditor - 政策公告富文本编辑器（Markdown）
 *
 * 基于 @uiw/react-md-editor，支持：
 * - 完整的 MD 工具栏（加粗/斜体/标题/列表/链接/引用/代码块/表格）
 * - 图片上传 → CAS 去重存储（presign API）
 * - 超链接插入
 * - 视频嵌入（iframe 或 video 标签）
 * - 实时预览
 * - 多语言编辑（切换 Tab 分别编辑不同语言内容）
 *
 * 使用方式类似微信公众号编辑器，但使用 Markdown 作为底层格式。
 */

import { useCallback } from 'react';
import MDEditor, { type ICommand, commands } from '@uiw/react-md-editor';
import { useTheme } from '@zeroexo/plugin-theme';
import { message } from 'antd';
import { Image, Link, Video, Upload as UploadIcon } from 'lucide-react';
import { apiPost } from '@/services/api-client.js';
import i18n from '@/i18n/config';

interface PolicyMdEditorProps {
  /** 当前语言内容 */
  value: string;
  /** 内容变化回调 */
  onChange: (value: string) => void;
  /** 高度（默认 500） */
  height?: number;
  /** 是否只读 */
  readonly?: boolean;
  /** 占位符文本 */
  placeholder?: string;
}

// ====== 自定义命令：插入图片（上传到 CAS） ======
const imageUploadCommand: ICommand = {
  name: 'image-upload',
  keyCommand: 'image-upload',
  buttonProps: { 'aria-label': i18n.t('policyEditor.insertImage') },
  icon: (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Image size={14} />
      <span style={{ fontSize: 12 }}>{i18n.t('policyEditor.imageLabel')}</span>
    </span>
  ),
  execute: async (_state, api) => {
    // 创建隐藏的文件输入
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        // 计算文件哈希（用于 CAS 去重）
        const arrayBuffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

        const ext = file.name.split('.').pop() || 'png';

        // 1. presign 获取上传 URL
        const { uploadUrl, storageKey } = await apiPost<{ uploadUrl: string | null; storageKey: string }>('/resources/presign', {
          body: {
            mimeType: file.type,
            ext,
            contentHash: hash,
            size: file.size,
            scope: 'public',
          },
        });

        // 2. 上传文件
        if (uploadUrl) {
          const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type },
          });
          if (!uploadRes.ok) throw new Error('上传失败');
        }

        // 3. 插入 Markdown 图片语法
        const resourceUrl = `/api/resources/file/${storageKey}`;
        api?.replaceSelection(`![${file.name}](${resourceUrl})`);
      } catch (err) {
        message.error(i18n.t('policyEditor.imageUploadFailed'));
      }
    };
    input.click();
  },
};

// ====== 自定义命令：插入视频链接 ======
const videoInsertCommand: ICommand = {
  name: 'video-insert',
  keyCommand: 'video-insert',
  buttonProps: { 'aria-label': i18n.t('policyEditor.insertVideo') },
  icon: (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Video size={14} />
      <span style={{ fontSize: 12 }}>{i18n.t('policyEditor.videoLabel')}</span>
    </span>
  ),
  execute: (_state, api) => {
    const raw = window.prompt(i18n.t('policyEditor.videoUrlPrompt'));
    if (!raw) return;
    const trimmed = raw.trim();
    // 仅允许 http/https 链接,防止 javascript:/data: 等危险 scheme 嵌入 iframe
    let url: URL | null = null;
    try {
      url = new URL(trimmed);
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
      message.warning(i18n.t('policyEditor.videoUrlInvalid'));
      return;
    }
    const href = url.href;
    // 检测是否为嵌入链接
    if (href.includes('embed') || href.includes('player')) {
      api?.replaceSelection(`\n<iframe src="${href}" width="100%" height="400" frameborder="0" allowfullscreen></iframe>\n`);
    } else {
      api?.replaceSelection(`[视频](${href})`);
    }
  },
};

// ====== 自定义命令：插入超链接 ======
const linkInsertCommand: ICommand = {
  name: 'link-insert',
  keyCommand: 'link-insert',
  buttonProps: { 'aria-label': i18n.t('policyEditor.insertLink') },
  icon: (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Link size={14} />
      <span style={{ fontSize: 12 }}>{i18n.t('policyEditor.linkLabel')}</span>
    </span>
  ),
  execute: (_state, api) => {
    const url = window.prompt(i18n.t('policyEditor.linkUrlPrompt'));
    if (url) {
      const text = window.prompt(i18n.t('policyEditor.linkTextPrompt'), i18n.t('policyEditor.clickToVisit'));
      api?.replaceSelection(`[${text || i18n.t('policyEditor.clickToVisit')}](${url.trim()})`);
    }
  },
};

// ====== 自定义命令：上传文件（视频/音频/其他） ======
const fileUploadCommand: ICommand = {
  name: 'file-upload',
  keyCommand: 'file-upload',
  buttonProps: { 'aria-label': i18n.t('policyEditor.uploadFile') },
  icon: (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <UploadIcon size={14} />
      <span style={{ fontSize: 12 }}>{i18n.t('policyEditor.uploadLabel')}</span>
    </span>
  ),
  execute: async (_state, api) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,audio/*,.pdf,.doc,.docx,.zip';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        const arrayBuffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

        const ext = file.name.split('.').pop() || 'bin';

        const { uploadUrl, storageKey } = await apiPost<{ uploadUrl: string | null; storageKey: string }>('/resources/presign', {
          body: {
            mimeType: file.type,
            ext,
            contentHash: hash,
            size: file.size,
            scope: 'public',
          },
        });

        if (uploadUrl) {
          const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type },
          });
          if (!uploadRes.ok) throw new Error('上传失败');
        }

        const resourceUrl = `/api/resources/file/${storageKey}`;
        const isVideo = file.type.startsWith('video/');
        if (isVideo) {
          api?.replaceSelection(`\n<video src="${resourceUrl}" controls width="100%"></video>\n`);
        } else {
          api?.replaceSelection(`[${file.name}](${resourceUrl})`);
        }
      } catch (err) {
        message.error(i18n.t('errors.ASSET_UPLOAD_FAILED'));
      }
    };
    input.click();
  },
};

export function PolicyMdEditor({
  value,
  onChange,
  height = 500,
  readonly = false,
}: PolicyMdEditorProps) {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  const handleChange = useCallback(
    (val?: string) => {
      onChange(val || '');
    },
    [onChange],
  );

  // 自定义工具栏：保留基础编辑命令 + 自定义命令
  const extraCommands: ICommand[] = [
    imageUploadCommand,
    videoInsertCommand,
    linkInsertCommand,
    fileUploadCommand,
  ];

  return (
    <div data-color-mode={isDark ? 'dark' : 'light'} style={{ borderRadius: 8, overflow: 'hidden' }}>
      <MDEditor
        value={value}
        onChange={handleChange}
        height={height}
        preview={readonly ? 'preview' : 'live'}
        visibleDragbar={false}
        commands={[
          commands.bold,
          commands.italic,
          commands.strikethrough,
          commands.hr,
          commands.divider,
          commands.title1,
          commands.title2,
          commands.title3,
          commands.title4,
          commands.divider,
          commands.orderedListCommand,
          commands.unorderedListCommand,
          commands.quote,
          commands.codeBlock,
          commands.code,
          commands.divider,
          commands.table,
        ]}
        extraCommands={extraCommands}
      />
    </div>
  );
}