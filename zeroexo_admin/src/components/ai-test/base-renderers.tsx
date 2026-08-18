/**
 * base-renderers — 基础参数渲染器组件
 *
 * 每个渲染器是一个纯粹的 React FC，消费 ParameterDef 并渲染对应控件。
 * 所有渲染器通过 ParamRendererRegistry 注册后供 ParamForm 使用。
 */
import React from "react";
import {
  Select,
  InputNumber,
  Switch,
  Button,
  Upload,
  Input,
  Tooltip,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { ParamRenderer } from "./param-types";
import { setDefaultFallback } from "./ParamRendererRegistry";

// ─── 工具 ──────────────────────────────────────────────────────────────

/** 获取枚举参数的 label 显示值 */
function getEnumLabel(
  param: { name?: string; values?: string[]; labels?: Record<string, string> },
  value: string,
): string {
  if (param.labels?.[value]) return param.labels[value];
  // 自动派生：首字母大写
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** 判断枚举参数用 radio 还是 select（≤5 项用 radio，>5 项用 select） */
function getEnumDisplay(param: {
  values?: string[];
  display?: string;
}): "radio" | "select" {
  if (param.display === "radio" || param.display === "select")
    return param.display;
  return (param.values?.length ?? 0) <= 5 ? "radio" : "select";
}

// ─── EnumRenderer ──────────────────────────────────────────────────────

/** 枚举参数渲染器：display=radio → Button 组，display=select → Ant Select */
export const EnumRenderer: ParamRenderer = ({ param, value, onChange }) => {
  const display = getEnumDisplay(param);
  const currentValue = value ?? param.default;

  if (display === "radio") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(param.values ?? []).map((opt) => {
          const btn = (
            <Button
              key={opt}
              type={currentValue === opt ? "primary" : "default"}
              size="small"
              onClick={() => onChange(param.name, opt)}
              style={{ borderRadius: 6, padding: "2px 12px", fontSize: 12 }}
            >
              {getEnumLabel(param, opt)}
            </Button>
          );
          const tip = param.valueTooltips?.[opt];
          if (tip) {
            return (
              <Tooltip key={opt} title={tip}>
                {btn}
              </Tooltip>
            );
          }
          return btn;
        })}
      </div>
    );
  }

  return (
    <Select
      value={currentValue}
      onChange={(v) => onChange(param.name, v)}
      size="small"
      style={{ width: "100%" }}
      options={(param.values ?? []).map((v) => ({
        label: getEnumLabel(param, v),
        value: v,
      }))}
    />
  );
};

// ─── NumberRenderer ────────────────────────────────────────────────────

/** 数字参数渲染器 */
export const NumberRenderer: ParamRenderer = ({ param, value, onChange }) => {
  return (
    <InputNumber
      value={value ?? param.default}
      onChange={(v) => onChange(param.name, v)}
      min={param.min}
      max={param.max}
      step={param.step}
      placeholder={param.placeholder}
      size="small"
      style={{ width: "100%" }}
    />
  );
};

// ─── BooleanRenderer ───────────────────────────────────────────────────

/** 布尔参数渲染器（Switch 开关） */
export const BooleanRenderer: ParamRenderer = ({ param, value, onChange }) => {
  const checked = value ?? param.default ?? false;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Switch
        checked={!!checked}
        onChange={(v) => onChange(param.name, v)}
        size="small"
      />
      <span style={{ fontSize: 12, color: checked ? "#1677ff" : "#8c8c8c" }}>
        {checked ? "已启用" : "已关闭"}
      </span>
    </div>
  );
};

// ─── StringRenderer ────────────────────────────────────────────────────

/** 文本参数渲染器 */
export const StringRenderer: ParamRenderer = ({ param, value, onChange }) => {
  return (
    <Input.TextArea
      value={value ?? param.default ?? ""}
      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
        onChange(param.name, e.target.value)
      }
      placeholder={param.placeholder}
      allowClear
      autoSize={{ minRows: 2, maxRows: 6 }}
      size="small"
    />
  );
};

// ─── ImagesRenderer ────────────────────────────────────────────────────

/** 图片上传参数渲染器（参考图） */
export const ImagesRenderer: ParamRenderer = ({ param, value, onChange }) => {
  const maxCount = param.maxCount ?? 4;
  const fileList = Array.isArray(value) ? value : [];

  const handleChange = (info: any) => {
    const newList = info.fileList.map((f: any) => ({
      uid: f.uid,
      name: f.name,
      status: (f.status === "done" ? "done" : "error") as "done" | "error",
    }));
    onChange(param.name, newList);
  };

  return (
    <Upload.Dragger
      accept="image/*"
      multiple={maxCount > 1}
      fileList={fileList}
      onChange={handleChange}
      maxCount={maxCount}
      beforeUpload={() => false}
      style={{ borderRadius: 8, padding: 12 }}
    >
      <UploadOutlined
        style={{ fontSize: 20, color: "#bfbfbf", marginBottom: 4 }}
      />
      <p style={{ fontSize: 12, margin: 0, color: "#595959" }}>
        点击或拖拽上传参考图
      </p>
      <p style={{ fontSize: 11, color: "#bfbfbf", margin: "4px 0 0" }}>
        支持 JPG/PNG/WebP，最多 {maxCount} 张
      </p>
    </Upload.Dragger>
  );
};

// ─── FallbackRenderer ──────────────────────────────────────────────────

/** 兜底渲染器：未知类型回退到文本输入框 */
export const FallbackRenderer: ParamRenderer = ({ param, value, onChange }) => {
  return (
    <Input
      value={value ?? param.default ?? ""}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onChange(param.name, e.target.value)
      }
      placeholder={param.placeholder}
      size="small"
      style={{ width: "100%" }}
    />
  );
};

// ─── 注册默认渲染器兜底 ──────────────────────────────────────────────

setDefaultFallback(FallbackRenderer);
