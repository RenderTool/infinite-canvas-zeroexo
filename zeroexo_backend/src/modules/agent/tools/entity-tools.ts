/**
 * entity-tools — 主体/实体管理工具（storyboard_assistant 专用）
 *
 * 包含主体保存、合并、形象替换、衍生形象增删移。
 */

import { Logger } from '@nestjs/common';
import type { Tool, ToolContext } from './tool-types';

const toolLogger = new Logger('AgentTool');

/** save_entities - 三个类型分别传,全量替换对应数组 */
export function saveEntitiesV2(ctx: ToolContext): Tool {
  return {
    name: 'save_entities',
    description:
      '保存主体清单到项目 v2 数据。characters/props/scenes 三个数组分别传(可只传其中一个,其他保留)',
    parameters: {
      type: 'object',
      properties: {
        characters: { type: 'array', description: '角色数组(全量替换)', items: { type: 'object' } },
        props: { type: 'array', description: '道具数组(全量替换)', items: { type: 'object' } },
        scenes: { type: 'array', description: '场景数组(全量替换)', items: { type: 'object' } },
      },
    },
    execute: async (args: { characters?: any[]; props?: any[]; scenes?: any[] }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const episodes = current.episodes ?? [];
      const oldEntities = current.entities ?? { characters: [], props: [], scenes: [] };

      const nextEntities = {
        characters: Array.isArray(args.characters) ? args.characters : oldEntities.characters,
        props: Array.isArray(args.props) ? args.props : oldEntities.props,
        scenes: Array.isArray(args.scenes) ? args.scenes : oldEntities.scenes,
      };

      const nowIso = new Date().toISOString();
      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { storyboard: { ...current, schemaVersion: 2, episodes, entities: nextEntities, lastGeneratedAt: nowIso } },
      });

      return {
        success: true,
        characterCount: nextEntities.characters.length,
        propCount: nextEntities.props.length,
        sceneCount: nextEntities.scenes.length,
        message: `已保存主体:角色 ${nextEntities.characters.length}/道具 ${nextEntities.props.length}/场景 ${nextEntities.scenes.length}`,
      };
    },
  };
}

/** merge_entities - 合并两个主体(自动迁移所有 shot 引用) */
export function mergeEntities(ctx: ToolContext): Tool {
  return {
    name: 'merge_entities',
    description:
      '合并两个主体(source → target)。自动迁移所有 shot.entities 引用,合并 sameAs 列表,从对应数组中移除 source',
    parameters: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: '被合并的主体 ID(将被移除)' },
        targetId: { type: 'string', description: '保留的主体 ID(吸收 source)' },
      },
      required: ['sourceId', 'targetId'],
    },
    execute: async (args: { sourceId: string; targetId: string }) => {
      const { sourceId, targetId } = args;
      if (sourceId === targetId) {
        throw new Error('merge_entities 的 sourceId 与 targetId 不能相同');
      }

      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const entities = current.entities ?? { characters: [], props: [], scenes: [] };

      type Located = { idx: number; item: any; array: any[] };
      const findInArray = (arr: any[], id: string): Located | null => {
        const idx = arr.findIndex((e: any) => e?.id === id);
        return idx >= 0 ? { idx, item: arr[idx], array: arr } : null;
      };

      let targetLocation: Located | null = null;
      let sourceLocation: Located | null = null;
      for (const arr of [entities.characters, entities.props, entities.scenes]) {
        if (!targetLocation) targetLocation = findInArray(arr, targetId);
        if (!sourceLocation) sourceLocation = findInArray(arr, sourceId);
      }
      if (!targetLocation) throw new Error(`merge_entities: 找不到 targetId=${targetId} 的主体`);
      if (!sourceLocation) throw new Error(`merge_entities: 找不到 sourceId=${sourceId} 的主体`);

      const target = targetLocation.item;
      const source = sourceLocation.item;
      const mergedSameAs = Array.from(
        new Set([
          ...(Array.isArray(target.sameAs) ? target.sameAs : []),
          ...(Array.isArray(source.sameAs) ? source.sameAs : []),
          sourceId,
        ]),
      );
      const updatedTarget = { ...target, sameAs: mergedSameAs, updatedAt: new Date().toISOString() };

      const episodes = (current.episodes ?? []).map((ep: any) => {
        const shots = (ep.shots ?? []).map((s: any) => {
          if (!Array.isArray(s.entities)) return s;
          const newRefs = s.entities.map((ref: any) =>
            ref?.entityId === sourceId ? { ...ref, entityId: targetId } : ref,
          );
          return { ...s, entities: newRefs };
        });
        return { ...ep, shots };
      });

      const newArray = sourceLocation.array.filter((_: any, idx: number) => idx !== sourceLocation!.idx);
      newArray[targetLocation.idx] = updatedTarget;

      const nextEntities = {
        characters: sourceLocation.array === entities.characters ? newArray : entities.characters,
        props: sourceLocation.array === entities.props ? newArray : entities.props,
        scenes: sourceLocation.array === entities.scenes ? newArray : entities.scenes,
      };

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: {
          storyboard: { ...current, schemaVersion: 2, episodes, entities: nextEntities, lastGeneratedAt: new Date().toISOString() },
        },
      });

      return {
        success: true,
        sourceId,
        targetId,
        sameAs: mergedSameAs,
        message: `已合并: ${source.name ?? sourceId} → ${target.name ?? targetId}`,
      };
    },
  };
}

