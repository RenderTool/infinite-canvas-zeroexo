/**
 * NodeContentAtlas — 节点内容图集（Plan#27 T4R 全面 Three.js）
 *
 * 节点内容（标题/图标/表单/富文本）= 离屏 DOM 快照 → 打包进单张 4096² 图集，
 * instMesh shader 经实例 aUvRect 采样（单 draw call 保持）。替代被否决的
 * 「内容 DOM overlay」（混合渲染思路）——内容与外壳一样全走引擎 GPU。
 *
 * 快照管线（T0-A POC 验证）：隐藏容器真实渲染 renderNode（页面 CSS 生效）
 * → clone + computed style 白名单内联（foreignObject 跨文档样式丢失修复）
 * → SVG → Image → canvas（动态采样倍率）。
 *
 * - colorSpace=NoColorSpace 直通：CanvasTexture 是 sRGB 编码数据，ShaderMaterial
 *   直接输出本色（SRGB8_ALPHA8 硬件解码陷阱：不可设 SRGBColorSpace）
 * - 无 mipmap（LinearFilter）：省显存，槽位间 PAD 防线性过滤串色
 * - shelf packing 分配槽位；图集满返回 null（调用方回退为不渲染内容，等同 LOD 降级）
 */
import * as THREE from 'three';

export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class NodeContentAtlas {
  static readonly SIZE = 4096;
  static readonly PAD = 2; // 槽位间距（防过滤串色）

  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;

  private ctx: CanvasRenderingContext2D;
  private shelves: { y: number; h: number; x: number }[] = [];
  private used = new Map<string, AtlasRect>();
  private usedH = 0; // 已用高度（新 shelf 起点）

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = NodeContentAtlas.SIZE;
    this.canvas.height = NodeContentAtlas.SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    // NoColorSpace 直通：CanvasTexture 默认 sRGB 编码数据 → ShaderMaterial 输出本色
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.anisotropy = 4;
    this.texture.minFilter = THREE.LinearFilter; // 无 mipmap（省显存）
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  /** 分配槽位（已有则返回现存）；图集满返回 null */
  alloc(id: string, w: number, h: number): AtlasRect | null {
    const exist = this.used.get(id);
    if (exist) return exist;
    const pw = Math.min(Math.max(1, Math.ceil(w)), NodeContentAtlas.SIZE - NodeContentAtlas.PAD * 2);
    const ph = Math.min(Math.max(1, Math.ceil(h)), NodeContentAtlas.SIZE - NodeContentAtlas.PAD * 2);
    // 先找能放下的现存 shelf（从左到右）
    for (const s of this.shelves) {
      if (s.h >= ph && s.x + pw + NodeContentAtlas.PAD <= NodeContentAtlas.SIZE) {
        const rect = { x: s.x + NodeContentAtlas.PAD, y: s.y + NodeContentAtlas.PAD, w: pw, h: ph };
        this.used.set(id, rect);
        s.x += pw + NodeContentAtlas.PAD;
        return rect;
      }
    }
    // 开新 shelf
    const y = this.usedH + NodeContentAtlas.PAD;
    if (y + ph + NodeContentAtlas.PAD > NodeContentAtlas.SIZE) return null; // 图集满
    const rect = { x: NodeContentAtlas.PAD, y: y + NodeContentAtlas.PAD, w: pw, h: ph };
    this.used.set(id, rect);
    this.shelves.push({ y: y + NodeContentAtlas.PAD, h: ph, x: NodeContentAtlas.PAD + pw + NodeContentAtlas.PAD });
    this.usedH = y + ph;
    return rect;
  }

  /** 重绘槽位（快照 canvas 画入） */
  draw(id: string, src: CanvasImageSource): void {
    const r = this.used.get(id);
    if (!r) return;
    this.ctx.clearRect(r.x, r.y, r.w, r.h);
    this.ctx.drawImage(src, r.x, r.y, r.w, r.h);
    this.texture.needsUpdate = true;
  }

  /** 释放槽位（节点移除/尺寸变化/LOD 降级） */
  free(id: string): void {
    const r = this.used.get(id);
    if (!r) return;
    this.ctx.clearRect(r.x, r.y, r.w, r.h);
    this.used.delete(id);
    this.texture.needsUpdate = true;
  }

  /** 槽位归一化 uv 矩形（xy=起点 zw=终点）；无槽位返回 null */
  uvOf(id: string): [number, number, number, number] | null {
    const r = this.used.get(id);
    if (!r) return null;
    const s = NodeContentAtlas.SIZE;
    return [r.x / s, r.y / s, (r.x + r.w) / s, (r.y + r.h) / s];
  }

  has(id: string): boolean {
    return this.used.has(id);
  }
}
