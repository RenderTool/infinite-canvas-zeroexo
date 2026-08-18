/**
 * ParamForm — 装配模式主渲染组件
 *
 * 遍历 ParameterDef[] 数组，通过 registry 找到对应渲染器并渲染。
 * 支持 filterNames 过滤只渲染指定的参数。
 */
import React, { useMemo } from 'react';
import { Row, Col, Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import type { ParameterDef, ChannelConstraints } from './param-types';
import { ParamRendererRegistry } from './ParamRendererRegistry';

interface ParamFormProps {
  /** 参数定义列表 */
  parameters: ParameterDef[];
  /** 当前值 */
  values: Record<string, any>;
  /** 值变更回调 */
  onChange: (values: Record<string, any>) => void;
  /** 渠道约束 */
  constraints?: ChannelConstraints;
  /** 渲染器注册表 */
  registry: ParamRendererRegistry;
  /** 可选：只渲染指定参数 */
  filterNames?: string[];
  /** 渲染器排列方向 */
  layout?: 'vertical' | 'horizontal';
  /** 自定义渲染器包裹样式 */
  itemStyle?: React.CSSProperties;
  /** 是否为渠道参数配置弹窗的 Schema 行模式（显示标题+开关，默认 false） */
  schemaRowMode?: boolean;
  /** schemaRowMode 下，已启用的参数名列表 */
  enabledParams?: string[];
  /** schemaRowMode 下，切换参数启用的回调 */
  onToggleParam?: (name: string, enabled: boolean) => void;
  /** schemaRowMode 下，覆盖默认值的回调 */
  onOverrideDefault?: (name: string, value: any) => void;
}

/** 参数标签渲染 */
function renderLabel(param: ParameterDef): React.ReactNode {
  return (
    <span style={{ fontSize: 12, fontWeight: 500, color: '#454545' }}>
      {param.label}
      {param.tooltip && (
        <Tooltip title={param.tooltip}>
          <InfoCircleOutlined
            style={{ fontSize: 11, color: '#d9d9d9', cursor: 'help', marginLeft: 4 }}
          />
        </Tooltip>
      )}
    </span>
  );
}

export default function ParamForm({
  parameters,
  values,
  onChange,
  constraints,
  registry,
  filterNames,
  itemStyle,
  schemaRowMode = false,
  enabledParams,
  onToggleParam,
  onOverrideDefault,
}: ParamFormProps) {
  const params = filterNames
    ? parameters.filter((p) => filterNames.includes(p.name))
    : parameters;

  /** 宽高比可选值，供 SizeRenderer 联动使用 */
  const aspectOptions = useMemo(() => {
    const ar = params.find((p) => p.name === 'aspectRatio');
    return ar?.values?.filter((v) => v !== 'auto');
  }, [params]);

  const handleFieldChange = (name: string, value: any) => {
    onChange({ ...values, [name]: value });
  };

  return (
    <Row gutter={[0, 12]}>
      {params.map((param) => {
        const Renderer = registry.resolve(param.type);
        const value = values[param.name] ?? param.default;

        // Schema 行模式：显示标题 + 启用开关 + 默认值编辑器
        if (schemaRowMode) {
          const enabled = enabledParams?.includes(param.name) ?? true;
          return (
            <Col xs={24} key={param.name}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '7px 10px',
                  border: `1px solid ${enabled ? '#d9d9d9' : '#f0f0f0'}`,
                  borderRadius: 6,
                  background: enabled ? '#fff' : '#fafafa',
                  gap: 8,
                  ...itemStyle,
                }}
              >
                {/* 启用开关 */}
                <div
                  onClick={() => onToggleParam?.(param.name, !enabled)}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    border: `2px solid ${enabled ? '#1677ff' : '#d9d9d9'}`,
                    background: enabled ? '#1677ff' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'all 0.15s',
                  }}
                >
                  {enabled && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                {renderLabel(param)}
                {enabled && (
                  <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>
                    <Renderer
                      param={param}
                      value={value}
                      onChange={(name, val) => onOverrideDefault?.(name, val)}
                      constraints={constraints}
                      allValues={values}
                      aspectOptions={aspectOptions}
                    />
                  </div>
                )}
              </div>
            </Col>
          );
        }

        // 普通模式：直接从 registry 渲染
        return (
          <Col xs={24} key={param.name} style={itemStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {renderLabel(param)}
              <Renderer
                param={param}
                value={value}
                onChange={handleFieldChange}
                constraints={constraints}
                allValues={values}
                aspectOptions={aspectOptions}
              />
            </div>
          </Col>
        );
      })}
    </Row>
  );
}
