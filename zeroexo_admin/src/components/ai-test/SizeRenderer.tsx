/**
 * SizeRenderer — 尺寸参数渲染器 + useSizePanel hook
 *
 * 处理 resolution / aspectRatio / size 三个参数的联动逻辑：
 *   1. aspectRatio==='auto' → size 禁用 + 清空 + 占位提示
 *   2. aspectRatio!=='auto' + resolution → 自动计算 size 并填充
 *   3. 尺寸框中间有锁定比例按钮，开启后修改任一边自动约束另一边
 *   4. 尺寸超出模型约束时弹出警告
 *
 * 尺寸→宽高比/分辨率的清除逻辑在 ImageWorkbench useEffect 中处理。
 */
import { useCallback, useState, useMemo } from 'react';
import { InputNumber, Tooltip } from 'antd';
import { Link, Unlink } from 'lucide-react';
import type { ParamRenderer, ChannelConstraints } from './param-types';

// ─── 尺寸联动工具 ──────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** 分辨率字符串 → 像素值 */
export function resolvePixels(resolution: string, fallback: number): number {
  const map: Record<string, number> = { '512': 512, '1k': 1024, '2k': 2048, '3k': 3072, '4k': 4096 };
  return map[resolution.toLowerCase()] ?? fallback;
}

/**
 * 火山引擎 API 官方尺寸映射表（方式 1：指定分辨率档位）
 * 来源：https://www.volcengine.com/docs/6791/1397048
 * 仅覆盖 API 文档中定义的 1K/2K 分辨率 + 标准宽高比组合。
 * 查表优先，未命中时回退数学计算。
 */
const VOLCENGINE_SIZE_MAP: Record<string, Record<string, { width: number; height: number }>> = {
  '1k': {
    '1:1': { width: 1024, height: 1024 },
    '4:3': { width: 1152, height: 864 },
    '3:4': { width: 864, height: 1152 },
    '16:9': { width: 1424, height: 800 },
    '9:16': { width: 800, height: 1424 },
    '3:2': { width: 1248, height: 832 },
    '2:3': { width: 832, height: 1248 },
    '21:9': { width: 1568, height: 672 },
  },
  '2k': {
    '1:1': { width: 2048, height: 2048 },
    '4:3': { width: 2368, height: 1776 },
    '3:4': { width: 1776, height: 2368 },
    '16:9': { width: 2816, height: 1584 },
    '9:16': { width: 1584, height: 2816 },
    '3:2': { width: 2496, height: 1664 },
    '2:3': { width: 1664, height: 2496 },
    '21:9': { width: 3136, height: 1344 },
  },
};

/**
 * 从分辨率 + 宽高比计算实际像素尺寸，确保满足像素约束。
 *
 * 查表逻辑：
 *   1. 优先查火山引擎官方尺寸映射表（1K/2K + 标准宽高比）
 *   2. 表中无匹配时，使用数学计算（3K/4K 或非标准宽高比）
 *   3. 最终结果始终满足 minTotalPixels 约束（默认 921600）
 */
