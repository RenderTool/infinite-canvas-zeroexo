/**
 * AssetLibraryModal - 资产库 Modal（画布中使用）
 *
 * 将 AssetLibraryPage 包裹在 antd Modal 中，新增"发送到画布"功能。
 * 素材支持发送到画布，提示词预留接口暂不启用。
 */

import { useCallback } from 'react';
import { Modal } from 'antd';
import { AssetLibraryPage } from './asset-library-page.js';

interface AssetLibraryModalProps {
  open: boolean;
  onClose: () => void;
  onSendToCanvas: (item: {
    type: 'asset' | 'prompt' | 'script';
    id: string;
    data: any;
  }) => void;
}

export function AssetLibraryModal({
  open,
  onClose,
  onSendToCanvas,
}: AssetLibraryModalProps): React.ReactElement {

  const handleSendToCanvas = useCallback(
    (item: { type: 'asset' | 'prompt' | 'script'; id: string; data: any }) => {
      onSendToCanvas(item);
      onClose();
    },
    [onSendToCanvas, onClose],
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1280}
      centered
      styles={{
        body: {
          padding: 0,
          height: '80vh',
          overflow: 'hidden',
        },
      }}
      style={{ maxWidth: 'calc(100vw - 32px)' }}
    >
      <AssetLibraryPage
        onSendToCanvas={handleSendToCanvas}
        sidebarRadius={12}
      />
    </Modal>
  );
}