/** replace_entity_image - 替换主体主形象 */
export function replaceEntityImage(ctx: ToolContext): Tool {
  return {
    name: 'replace_entity_image',
    description:
      '替换主体的主形象(imageStorageKey)。自动维护 refCount:旧 -1,新 +1。origin 必填(asset_picker/manual_upload/ai_generated)',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: '主体 ID' },
        imageStorageKey: { type: 'string', description: '新的 storageKey(必填,resources/ 前缀)' },
        origin: { type: 'string', enum: ['asset_picker', 'manual_upload', 'ai_generated'], description: '新图片来源(必填)' },
      },
      required: ['entityId', 'imageStorageKey', 'origin'],
    },
    execute: async (args: { entityId: string; imageStorageKey: string; origin: string }) => {
      const { entityId, imageStorageKey, origin } = args;
      if (!imageStorageKey?.startsWith('resources/')) {
        throw new Error('imageStorageKey 必须以 resources/ 开头(CAS 路径,不能是外链或 base64)');
      }

      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const entities = current.entities ?? { characters: [], props: [], scenes: [] };

      let found = false;
      let oldKey: string | null = null;
      const newEntities = { ...entities };
      for (const key of ['characters', 'props', 'scenes'] as const) {
        newEntities[key] = entities[key].map((e: any) => {
          if (e?.id === entityId) {
            found = true;
            oldKey = e.imageStorageKey ?? null;
            return { ...e, imageStorageKey, status: 'image_ready', updatedAt: new Date().toISOString() };
          }
          return e;
        });
      }
      if (!found) throw new Error(`replace_entity_image: 找不到 entityId=${entityId}`);

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: {
          storyboard: { ...current, schemaVersion: 2, entities: newEntities, lastGeneratedAt: new Date().toISOString() },
        },
      });

      try {
        const resourceService = ctx.assetsService?.['resourceService'];
        if (resourceService) {
          if (oldKey) await resourceService.decrementRef(oldKey);
          await resourceService.incrementRef(imageStorageKey);
        }
      } catch (err) {
        toolLogger.warn(`replace_entity_image: refCount 维护失败(${entityId}): ${err instanceof Error ? err.message : String(err)}`);
      }

      return {
        success: true,
        entityId,
        oldImageStorageKey: oldKey,
        newImageStorageKey: imageStorageKey,
        origin,
        message: `已更新主体主形象: ${entityId}`,
      };
    },
  };
}

