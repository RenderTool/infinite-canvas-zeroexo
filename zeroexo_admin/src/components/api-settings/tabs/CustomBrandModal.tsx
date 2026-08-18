/**
 * CustomBrandModal - 自定义品牌创建弹窗
 *
 * 包含品牌名称、Base URL、API 格式、品牌图标、能力标签等表单字段。
 * 表单实例由本组件持有，通过 forwardRef 暴露 setFieldsValue / resetFields，
 * 以便父组件在「应用模板」时回填表单，或在打开弹窗前重置表单。
 *
 * 提交流程：
 *   1. 内部调用 form.validateFields() 校验
 *   2. 校验通过后调用父组件传入的 onSubmit(values)
 *   3. onSubmit 成功（未抛出异常）后重置表单并关闭弹窗
 *   4. 任意异常（校验错误或 API 错误）均保持弹窗打开
 */
import { forwardRef, useImperativeHandle } from 'react';
import { Modal, Form, Input, Select, Button, Space } from 'antd';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BRAND_ICONS } from '../brand-icons';
import type { BrandPreset } from './api-providers-types';

/** 父组件可通过 ref 调用的表单方法 */
export interface CustomBrandModalRef {
  /** 回填表单字段（用于应用模板） */
  setFieldsValue: (fields: Record<string, any>) => void;
  /** 重置表单 */
  resetFields: () => void;
}

export interface CustomBrandModalProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 关闭弹窗回调 */
  onClose: () => void;
  /** 提交回调：接收表单值，抛出异常则保持弹窗打开 */
  onSubmit: (values: any) => Promise<void>;
  /** 提交中（按钮 loading 态） */
  submitting: boolean;
  /** 预设品牌列表（保留以兼容未来扩展，当前表单未直接使用） */
  presets: BrandPreset[];
  /** 打开模板管理弹窗回调（footer 中的「模板」按钮触发） */
  onOpenTemplate?: () => void;
}

const CustomBrandModal = forwardRef<CustomBrandModalRef, CustomBrandModalProps>(
  function CustomBrandModal({ open, onClose, onSubmit, submitting, presets, onOpenTemplate }, ref) {
    const { t } = useTranslation();
    const [form] = Form.useForm();

    // 暴露表单方法给父组件，用于应用模板时回填字段
    useImperativeHandle(ref, () => ({
      setFieldsValue: (fields: Record<string, any>) => form.setFieldsValue(fields),
      resetFields: () => form.resetFields(),
    }));

    // 提交：先校验表单，再调用父组件 onSubmit；成功后重置表单并关闭
    const handleSubmit = async () => {
      try {
        const values = await form.validateFields();
        await onSubmit(values);
        // onSubmit 成功：重置表单并关闭弹窗
        form.resetFields();
        onClose();
      } catch {
        // 校验错误由 Form.Item 自动展示；API 错误由父组件 onSubmit 处理
        // 保持弹窗打开，与原内联实现的行为一致
      }
    };

    // 预设参数当前未直接参与表单渲染，保留以便未来扩展（如选择预设自动填充）
    void presets;

    return (
      <Modal
        title={t('ai.addCustomBrand')}
        open={open}
        centered
        onCancel={onClose}
        onOk={handleSubmit}
        confirmLoading={submitting}
        footer={[
          <Button key="template" icon={<FileText size={14} />} onClick={() => onOpenTemplate?.()}>
            {t('ai.template')}
          </Button>,
          <Button key="cancel" onClick={onClose}>
            {t('common.cancel')}
          </Button>,
          <Button key="submit" type="primary" onClick={handleSubmit} loading={submitting}>
            {t('common.confirm')}
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('ai.brandName')}
            rules={[{ required: true, message: t('ai.enterBrandName') }]}
          >
            <Input placeholder={t('ai.exampleBrand')} />
          </Form.Item>
          <Form.Item name="baseUrl" label="Base URL">
            <Input placeholder={t('ai.defaultUrl')} />
          </Form.Item>
          <Form.Item name="apiFormat" label="API 格式">
            <Select
              options={[
                { value: 'openai', label: 'OpenAI 兼容' },
                { value: 'anthropic', label: 'Anthropic' },
                { value: 'gemini', label: 'Google Gemini' },
              ]}
              defaultValue="openai"
            />
          </Form.Item>
          <Form.Item name="logoProvider" label={t('ai.brandIcon')}>
            <Select
              placeholder={t('ai.selectIcon')}
              onChange={(value) => {
                form.setFieldValue('logoProvider', value);
              }}
              options={Object.keys(BRAND_ICONS).map((key) => ({
                value: key,
                label: (
                  <Space size={4}>
                    {(() => {
                      const Icon = BRAND_ICONS[key];
                      return <Icon size={16} />;
                    })()}
                    <span>{key}</span>
                  </Space>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="capabilities"
            label={t('ai.tags')}
            tooltip={t('ai.selectModelType')}
            rules={[{ required: true, message: t('ai.selectAtLeastOne') }]}
          >
            <Select
              mode="multiple"
              placeholder={t('ai.selectTags')}
              options={[
                { value: 'llm', label: t('ai.type.llm') },
                { value: 'image', label: t('ai.type.image') },
                { value: 'video', label: t('ai.type.video') },
                { value: 'audio', label: t('ai.type.audio') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    );
  },
);

export default CustomBrandModal;
