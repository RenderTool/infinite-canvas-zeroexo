/**
 * ScriptViewer - 剧本预览组件（MD 美化格式）
 */
import { useTheme } from '@zeroexo/plugin-theme';

interface ScriptViewerProps {
  content: string;
}

export function ScriptViewer({ content }: ScriptViewerProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const bgCard = isDark ? '#1a1715' : '#f5f2ec';

  const lines = content.split('\n');

  return (
    <div style={{
      padding: 16, borderRadius: 10, background: bgCard,
      maxHeight: 400, overflow: 'auto', fontFamily: "'Courier New', monospace",
      fontSize: 12, lineHeight: 1.7, textAlign: 'left',
    }}>
      {lines.map((line, i) => {
        let color = 'inherit';
        let fontWeight: number | undefined;
        let fontSize: number | undefined;
        let textTransform: 'uppercase' | undefined;

        if (line.startsWith('# ')) {
          color = accent;
          fontWeight = 700;
          fontSize = 15;
        } else if (line.startsWith('## ')) {
          color = '#3b82f6';
          fontWeight = 600;
          fontSize = 13;
        } else if (line.startsWith('**')) {
          color = '#8b5cf6';
          fontWeight = 600;
        } else if (line.startsWith('△') || line.startsWith('Action:')) {
          color = '#10b981';
        } else if (line === line.toUpperCase() && line.length > 2 && line.length < 30) {
          color = '#ef4444';
          textTransform = 'uppercase';
        }

        return (
          <div key={i} style={{ color: color || theme.toolbar.text, fontWeight, fontSize, textTransform, padding: '1px 0' }}>
            {line || '\u00A0'}
          </div>
        );
      })}
    </div>
  );
}