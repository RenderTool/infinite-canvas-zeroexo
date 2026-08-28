/**
 * SearchButton - 点击展开/失焦收缩的搜索按钮
 *
 * 初始显示为搜索图标按钮，点击后展开为 240px 的 Input 输入框，
 * 失焦后自动恢复为图标按钮。
 */
import { useState, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';
import { Button, Input } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';

interface SearchButtonProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  theme: ThemeConfig;
}

export function SearchButton({ value, onChange, placeholder, theme: _theme }: SearchButtonProps) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleExpand = useCallback(() => {
    setExpanded(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const handleBlur = useCallback(() => {
    blurTimerRef.current = setTimeout(() => {
      setExpanded(false);
    }, 200);
  }, []);

  const handleFocus = useCallback(() => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
    }
  }, []);

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {expanded ? (
        <Input
          ref={inputRef as any}
          size="small"
          prefix={<Search size={14} style={{ opacity: 0.5 }} />}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 240 }}
          allowClear
          onBlur={handleBlur}
          onFocus={handleFocus}
        />
      ) : (
        <Button
          size="small"
          icon={<Search size={14} />}
          onClick={handleExpand}
        />
      )}
    </div>
  );
}

export default SearchButton;