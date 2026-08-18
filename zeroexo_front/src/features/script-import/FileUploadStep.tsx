/**
 * FileUploadStep - 文件上传步骤
 */
import { useState, useCallback, useRef } from 'react';
import { Upload, FileText, Check, AlertCircle } from 'lucide-react';
import { App } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import type { ImportFileInfo } from './types.js';

interface FileUploadStepProps {
  onComplete: (files: ImportFileInfo[], mergedContent: string) => void;
}

export function FileUploadStep({ onComplete }: FileUploadStepProps): React.ReactElement {
  const { theme } = useTheme();
  const { message } = App.useApp();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ImportFileInfo[]>([]);
  const [isParsing, setIsParsing] = useState(false);

  const parseFile = useCallback(async (file: File): Promise<ImportFileInfo> => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const fileType = (ext === 'docx' ? 'docx' : ext === 'md' ? 'md' : 'txt') as 'txt' | 'docx' | 'md';
    
    if (fileType === 'docx') {
      return { name: file.name, size: file.size, type: 'docx', content: `[DOCX 文件: ${file.name} - 请使用 .txt 或 .md 格式以获得最佳兼容性]`, status: 'done' as const };
    }

    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsText(file);
      });
      return { name: file.name, size: file.size, type: fileType, content: text, status: 'done' as const };
    } catch {
      return { name: file.name, size: file.size, type: fileType, content: '', status: 'error' as const, error: '读取失败' };
    }
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;

    setIsParsing(true);
    const newFiles: ImportFileInfo[] = selected.map(f => ({
      name: f.name, size: f.size, type: 'txt' as const, content: '', status: 'parsing' as const,
    }));
    setFiles(prev => [...prev, ...newFiles]);

    const parsed = await Promise.all(selected.map(parseFile));
    const updatedFiles = [...files.filter(f => f.status !== 'parsing'), ...parsed];
    setFiles(updatedFiles);
    setIsParsing(false);

    // Check if all done
    const allDone = updatedFiles.every(f => f.status === 'done');
    if (allDone && updatedFiles.length > 0) {
      const merged = updatedFiles.map(f => `--- ${f.name} ---\n${f.content}`).join('\n\n');
      // Small delay to let user see the completion
      setTimeout(() => onComplete(updatedFiles, merged), 800);
    }
  }, [files, parseFile, onComplete]);

  const handleRetry = useCallback(async (_fileName: string) => {
    // Re-trigger file selection and re-parse specific file
    message.info('请重新选择文件');
  }, [message]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0 && fileInputRef.current) {
      fileInputRef.current.files = e.dataTransfer.files;
      const event = new Event('change', { bubbles: true });
      fileInputRef.current.dispatchEvent(event);
    }
  }, []);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>上传文件</div>
      <div style={{ fontSize: 12, color: textMuted, marginBottom: 20 }}>支持 .txt .docx .md 格式，可同时选择多个文件</div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${border}`, borderRadius: 12, padding: '32px 20px',
          background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
          cursor: 'pointer', marginBottom: 16, transition: 'all .2s',
        }}
      >
        <Upload size={32} style={{ color: accent, marginBottom: 8 }} />
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>点击或拖拽文件到此处</div>
        <div style={{ fontSize: 11, color: textMuted }}>.txt · .docx · .md</div>
        <input ref={fileInputRef} type="file" accept=".txt,.docx,.md" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div style={{ textAlign: 'left', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: textMuted, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>已选择 {files.length} 个文件</span>
            <span>总大小: {(totalSize / 1024).toFixed(1)} KB</span>
          </div>
          {files.map((f, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              borderRadius: 8, marginBottom: 4, background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            }}>
              <span style={{ fontSize: 9, color: textMuted, padding: '2px 6px', borderRadius: 4, border: `1px solid ${border}`, fontWeight: 600 }}>{f.type.toUpperCase()}</span>
              <FileText size={14} style={{ color: textMuted, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span style={{ fontSize: 10, color: textMuted }}>{(f.size / 1024).toFixed(1)} KB</span>
              {f.status === 'parsing' && <span style={{ fontSize: 10, color: accent }}>解析中...</span>}
              {f.status === 'done' && <Check size={14} style={{ color: '#10b981' }} />}
              {f.status === 'error' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertCircle size={14} style={{ color: '#ef4444' }} />
                  <button type="button" onClick={() => handleRetry(f.name)} style={{ fontSize: 10, color: accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>重试</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {isParsing && <div style={{ fontSize: 12, color: accent, marginBottom: 12 }}>正在解析文件...</div>}
    </div>
  );
}