/** add_variant - 给主体新增衍生形象 */
export function addVariant(ctx: ToolContext): Tool {
  return {
    name: 'add_variant',
    description: '为主体新增衍生形象(variant)。name + description 必填,imageStorageKey 可后续通过 replace_entity_image 写入',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: '主体 ID' },
        variant: { type: 'object', description: 'variant 对象(必填: name + description)' },
      },
      required: ['entityId', 'variant'],
    },
    execute: async (args: { entityId: string; variant: any }) => {
      const { entityId, variant } = args;
      if (!variant?.name) throw new Error('add_variant.variant.name 必填');

      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const entities = current.entities ?? { characters: [], props: [], scenes: [] };

      const nowIso = new Date().toISOString();
      const newVariant = {
        id: variant.id ?? `var-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: variant.name,
        description: variant.description ?? '',
        imageStorageKey: variant.imageStorageKey ?? null,
        detectionSource: variant.detectionSource,
        status: variant.status ?? 'draft',
        manuallyEdited: false,
        origin: variant.origin ?? 'ai_generated',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      let found = false;
      const newEntities = { ...entities };
      for (const key of ['characters', 'props', 'scenes'] as const) {
        newEntities[key] = entities[key].map((e: any) => {
          if (e?.id === entityId) {
            found = true;
            return { ...e, variants: [...(e.variants ?? []), newVariant], updatedAt: nowIso };
          }
          return e;
        });
      }
      if (!found) throw new Error(`add_variant: 找不到 entityId=${entityId}`);

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: {
          storyboard: { ...current, schemaVersion: 2, entities: newEntities, lastGeneratedAt: nowIso },
        },
      });

      return { success: true, entityId, variantId: newVariant.id, message: `已新增衍生形象: ${variant.name}` };
    },
  };
}

/** remove_variant - 删除主体衍生形象 */
export function removeVariant(ctx: ToolContext): Tool {
  return {
    name: 'remove_variant',
    description: '删除主体的衍生形象。自动 decrementRef 对应 imageStorageKey(若有)',
    parameters: {
      type: 'object',
      properties: {
        variantId: { type: 'string', description: 'variant ID' },
      },
      required: ['variantId'],
    },
    execute: async (args: { variantId: string }) => {
      const { variantId } = args;
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const entities = current.entities ?? { characters: [], props: [], scenes: [] };

      let removedVariant: any = null;
      let parentEntityId: string | null = null;
      const newEntities = { ...entities };
      for (const key of ['characters', 'props', 'scenes'] as const) {
        newEntities[key] = entities[key].map((e: any) => {
          const variants = Array.isArray(e.variants) ? e.variants : [];
          const target = variants.find((v: any) => v?.id === variantId);
          if (target) {
            removedVariant = target;
            parentEntityId = e.id;
            return { ...e, variants: variants.filter((v: any) => v.id !== variantId), updatedAt: new Date().toISOString() };
          }
          return e;
        });
      }
      if (!removedVariant) throw new Error(`remove_variant: 找不到 variantId=${variantId}`);

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: {
          storyboard: { ...current, schemaVersion: 2, entities: newEntities, lastGeneratedAt: new Date().toISOString() },
        },
      });

      if (removedVariant.imageStorageKey) {
        try {
          const resourceService = ctx.assetsService?.['resourceService'];
          if (resourceService) await resourceService.decrementRef(removedVariant.imageStorageKey);
        } catch (err) {
          toolLogger.warn(`remove_variant: decrementRef 失败(${variantId}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return {
        success: true,
        variantId,
        entityId: parentEntityId,
        imageStorageKey: removedVariant.imageStorageKey,
        message: `已删除衍生形象: ${removedVariant.name ?? variantId}`,
      };
    },
  };
}

/** move_variant_to_entity - 错误识别纠正 */
export function moveVariantToEntity(ctx: ToolContext): Tool {
  return {
    name: 'move_variant_to_entity',
    description:
      '错误识别纠正:把 variant 从原 entity 转移到目标 entity。自动设置 correctedTo 字段',
    parameters: {
      type: 'object',
      properties: {
        variantId: { type: 'string', description: '要转移的 variant ID' },
        targetEntityId: { type: 'string', description: '目标 entity ID' },
      },
      required: ['variantId', 'targetEntityId'],
    },
    execute: async (args: { variantId: string; targetEntityId: string }) => {
      const { variantId, targetEntityId } = args;
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const entities = current.entities ?? { characters: [], props: [], scenes: [] };

      let movedVariant: any = null;
      let sourceEntityId: string | null = null;
      const newEntities = { ...entities };
      const nowIso = new Date().toISOString();

      for (const key of ['characters', 'props', 'scenes'] as const) {
        newEntities[key] = entities[key].map((e: any) => {
          const variants = Array.isArray(e.variants) ? e.variants : [];
          const target = variants.find((v: any) => v?.id === variantId);
          if (target) {
            movedVariant = target;
            sourceEntityId = e.id;
            return { ...e, variants: variants.filter((v: any) => v.id !== variantId), updatedAt: nowIso };
          }
          return e;
        });
      }
      if (!movedVariant) throw new Error(`move_variant_to_entity: 找不到 variantId=${variantId}`);

      const updatedVariant = { ...movedVariant, correctedTo: targetEntityId, manuallyEdited: true, updatedAt: nowIso };
      let targetFound = false;
      for (const key of ['characters', 'props', 'scenes'] as const) {
        newEntities[key] = newEntities[key].map((e: any) => {
          if (e?.id === targetEntityId) {
            targetFound = true;
            return { ...e, variants: [...(e.variants ?? []), updatedVariant], updatedAt: nowIso };
          }
          return e;
        });
      }
      if (!targetFound) throw new Error(`move_variant_to_entity: 找不到 targetEntityId=${targetEntityId}`);

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: {
          storyboard: { ...current, schemaVersion: 2, entities: newEntities, lastGeneratedAt: nowIso },
        },
      });

      return {
        success: true,
        variantId,
        sourceEntityId,
        targetEntityId,
        message: `已转移衍生图: ${movedVariant.name ?? variantId} → ${targetEntityId}`,
      };
    },
  };
}