export function computeSizePreset(
  resolution: string,
  aspectRatio: string,
  bounds?: ChannelConstraints['bounds'],
): { width: number; height: number } {
  const res = resolution.toLowerCase();

  // 1. 查火山引擎官方尺寸映射表（1K/2K + 标准宽高比）
  const resMap = VOLCENGINE_SIZE_MAP[res];
  if (resMap?.[aspectRatio]) {
    return { ...resMap[aspectRatio] };
  }

  // 2. 表中无匹配：使用数学计算（如 3K/4K 或非标准宽高比）
  const [rw, rh] = aspectRatio.split(':').map(Number);
  if (!rw || !rh) return { width: 1024, height: 1024 };

  // 解析分辨率像素值，并受 maxEdgeLength 裁切（与后端 calculateDimensions 保持一致）
  const rawEdge = resolvePixels(res, bounds?.maxEdgeLength || 1024);
  const maxEdge = bounds?.maxEdgeLength ? Math.min(rawEdge, bounds.maxEdgeLength) : rawEdge;
  let w = rw >= rh ? maxEdge : Math.round((maxEdge * rw) / rh);
  let h = rh >= rw ? maxEdge : Math.round((maxEdge * rh) / rw);

  const minPixels = bounds?.minTotalPixels ?? 921600;
  if (w * h < minPixels) {
    const scale = Math.sqrt(minPixels / (w * h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    // 放大后若超出 maxEdge，尝试以 maxEdge 回退计算
    if (w > maxEdge || h > maxEdge) {
      const ratio = rw / rh;
      let newW: number, newH: number;
      if (ratio >= 1) {
        newW = maxEdge;
        newH = Math.round(maxEdge / ratio);
      } else {
        newH = maxEdge;
        newW = Math.round(maxEdge * ratio);
      }
      // 仅当回退后仍满足 minPixels 时才采用回退值，否则保留放大后溢出值
      if (newW * newH >= minPixels) {
        w = newW;
        h = newH;
      }
    }
  }

  const maxPixels = bounds?.maxTotalPixels;
  if (maxPixels && w * h > maxPixels) {
    const scale = Math.sqrt(maxPixels / (w * h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  return { width: w, height: h };
}

/** 宽高 → 宽高比字符串 (如 "16:9") */
export function formatAspectRatio(w: number, h: number): string {
  if (w <= 0 || h <= 0) return '';
  const divisor = gcd(w, h);
  return `${Math.round(w / divisor)}:${Math.round(h / divisor)}`;
}

// ─── useSizePanel Hook ─────────────────────────────────────────────────

interface UseSizePanelParams {
  values: Record<string, any>;
  onChange: (name: string, value: any) => void;
  constraints?: ChannelConstraints;
}

export function useSizePanel({ values, onChange, constraints }: UseSizePanelParams) {
  const isAuto = values['aspectRatio'] === 'auto';

  const handleResolutionChange = useCallback(
    (val: string) => {
      if (isAuto) return;
      const aspectRatio = values['aspectRatio'];
      if (aspectRatio && aspectRatio !== 'auto') {
        const { width: w, height: h } = computeSizePreset(val, aspectRatio, constraints?.bounds);
        const cur = values['size'];
        const curW = cur?.width;
        const curH = cur?.height;
        if (curW !== w || curH !== h) {
          onChange('size', { width: w, height: h });
        }
      }
    },
    [isAuto, values, onChange, constraints],
  );

  const handleAspectRatioChange = useCallback(
    (val: string) => {
      if (val === 'auto') {
        onChange('size', { width: 0, height: 0 });
        return;
      }
      const resolution = values['resolution'];
      if (resolution) {
        const { width: w, height: h } = computeSizePreset(resolution, val, constraints?.bounds);
        const cur = values['size'];
        const curW = cur?.width;
        const curH = cur?.height;
        if (curW !== w || curH !== h) {
          onChange('size', { width: w, height: h });
        }
      }
    },
    [values, onChange, constraints],
  );

  const handleSizeChange = useCallback(
    (size: { width: number; height: number }) => {
      onChange('size', size);
    },
    [onChange],
  );

  return {
    isAuto,
    handleResolutionChange,
    handleAspectRatioChange,
    handleSizeChange,
  };
}

// ─── 约束校验工具 ──────────────────────────────────────────────────────

interface ConstraintWarnings {
  warnings: string[];
  hasError: boolean;
}

function checkSizeConstraints(
  size: { width: number; height: number },
  bounds: ChannelConstraints['bounds'] | undefined,
): ConstraintWarnings {
  const warnings: string[] = [];
  if (!bounds) return { warnings, hasError: false };
  const { width, height } = size;
  if (width <= 0 || height <= 0) return { warnings, hasError: false };
  const pixelCount = width * height;

  const minPx = bounds.minTotalPixels;
  if (minPx && pixelCount < minPx) {
    warnings.push(`不满足最小像素限制（${minPx.toLocaleString()} 像素）`);
  }

  const maxPx = bounds.maxTotalPixels;
  if (maxPx && pixelCount > maxPx) {
    warnings.push(`超出最大像素限制（${maxPx.toLocaleString()} 像素）`);
  }

  const maxEdge = bounds.maxEdgeLength;
  if (maxEdge && Math.max(width, height) > maxEdge) {
    warnings.push(`最长边超出限制（${maxEdge}px）`);
  }

  return { warnings, hasError: warnings.length > 0 };
}

// ─── SizeRenderer ──────────────────────────────────────────────────────

/** 尺寸参数渲染器（宽×高双输入框 + 联动 + 约束校验 + 锁定比例） */
export const SizeRenderer: ParamRenderer = ({ param, value, onChange, constraints, allValues }) => {
  const { isAuto, handleSizeChange } = useSizePanel({
    values: allValues ?? {},
    onChange,
    constraints,
  });

  const rawSize = value && typeof value === 'object' && 'width' in value
    ? value as { width: number; height: number }
    : { width: 1024, height: 1024 };

  // ── 锁定比例状态 ──
  const [aspectLocked, setAspectLocked] = useState(false);

  // ── 约束校验 ──
  const { warnings, hasError } = useMemo(
    () => checkSizeConstraints(rawSize, constraints?.bounds),
    [rawSize, constraints?.bounds],
  );

  // 当前宽高比（用于锁定比例计算）
  const currentAspect = useMemo(() => {
    if (rawSize.width > 0 && rawSize.height > 0) {
      return rawSize.width / rawSize.height;
    }
    return 1;
  }, [rawSize.width, rawSize.height]);

  // ── 锁定比例处理 ──
  const handleWidthChange = useCallback(
    (w: number | null) => {
      const width = w ?? 0;
      if (aspectLocked && width > 0 && rawSize.height > 0) {
        const newHeight = Math.round(width / currentAspect);
        handleSizeChange({ width, height: newHeight });
      } else {
        handleSizeChange({ width, height: rawSize.height });
      }
    },
    [aspectLocked, rawSize.height, currentAspect, handleSizeChange],
  );

  const handleHeightChange = useCallback(
    (h: number | null) => {
      const height = h ?? 0;
      if (aspectLocked && height > 0 && rawSize.width > 0) {
        const newWidth = Math.round(height * currentAspect);
        handleSizeChange({ width: newWidth, height });
      } else {
        handleSizeChange({ width: rawSize.width, height });
      }
    },
    [aspectLocked, rawSize.width, currentAspect, handleSizeChange],
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <InputNumber
          value={rawSize.width}
          onChange={handleWidthChange}
          min={param.min}
          max={param.max}
          placeholder="宽度"
          size="small"
          disabled={isAuto}
          style={{ width: '42%' }}
        />
        {/* 锁定比例按钮 */}
        <Tooltip title={aspectLocked ? '取消锁定宽高比' : '锁定宽高比'}>
          <span
            onClick={() => setAspectLocked(!aspectLocked)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              cursor: aspectLocked ? 'pointer' : 'pointer',
              color: aspectLocked ? '#1677ff' : '#bfbfbf',
              borderRadius: 4,
              transition: 'all 0.15s',
              flexShrink: 0,
            }}
          >
            {aspectLocked ? <Link size={14} /> : <Unlink size={14} />}
          </span>
        </Tooltip>
        <InputNumber
          value={rawSize.height}
          onChange={handleHeightChange}
          min={param.min}
          max={param.max}
          placeholder="高度"
          size="small"
          disabled={isAuto}
          style={{ width: '42%' }}
        />
      </div>

      {/* 约束警告 */}
      {hasError && !isAuto && (
        <div style={{ fontSize: 11, color: '#ff4d4f', marginTop: 4, lineHeight: 1.5 }}>
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {/* 约束提示 */}
      {constraints?.bounds && !isAuto && !hasError && (
        <div style={{ fontSize: 10, color: '#bfbfbf', marginTop: 2 }}>
          最长边 ≤ {constraints.bounds.maxEdgeLength ?? 4096}px
          {constraints.bounds.minTotalPixels && ` · 最少 ${Math.round(constraints.bounds.minTotalPixels / 1024 / 1024 * 10) / 10}MP`}
        </div>
      )}

      {/* 智能模式提示 */}
      {isAuto && (
        <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
          AUTO 模式下由分辨率档位和宽高比自动计算尺寸
        </div>
      )}
    </div>
  );
};
