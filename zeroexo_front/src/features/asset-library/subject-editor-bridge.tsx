/**
 * SubjectEditorBridge - 资产库主体 ↔ 画布主体编辑器适配桥（Plan#20 重设计 v2）
 *
 * 主页资产库的「新建/编辑主体」入口统一切换到 SubjectEditorModal（唯一主体编辑页）。
 * 本桥负责两套数据模型的转换：
 * - 后端 Subject（subjects-api）⇄ 画布 SubjectCardData（SubjectEditorModal 消费）
 * - 加载：Subject → SubjectCardData（imageKeys → 单状态 images）
 * - 关闭时持久化：SubjectCardData → updateSubject/createSubject（拍平全部状态图片）
 *
 * 注意：多状态语义在后端 Subject 模型落地前为有损映射（状态拍平为图片列表）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Spin, App as AntdApp } from 'antd';
import { useTranslation } from 'react-i18next';
import type { SubjectCardData, SubjectState } from '@/features/canvas-nodes/storyboard/storyboard-types';
import { SubjectEditorModal } from '@/features/canvas-nodes/subject/SubjectEditorModal';
import {
  getSubject, createSubject, updateSubject,
  type Subject, type SubjectType,
} from './subjects-api.js';

export interface SubjectEditorBridgeProps {
  /** 编辑既有主体；缺省为新建 */
  subjectId?: string;
  onBack: () => void;
  onSaved: () => void;
}

/** 后端 Subject → SubjectCardData */
function toCardData(s: Subject): SubjectCardData {
  const state: SubjectState = {
    id: 'state-default',
    name: '默认',
    images: (s.imageKeys ?? []).map((k) => ({ storageKey: k })),
    note: '',
  };
  return {
    name: s.name,
    kind: s.type,
    consistency: s.consistency ?? '',
    aliases: s.aliases ? s.aliases.split(',').map((x) => x.trim()).filter(Boolean) : [],
    coverKey: s.avatarKey,
    states: [state],
    activeStateId: 'state-default',
    audio: [],
    episodeIds: [],
    assetSubjectId: s.id,
  };
}

/** 新建时的空数据 */
function toEmptyCardData(): SubjectCardData {
  return {
    name: '',
    kind: 'character',
    consistency: '',
    aliases: [],
    coverKey: null,
    states: [{ id: 'state-default', name: '默认', images: [], note: '' }],
    activeStateId: 'state-default',
    audio: [],
    episodeIds: [],
    assetSubjectId: null,
  };
}

export function SubjectEditorBridge({ subjectId, onBack, onSaved }: SubjectEditorBridgeProps): React.ReactElement {
  const { t } = useTranslation();
  const { message: antdMessage } = AntdApp.useApp();
  const [loading, setLoading] = useState(!!subjectId);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<SubjectCardData | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);

  // 加载主体
  useEffect(() => {
    if (!subjectId) {
      setData(toEmptyCardData());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await getSubject(subjectId);
        if (cancelled) return;
        setSubject(s);
        setData(toCardData(s));
      } catch (err) {
        if (!cancelled) antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [subjectId, antdMessage, t]);

  // 关闭（= 保存退出）：SubjectCardData → 后端 Subject
  const handleClose = useCallback(async () => {
    if (!data || saving) { onBack(); return; }
    setSaving(true);
    try {
      const allImageKeys = data.states.flatMap((s) => s.images.map((i) => i.storageKey));
      const payload = {
        type: data.kind as SubjectType,
        name: data.name.trim() || t('subject.untitled'),
        aliases: data.aliases.join(','),
        description: data.consistency,
        consistency: data.consistency,
        avatarKey: data.coverKey,
        imageKeys: allImageKeys,
      };
      if (subjectId && subject) {
        await updateSubject(subjectId, payload);
      } else {
        await createSubject(payload);
      }
      antdMessage.success(t('subjectCreate.savedToast'));
      onSaved();
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [data, saving, subjectId, subject, antdMessage, t, onBack, onSaved]);

  if (loading || !data) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <SubjectEditorModal
      open
      onClose={() => void handleClose()}
      data={data}
      onDataChange={setData}
    />
  );
}
