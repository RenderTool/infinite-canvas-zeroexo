/**
 * group-style-preferences - 组样式偏好本地缓存(仅 localStorage,不云同步)
 *
 * 记录用户上一次应用的样式值,下次打开弹窗时自动回填作为默认值。
 */

const STORAGE_KEY = 'zeroexo:lastGroupStyle';

export interface LastGroupStyle {
  color?: string;
  opacity?: number;
  radius?: number;
}

function read(): LastGroupStyle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LastGroupStyle;
  } catch {
    return {};
  }
}

function write(prefs: LastGroupStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage 不可用时静默失败
  }
}

/** 获取上一次保存的样式值 */
export function getLastGroupStyle(): LastGroupStyle {
  return read();
}

/** 保存样式值(合并到已有值,只覆盖传入的字段) */
export function saveLastGroupStyle(params: LastGroupStyle): LastGroupStyle {
  const current = read();
  const next: LastGroupStyle = { ...current };
  if (params.color !== undefined) next.color = params.color;
  if (params.opacity !== undefined) next.opacity = params.opacity;
  if (params.radius !== undefined) next.radius = params.radius;
  write(next);
  return next;
}

/** 清空所有偏好 */
export function clearLastGroupStyle(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
