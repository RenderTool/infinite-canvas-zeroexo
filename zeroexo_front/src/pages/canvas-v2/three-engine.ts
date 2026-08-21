/**
 * ThreeCanvasV2 — zeroexo 画布 v2 引擎（Plan#26 调研 demo）
 *
 * 覆盖用户敲定的调研项:
 * 1. SDF 圆角 shader（解决不同比例图片的圆角形变：半径世界单位，与宽高比无关）
 * 2. 投影双方案对比：DirectionalLight shadowMap vs ContactShadows（深度+模糊烘焙）
 * 3. 虚线 shader（SDF 轮廓 + 周长参数化 dash，像素级抗锯齿，替代 LineDashedMaterial）
 * 4. 组框还原（POC 方案：半透明背景 + 虚线轮廓 + 标题）
 * 5. PIN 复刻（节点边缘圆点 + 贝塞尔曲线边）
 * 6. 3D 模式（正交/透视双相机 + TransformControls + W/E/R/Q/C 快捷键，旋转默认关闭）
 */
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

// ==================== Shader 源码 ====================

/** 节点体顶点 shader（InstancedMesh 单 draw call：位置/尺寸/颜色/四角圆角/选中标记全走实例属性）
 * aRadius 为 per-node 圆角 clamp 上限（短边 1/4），与 GUI 全局四角 uniform 逐分量取 min；
 * uCardPad 外扩 quad：描边走 CSS outline 语义（完全在卡片外圈），
 * 外扩量必须同时作用于 vPos，否则插值被钳制在卡片内、外扩区域全部 discard */
const NODE_VERT = /* glsl */ `
attribute vec2 aSize;
attribute vec3 aColor;
attribute vec4 aRadius;   // 四角独立: TL TR BR BL（per-node clamp 上限）
attribute float aSelected;
attribute float aHover;
attribute vec4 aUvRect;   // 内容纹理 uv 矩形（xy=起点 zw=终点；zw<=xy = 无内容，跳过采样）
uniform vec4 uRadius; // 全局四角圆角（GUI 参数化，与 per-node clamp 逐分量取 min，还原 CSS border-radius 四值语义）
uniform float uCardPad; // 卡片 quad 外扩量（= 描边宽度 + AA 余量）
varying vec2 vPos;
varying vec2 vSize;
varying vec3 vColor;
varying vec4 vRadius;
varying float vSelected;
varying float vHover;
varying vec2 vUv;
varying vec4 vUvRect;
void main() {
  vSize = aSize;
  vColor = aColor;
  vec4 clampMax = vec4(min(aSize.x, aSize.y) / 4.0);
  vRadius = min(min(aRadius, uRadius), clampMax);
  vSelected = aSelected;
  vHover = aHover;
  vUv = uv;
  vUvRect = aUvRect;
  // local 半宽 = 0.5 + pad/size：instanceMatrix 缩放后 = size/2 + pad（世界单位精确外扩）
  vec2 local = position.xy * (1.0 + 2.0 * uCardPad / aSize);
  vPos = local * aSize; // 外扩区域 vPos 正确超出卡片边界，SDF 可在外圈画描边
  #ifdef USE_INSTANCING
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(local, 0.0, 1.0);
  #else
    gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 0.0, 1.0);
  #endif
}`;

const NODE_FRAG = /* glsl */ `
uniform float opacity;
uniform float uBorderW;      // 描边宽度（三态共用，0=关闭，CSS outline-width 语义：完全在卡片外圈）
uniform float uDashPeriod;   // 描边虚线周期长度（世界单位 = (dashPx+gapPx)/k；0=实线，周期随缩放屏幕像素恒定）
uniform float uBorderDashRatio; // 虚线占空比 dash/(dash+gap)
uniform vec3 uBorderDefault; // default 态描边色（原项目 NodeDefaults.outlineColor 默认 #0f3460）
uniform vec3 uBorderHover;   // hover 态描边色
uniform vec3 uSelectColor;   // selected 态描边色（原项目 #e94560）
uniform sampler2D uAtlas;    // 节点内容图集（T4R：离屏快照打包，实例 aUvRect 采样）
varying vec2 vPos;
varying vec2 vSize;
varying vec3 vColor;
varying vec4 vRadius;
varying float vSelected;
varying float vHover;
varying vec2 vUv;
varying vec4 vUvRect;
// 四角独立圆角 SDF（还原 CSS border-radius 四值：TL TR BR BL；每角半径同时作用于 x/y 方向）
float sdRoundRect4(vec2 p, vec2 b, vec4 r) {
  float rx = p.x >= 0.0 ? (p.y >= 0.0 ? r.y : r.z) : (p.y >= 0.0 ? r.x : r.w);
  vec2 q = abs(p) - b + rx;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rx;
}
// 圆角矩形周长归一化参数 t ∈ [0,1)（弧长精确累计；四角半径取平均近似，dash 周期视觉无感）
float perimT(vec2 p, vec2 b, vec4 r) {
  float rr = (r.x + r.y + r.z + r.w) * 0.25;
  float hw = b.x, hh = b.y;
  float s = max(2.0 * hw - 2.0 * rr, 0.0);
  float v = max(2.0 * hh - 2.0 * rr, 0.0);
  float a = 1.5707963 * rr;
  float perim = 2.0 * s + 2.0 * v + 4.0 * a;
  float x = p.x, y = p.y;
  float acc = 0.0;
  if (x >= hw - rr - 0.001 && x <= hw + 0.001) {
    if (y > 0.0 && y <= hh - rr + 0.001) {
      acc = y;
    } else if (y >= -hh + rr - 0.001 && y <= 0.001) {
      acc = v * 1.5 + 2.0 * s + 4.0 * a + (y + hh - rr);
    }
  }
  if (length(p - vec2(hw - rr, hh - rr)) <= rr + 0.001) {
    float ang = atan(y - (hh - rr), x - (hw - rr));
    acc = v * 0.5 + (ang + 1.5707963) * rr;
  }
  if (y >= hh - rr - 0.001 && y <= hh + 0.001 && x >= -hw + rr - 0.001 && x <= hw - rr + 0.001) {
    acc = v * 0.5 + a + (hw - rr - x);
  }
  if (length(p - vec2(-hw + rr, hh - rr)) <= rr + 0.001) {
    float ang = atan(y - (hh - rr), x - (-hw + rr));
    acc = v * 0.5 + a + s + ang * rr;
  }
  if (x >= -hw - 0.001 && x <= -hw + rr + 0.001 && y >= -hh + rr - 0.001 && y <= hh - rr + 0.001) {
    acc = v * 0.5 + a + s + a + (hh - rr - y);
  }
  if (length(p - vec2(-hw + rr, -hh + rr)) <= rr + 0.001) {
    float ang = atan(y - (-hh + rr), x - (-hw + rr));
    acc = v * 0.5 + a + s + a + v + (ang - 1.5707963) * rr;
  }
  if (y >= -hh - 0.001 && y <= -hh + rr + 0.001 && x >= -hw + rr - 0.001 && x <= hw - rr + 0.001) {
    acc = v * 0.5 + a + s + a + v + a + (x + hw - rr);
  }
  if (length(p - vec2(hw - rr, -hh + rr)) <= rr + 0.001) {
    float ang = atan(y - (-hh + rr), x - (hw - rr));
    acc = v * 1.5 + 2.0 * s + 3.0 * a + (ang + 1.5707963) * rr;
  }
  return acc / max(perim, 1e-4);
}
// 圆角矩形周长（世界单位；与 perimT 归一化分母同源，供虚线周期弧长换算）
float perimLen(vec2 b, vec4 r) {
  float rr = (r.x + r.y + r.z + r.w) * 0.25;
  float s = max(2.0 * b.x - 2.0 * rr, 0.0);
  float v = max(2.0 * b.y - 2.0 * rr, 0.0);
  return 2.0 * s + 2.0 * v + 6.2831852 * rr;
}
void main() {
  // 反缩放补偿：vPos 为未拉伸的局部坐标（vSize 不受 instance 非均匀 scale 影响），
  // 任意比例圆角均为真圆弧（宽节点圆角不扁）
  float d = sdRoundRect4(vPos, vSize * 0.5, vRadius);
  // 抗锯齿带 clamp ≤1.5px：透视斜视下 fwidth 梯度被放大，不加限会产生宽灰边/锯齿
  float aa = min(fwidth(d) * 1.2, 1.5);
  float mask = 1.0 - smoothstep(-aa, aa, d);
  vec3 col = vColor;
  float a = mask * opacity;
  // 内容纹理采样（T4R 全面 Three.js：节点内容 = 离屏快照打包进 uAtlas，实例 uv 矩形采样；
  // 纹理透明区露出卡片底色，不透明区覆盖内容；与 SDF 圆角 mask 相乘裁剪（内容自带圆角 alpha 双保险））
  if (vUvRect.z > vUvRect.x && vUvRect.w > vUvRect.y) {
    vec4 tex = texture2D(uAtlas, mix(vUvRect.xy, vUvRect.zw, vUv));
    col = mix(col, tex.rgb, tex.a);
    a = max(a, mask * tex.a * opacity);
  }
  // 描边（CSS outline 语义：完全在卡片外圈；三态颜色优先级 selected > hover > default，
  // 宽度共用；虚线可选——还原原项目 NodeShell outline 宽度/颜色三层优先级）
  if (uBorderW > 0.01) {
    vec3 bcol = vSelected > 0.5 ? uSelectColor : (vHover > 0.5 ? uBorderHover : uBorderDefault);
    float ring = smoothstep(0.0, aa, d + uBorderW) * (1.0 - smoothstep(-aa, aa, d));
    float bmask = 1.0;
    if (uDashPeriod > 0.01) {
      float t = perimT(vPos, vSize * 0.5, vRadius);
      float ph = t * perimLen(vSize * 0.5, vRadius) / uDashPeriod; // 弧长 → 周期相位（世界单位/周期长度）
      float seg = fract(ph);
      float daa = max(fwidth(ph) * 1.5, 1e-4);
      bmask = smoothstep(-daa, daa, seg) * (1.0 - smoothstep(uBorderDashRatio - daa, uBorderDashRatio + daa, seg));
    }
    col = mix(col, bcol, ring * bmask);
    a = max(a, ring * bmask * opacity);
  }
  if (a < 0.01) discard; // 外扩 quad 区域 a≈0 的片段统一丢弃（避免外扩区全屏渲染）
  gl_FragColor = vec4(col, a);
}`;

/** PIN quad 顶点（单 PlaneGeometry，局部坐标即世界尺寸，世界单位固定） */
const PIN_VERT = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, 0.0, 1.0);
}`;

/**
 * PIN SDF 片元（纯 3D 复原：空心圆环 + 内部加号 + 外部虚线环；还原 PinView 14px 圆环 + "+" 风格）
 * - 主圆环：sdCircle 环形带，fwidth AA（无锯齿，替代 RingGeometry 硬边）
 * - 加号：两交叉 sdBox 薄条
 * - 外部虚线环：半径 1.6× 静态虚线（角度弧长相位，周期 0.9rad / 占空 0.5，去脉冲）
 * - 光晕：uGlow 外圈高斯（PIN hover 磁吸提示，替代硬边大环 → 无锯齿）
 * - 3D 模式由 loop 做 billboard（quad 朝向相机，透视下圆环保持正圆）
 */
const PIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
varying vec2 vPos;
// 尺寸常量由 TS 侧 defines 注入（PIN_R / PIN_BORDER / PIN_R_OUT 单一来源，与 PIN_OUTSET 同步）
float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
// 角度弧长 → 静态均匀虚线（fwidth AA；period 为弧度周期，ratio 为占空比）
float dashAngle(float ang, float period, float ratio) {
  float ph = ang / period;
  float seg = fract(ph);
  float daa = max(fwidth(ph) * 1.5, 1e-4);
  return smoothstep(-daa, daa, seg) * (1.0 - smoothstep(ratio - daa, ratio + daa, seg));
}
void main() {
  float aa = min(fwidth(vPos.x) * 1.2, 1.5);
  // 主圆环（空心圆环带）
  float dRing = abs(sdCircle(vPos, PIN_R)) - PIN_BORDER * 0.5;
  float ring = 1.0 - smoothstep(-aa, aa, dRing);
  // 加号（两交叉薄条）
  float dPlus = min(sdBox(vPos, vec2(PIN_R * 0.55, PIN_BORDER * 0.45)), sdBox(vPos, vec2(PIN_BORDER * 0.45, PIN_R * 0.55)));
  float plus = 1.0 - smoothstep(-aa, aa, dPlus);
  // 外部虚线环（静态）
  float dOut = sdCircle(vPos, PIN_R_OUT);
  float ringOut = (1.0 - smoothstep(-aa, aa, dOut)) * smoothstep(0.0, aa, dOut + PIN_BORDER);
  ringOut *= dashAngle(atan(vPos.y, vPos.x), 0.9, 0.5);
  float a = max(max(ring, plus), ringOut * 0.9);
  vec3 col = uColor;
  if (uGlow > 0.01) {
    float dGlow = sdCircle(vPos, PIN_R * 2.2);
    float glowA = uGlow * 0.35 * exp(-pow(max(dGlow, 0.0) / (PIN_R * 1.2), 2.0));
    col = mix(col, vec3(1.0), 0.5);
    a = max(a, glowA);
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

/** 背景网格 quad 顶点（全屏 NDC，不依赖相机矩阵；2D/3D 模式均覆盖视口） */
const BG_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * 背景网格片元（还原原画布 viewport CSS background-image 语义 1:1）：
 * - dots：radial-gradient 点阵，点径 1.15px 实心 → 1.35px 渐变硬边；缩放 <0.25 隐藏，[0.25,1] 透明度线性恢复
 * - lines：两层 linear-gradient 1px 线条网格
 * - 平铺单元 = grid_size*k（CSS px），偏移 = viewport 取模（随视口平移）；颜色带 alpha（原 CSS rgba 提取）
 */
const BG_FRAG = /* glsl */ `
uniform float uMode;     // 0=none 1=dots 2=lines
uniform float uDPR;      // devicePixelRatio（gl_FragCoord 物理 px → CSS px）
uniform vec2 uOffset;    // 视口平移（世界/CSS px）
uniform float uGridPx;   // 平铺单元 CSS px = grid_size * k
uniform float uZoom;     // 缩放 k（dots 透明度渐变）
uniform vec4 uDotColor;  // 点色（含 alpha）
uniform vec4 uLineColor; // 线色（含 alpha）
varying vec2 vUv;
void main() {
  if (uMode < 0.5) discard; // none：完全透明，页面背景色透出
  vec2 p = gl_FragCoord.xy / uDPR - mod(uOffset, uGridPx);
  vec2 cell = mod(p, uGridPx);
  float a;
  if (uMode < 1.5) {
    // dots：k<0.25 隐藏，[0.25,1] 透明度线性恢复（原 CSS zoomFactor）
    float zf = clamp((uZoom - 0.25) / 0.75, 0.0, 1.0);
    if (zf < 0.001) discard;
    float d = length(cell - uGridPx * 0.5);
    float aa = min(fwidth(d), 0.6);
    float m = 1.0 - smoothstep(1.15 - aa, 1.35, d);
    a = uDotColor.a * zf * m;
    gl_FragColor = vec4(uDotColor.rgb, a);
  } else {
    // lines：格左/上边缘 1px 线（平铺后与原 CSS 每单元一条线等价）
    float aa = 0.75;
    float m = max(
      1.0 - smoothstep(1.0 - aa, 1.0 + aa, cell.x),
      1.0 - smoothstep(1.0 - aa, 1.0 + aa, cell.y)
    );
    a = uLineColor.a * m;
    gl_FragColor = vec4(uLineColor.rgb, a);
  }
  if (a < 0.003) discard;
}`;

/** SDF 解析阴影顶点：quad 外扩 uPad 容纳模糊尾部（instanceMatrix 已含 w/h 缩放，
 * 外扩量必须除以 aSize 还原到 local 空间，否则双重缩放把阴影放大 w 倍；
 * vPos 必须同步乘外扩系数——否则插值被钳制在卡片内、fragment 的 dCard<0 discard 掉全部阴影） */
const SHADOW_VERT = /* glsl */ `
attribute vec2 aSize;
attribute vec4 aRadius;
attribute float aHover;
uniform float uPad;
uniform vec4 uRadius; // 全局四角圆角（GUI 参数化，与卡片同源；阴影圆角跟随卡片四角）
varying vec2 vPos;
varying vec2 vSize;
varying vec4 vRadius;
varying float vHover;
void main() {
  vSize = aSize;
  vRadius = min(min(aRadius, uRadius), vec4(min(aSize.x, aSize.y) / 4.0));
  vHover = aHover;
  // local 半宽 = 0.5 + pad/size：instanceMatrix 缩放后 = size/2 + pad（世界单位精确外扩）
  vec2 local = position.xy * (1.0 + 2.0 * uPad / aSize);
  vPos = local * aSize; // 外扩区域 vPos 正确超出卡片边界，CSS 模糊尾部可渲染
  #ifdef USE_INSTANCING
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(local, 0.0, 1.0);
  #else
    gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 0.0, 1.0);
  #endif
}`;

/**
 * SDF 解析阴影片元（CSS box-shadow 规范 1:1 等价）：
 * - 剪影 = 圆角矩形 SDF 平移 offset（①偏移独立可控）
 * - 边缘高斯衰减 σ=blur/2（②与三次盒式模糊数学等价）
 * - spread 外扩/内缩剪影（③CSS spread 语义：正放大负缩小，圆角同步增减）
 * - hover 为完全独立的第二组参数（还原原项目 NodeItem hover 投影：offset/blur/spread/opacity 直接切换）
 * - 解析式无纹理（④像素级精度 ⑤每实例可参数化）；阴影画在节点自身 quad 内、z 序在卡片之下
 */
const SHADOW_FRAG = /* glsl */ `
uniform vec2 uOffset;        // 空闲态偏移（CSS 语义，y 向下为正）
uniform float uBlur;         // 空闲态模糊半径
uniform float uSpread;       // 空闲态 spread（正外扩/负内缩，世界单位）
uniform float uOpacity;      // 空闲态不透明度
uniform vec3 uShadowColor;   // 阴影色（GUI 参数化）
uniform vec2 uHoverOffset;   // hover 态偏移（独立参数，直接切换非缩放）
uniform float uHoverBlur;    // hover 态模糊半径
uniform float uHoverSpread;  // hover 态 spread
uniform float uHoverOpacity; // hover 态不透明度
varying vec2 vPos;
varying vec2 vSize;
varying vec4 vRadius;
varying float vHover;
float sdRoundRect4(vec2 p, vec2 b, vec4 r) {
  float rx = p.x >= 0.0 ? (p.y >= 0.0 ? r.y : r.z) : (p.y >= 0.0 ? r.x : r.w);
  vec2 q = abs(p) - b + rx;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rx;
}
void main() {
  float dCard = sdRoundRect4(vPos, vSize * 0.5, vRadius);
  if (dCard < 0.0) discard; // 卡片本体覆盖区不画（避免与卡片重叠混合）
  // 世界 y 向上，CSS offset-y 向下 → 取负；hover 整组切换（CSS :hover 独立 box-shadow 声明）
  vec2 off = vHover > 0.5 ? vec2(uHoverOffset.x, -uHoverOffset.y) : vec2(uOffset.x, -uOffset.y);
  float blur = vHover > 0.5 ? uHoverBlur : uBlur;
  float spread = vHover > 0.5 ? uHoverSpread : uSpread;
  float alphaMul = vHover > 0.5 ? uHoverOpacity : uOpacity;
  // spread 语义：剪影半宽 = 卡片半宽 + spread，圆角同步增减（CSS spread 沿轮廓法线外扩）
  float d = sdRoundRect4(vPos - off, vSize * 0.5 + spread, vRadius + spread);
  float alpha;
  if (d <= 0.0) {
    alpha = 1.0; // 剪影内部全暗
  } else {
    float sigma = max(blur * 0.5, 0.001);
    alpha = exp(-d * d / (2.0 * sigma * sigma)); // 高斯衰减（等效 CSS 三次盒式模糊）
  }
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uShadowColor, min(alpha, 1.0) * alphaMul);
}`;

// ==================== 图片节点 shader（独立 Mesh，非 InstancedMesh） ====================

/** 图片节点顶点：quad 外扩 uCardPad（描边 outline 语义），vPos 同步外扩（与 NODE_VERT 同坑规避） */
const IMG_VERT = /* glsl */ `
uniform vec2 uSize;
uniform vec4 uRadius;
uniform float uCardPad;
varying vec2 vPos;
varying vec2 vUv;
varying vec2 vSize;
varying vec4 vRadius;
void main() {
  vUv = uv;
  vSize = uSize;
  vRadius = min(uRadius, vec4(min(uSize.x, uSize.y) / 4.0));
  vec2 local = position.xy * (1.0 + 2.0 * uCardPad / uSize);
  vPos = local * uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 0.0, 1.0);
}`;

/** 图片节点片元：纹理本色 + SDF 四角圆角裁剪（alpha 相乘）+ 外描边三态虚线（与原项目 NodeShell outline 一致） */
const IMG_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float opacity;
uniform float uBorderW;
uniform float uDashPeriod;
uniform float uBorderDashRatio;
uniform vec3 uBorderDefault;
uniform vec3 uBorderHover;
uniform vec3 uSelectColor;
uniform float uSelected;
uniform float uHovered;
varying vec2 vPos;
varying vec2 vUv;
varying vec2 vSize;
varying vec4 vRadius;
float sdRoundRect4(vec2 p, vec2 b, vec4 r) {
  float rx = p.x >= 0.0 ? (p.y >= 0.0 ? r.y : r.z) : (p.y >= 0.0 ? r.x : r.w);
  vec2 q = abs(p) - b + rx;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rx;
}
// 圆角矩形周长归一化参数 t ∈ [0,1)（弧长精确累计；四角半径取平均近似，dash 周期视觉无感）
float perimT(vec2 p, vec2 b, vec4 r) {
  float rr = (r.x + r.y + r.z + r.w) * 0.25;
  float hw = b.x, hh = b.y;
  float s = max(2.0 * hw - 2.0 * rr, 0.0);
  float v = max(2.0 * hh - 2.0 * rr, 0.0);
  float a = 1.5707963 * rr;
  float perim = 2.0 * s + 2.0 * v + 4.0 * a;
  float x = p.x, y = p.y;
  float acc = 0.0;
  if (x >= hw - rr - 0.001 && x <= hw + 0.001) {
    if (y > 0.0 && y <= hh - rr + 0.001) {
      acc = y;
    } else if (y >= -hh + rr - 0.001 && y <= 0.001) {
      acc = v * 1.5 + 2.0 * s + 4.0 * a + (y + hh - rr);
    }
  }
  if (length(p - vec2(hw - rr, hh - rr)) <= rr + 0.001) {
    float ang = atan(y - (hh - rr), x - (hw - rr));
    acc = v * 0.5 + (ang + 1.5707963) * rr;
  }
  if (y >= hh - rr - 0.001 && y <= hh + 0.001 && x >= -hw + rr - 0.001 && x <= hw - rr + 0.001) {
    acc = v * 0.5 + a + (hw - rr - x);
  }
  if (length(p - vec2(-hw + rr, hh - rr)) <= rr + 0.001) {
    float ang = atan(y - (hh - rr), x - (-hw + rr));
    acc = v * 0.5 + a + s + ang * rr;
  }
  if (x >= -hw - 0.001 && x <= -hw + rr + 0.001 && y >= -hh + rr - 0.001 && y <= hh - rr + 0.001) {
    acc = v * 0.5 + a + s + a + (hh - rr - y);
  }
  if (length(p - vec2(-hw + rr, -hh + rr)) <= rr + 0.001) {
    float ang = atan(y - (-hh + rr), x - (-hw + rr));
    acc = v * 0.5 + a + s + a + v + (ang - 1.5707963) * rr;
  }
  if (y >= -hh - 0.001 && y <= -hh + rr + 0.001 && x >= -hw + rr - 0.001 && x <= hw - rr + 0.001) {
    acc = v * 0.5 + a + s + a + v + a + (x + hw - rr);
  }
  if (length(p - vec2(hw - rr, -hh + rr)) <= rr + 0.001) {
    float ang = atan(y - (-hh + rr), x - (hw - rr));
    acc = v * 1.5 + 2.0 * s + 3.0 * a + (ang + 1.5707963) * rr;
  }
  return acc / max(perim, 1e-4);
}
// 圆角矩形周长（世界单位；与 perimT 归一化分母同源，供虚线周期弧长换算）
float perimLen(vec2 b, vec4 r) {
  float rr = (r.x + r.y + r.z + r.w) * 0.25;
  float s = max(2.0 * b.x - 2.0 * rr, 0.0);
  float v = max(2.0 * b.y - 2.0 * rr, 0.0);
  return 2.0 * s + 2.0 * v + 6.2831852 * rr;
}
void main() {
  vec4 tex = texture2D(uMap, vUv);
  // SDF 圆角裁剪：纹理 alpha 与圆角 mask 相乘（png 透明区 + 圆角外均透明）
  float d = sdRoundRect4(vPos, vSize * 0.5, vRadius);
  float aa = min(fwidth(d) * 1.2, 1.5);
  float mask = 1.0 - smoothstep(-aa, aa, d);
  vec3 col = tex.rgb;
  float a = mask * tex.a * opacity;
  // 外描边（CSS outline 语义：完全在卡片外圈；三态颜色优先级 selected > hover > default，虚线可选）
  if (uBorderW > 0.01) {
    vec3 bcol = uSelected > 0.5 ? uSelectColor : (uHovered > 0.5 ? uBorderHover : uBorderDefault);
    float ring = smoothstep(0.0, aa, d + uBorderW) * (1.0 - smoothstep(-aa, aa, d));
    float bmask = 1.0;
    if (uDashPeriod > 0.01) {
      float t = perimT(vPos, vSize * 0.5, vRadius);
      float ph = t * perimLen(vSize * 0.5, vRadius) / uDashPeriod; // 弧长 → 周期相位
      float seg = fract(ph);
      float daa = max(fwidth(ph) * 1.5, 1e-4);
      bmask = smoothstep(-daa, daa, seg) * (1.0 - smoothstep(uBorderDashRatio - daa, uBorderDashRatio + daa, seg));
    }
    col = mix(col, bcol, ring * bmask);
    a = max(a, ring * bmask * opacity);
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

/** 组框阴影顶点（独立 Mesh：uSize/uRadius/uPad/uHovered 走 uniform，非实例属性；四角跟随卡片） */
const IMG_SHADOW_VERT = /* glsl */ `
uniform vec2 uSize;
uniform vec4 uRadius;
uniform float uPad;
uniform float uHovered;
varying vec2 vPos;
varying vec2 vSize;
varying vec4 vRadius;
varying float vHover;
void main() {
  vSize = uSize;
  vRadius = min(uRadius, vec4(min(uSize.x, uSize.y) / 4.0));
  vHover = uHovered;
  vec2 local = position.xy * (1.0 + 2.0 * uPad / uSize);
  vPos = local * uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 0.0, 1.0);
}`;

// ==================== 组框 shader（反馈 11：组 = 节点 SDF 同源变体） ====================

/** 组框顶点：quad 外扩 uPad（描边 + 选中红晕 + 阴影尾部），vPos 同步外扩（同 NODE_VERT 坑规避） */
const GROUP_VERT = /* glsl */ `
uniform vec2 uSize;
uniform float uRadius;
uniform float uPad;
varying vec2 vPos;
varying vec2 vSize;
varying float vRadius;
void main() {
  vSize = uSize;
  vRadius = min(uRadius, min(uSize.x, uSize.y) / 4.0);
  vec2 local = position.xy * (1.0 + 2.0 * uPad / uSize);
  vPos = local * uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 0.0, 1.0);
}`;

/**
 * 组框片元（与节点同一套 SDF 数学：圆角矩形距离场 + 高斯衰减阴影 + 描边三态 + hover 增强）：
 * - 背景：圆角矩形半透明填充（hover 轻微提亮，同节点 hover 语义）
 * - 阴影：SDF 解析 box-shadow（同 SHADOW_FRAG 高斯数学，画在框外区域）
 * - 虚线描边：圆角矩形周长参数化（perimT 精确弧长累计）→ 距离场 dash + smoothstep 抗锯齿端头
 *   （替代原 Line2 独立虚线——同源后随缩放保持屏幕像素恒定）
 * - 选中态：轮廓换选中色 + 背景外圈高斯红晕（替代原独立 glow Mesh）
 * - hover 态：外圈高斯辉光 + 背景提亮（原组框无 hover，反馈 11 要求节点有的组也该有）
 */
const GROUP_FRAG = /* glsl */ `
uniform float opacity;        // 背景透明度（bgOpacity）
uniform vec3 uBgColor;        // 背景色
uniform float uBorderW;       // 轮廓线宽（世界单位 = lineWidth / k）
uniform float uLineOpacity;   // 轮廓透明度（未选中）
uniform vec3 uLineColor;      // 未选中轮廓色
uniform vec3 uSelectColor;    // 选中轮廓色
uniform float uSelected;      // 0/1 选中标记
uniform float uHover;         // 0/1 hover 标记
uniform float uDashes;        // 周长周期数（屏幕像素恒定）
uniform float uDashRatio;     // 占空比 dash/(dash+gap)
uniform float uOutlineOffset; // 描边外移（世界单位，DOM outlineOffset 语义）
uniform float uGlowR;         // 选中红晕半径（世界单位）
uniform float uGlowOpacity;   // 选中红晕强度
uniform float uShadowBlur;    // 组框阴影模糊（世界单位）
uniform float uShadowOpacity; // 组框阴影透明度
uniform vec3 uShadowColor;    // 阴影色
uniform vec2 uShadowOffset;   // 组框阴影偏移（世界单位，CSS box-shadow offset 语义）
varying vec2 vPos;
varying vec2 vSize;
varying float vRadius;
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
// 圆角矩形周长归一化参数 t ∈ [0,1)：从右边缘中点出发顺时针，弧长精确累计（右直段/右上弧/上直段/左上弧/左直段/左下弧/下直段/右下弧）
float perimT(vec2 p, vec2 b, float r) {
  float hw = b.x, hh = b.y;
  float s = max(2.0 * hw - 2.0 * r, 0.0);  // 水平直段长
  float v = max(2.0 * hh - 2.0 * r, 0.0);  // 垂直直段长
  float a = 1.5707963 * r;                 // 1/4 圆弧长
  float perim = 2.0 * s + 2.0 * v + 4.0 * a;
  float x = p.x, y = p.y;
  float acc = 0.0;
  if (x >= hw - r - 0.001 && x <= hw + 0.001) {
    if (y > 0.0 && y <= hh - r + 0.001) {
      acc = y; // 段0 右直段上半
    } else if (y >= -hh + r - 0.001 && y <= 0.001) {
      acc = v * 1.5 + 2.0 * s + 4.0 * a + (y + hh - r); // 段8 右直段下半
    }
  }
  if (length(p - vec2(hw - r, hh - r)) <= r + 0.001) {
    float ang = atan(y - (hh - r), x - (hw - r)); // 右上弧 [-PI/2, 0]
    acc = v * 0.5 + (ang + 1.5707963) * r;
  }
  if (y >= hh - r - 0.001 && y <= hh + 0.001 && x >= -hw + r - 0.001 && x <= hw - r + 0.001) {
    acc = v * 0.5 + a + (hw - r - x); // 段2 上直段
  }
  if (length(p - vec2(-hw + r, hh - r)) <= r + 0.001) {
    float ang = atan(y - (hh - r), x - (-hw + r)); // 左上弧 [0, PI/2]
    acc = v * 0.5 + a + s + ang * r;
  }
  if (x >= -hw - 0.001 && x <= -hw + r + 0.001 && y >= -hh + r - 0.001 && y <= hh - r + 0.001) {
    acc = v * 0.5 + a + s + a + (hh - r - y); // 段4 左直段
  }
  if (length(p - vec2(-hw + r, -hh + r)) <= r + 0.001) {
    float ang = atan(y - (-hh + r), x - (-hw + r)); // 左下弧 [PI/2, PI]
    acc = v * 0.5 + a + s + a + v + (ang - 1.5707963) * r;
  }
  if (y >= -hh - 0.001 && y <= -hh + r + 0.001 && x >= -hw + r - 0.001 && x <= hw - r + 0.001) {
    acc = v * 0.5 + a + s + a + v + a + (x + hw - r); // 段6 下直段
  }
  if (length(p - vec2(hw - r, -hh + r)) <= r + 0.001) {
    float ang = atan(y - (-hh + r), x - (hw - r)); // 右下弧 [-PI/2, 0]
    acc = v * 1.5 + 2.0 * s + 3.0 * a + (ang + 1.5707963) * r;
  }
  return acc / max(perim, 1e-4);
}
void main() {
  float d = sdRoundRect(vPos, vSize * 0.5, vRadius);
  float aa = min(fwidth(d) * 1.2, 1.5);
  vec3 col = uBgColor;
  float a = 0.0;
  // 阴影（同源 SDF 解析 box-shadow：高斯衰减，仅框外区域，背景覆盖框内）
  float ds = sdRoundRect(vPos - uShadowOffset, vSize * 0.5, vRadius);
  float blur = max(uShadowBlur * 0.5, 0.001);
  float shadowA = exp(-ds * ds / (2.0 * blur * blur));
  if (d > -aa && shadowA > 0.01) {
    float sa = min(shadowA * uShadowOpacity, 1.0);
    col = mix(col, uShadowColor, sa);
    a = max(a, sa);
  }
  // 背景（圆角矩形半透明，hover 轻微提亮）
  float mask = 1.0 - smoothstep(-aa, aa, d);
  if (mask > 0.01) {
    a = max(a, mask * opacity * (1.0 + 0.5 * uHover));
  }
  // 虚线描边环带（SDF 距离场 dash，端头抗锯齿；选中换选中色 + 更实；uOutlineOffset 外移复刻 CSS outlineOffset）
  float ring = smoothstep(0.0, aa, d + uBorderW + uOutlineOffset) * (1.0 - smoothstep(-aa, aa, d + uOutlineOffset));
  if (ring > 0.01) {
    float t = perimT(vPos, vSize * 0.5, vRadius);
    float dashSeg = fract(t * uDashes);
    float dashAA = max(fwidth(t * uDashes) * 1.5, 1e-4);
    float dashMask = smoothstep(-dashAA, dashAA, dashSeg) * (1.0 - smoothstep(uDashRatio - dashAA, uDashRatio + dashAA, dashSeg));
    vec3 borderCol = mix(uLineColor, uSelectColor, uSelected);
    float borderA = uLineOpacity * (1.0 + 0.5 * uSelected);
    col = mix(col, borderCol, ring * dashMask);
    a = max(a, ring * dashMask * borderA);
  }
  // 选中红晕（T7：CSS box-shadow 0 0 0 4px rgba(233,69,96,0.2) 硬环语义——框外 0..uGlowR 均匀强度、
  // 边缘 AA；替代原高斯近似，2D 逐像素对齐 DOM 版 GroupItem）
  if (uSelected > 0.5 && uGlowOpacity > 0.01) {
    float glowRing = (1.0 - smoothstep(-aa, aa, d)) * (1.0 - smoothstep(uGlowR - aa, uGlowR + aa, d));
    col = mix(col, uSelectColor, glowRing * 0.5);
    a = max(a, glowRing * uGlowOpacity);
  }
  // hover 外圈辉光（同节点 hover 阴影增强语义；σ 取红晕一半，柔和外扩）
  if (uHover > 0.5) {
    float hsigma = max(uGlowR * 0.5, 0.001);
    float hoverA = exp(-d * d / (2.0 * hsigma * hsigma));
    col = mix(col, uLineColor, hoverA * 0.25);
    a = max(a, hoverA * 0.15);
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, min(a, 1.0));
}`;

// ==================== 类型 ====================

export interface V2Node {
  id: string;
  instIndex: number; // -1 = 图片节点（独立 Mesh，非 InstancedMesh 实例）
  data: { x: number; y: number; w: number; h: number; color: string; groupId: string | null; label: string };
  mesh?: THREE.Mesh; // 图片节点实体（纹理内容，sRGB 原色输出）
  imgShadow?: THREE.Mesh; // 图片节点阴影层（独立 quad，SDF 解析 box-shadow）
}

export interface V2Viewport { x: number; y: number; k: number }

/** CSS 颜色字符串 → RGBA（#hex / rgb() / rgba()；alpha 缺省用 fallback，原 CSS 默认 0.24） */
function parseCssColor(c: string, fallbackAlpha: number): { r: number; g: number; b: number; a: number } {
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1] ?? '', 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: fallbackAlpha };
  }
  const rgba = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i);
  if (rgba) {
    const ra = rgba[4];
    const a = ra === undefined ? fallbackAlpha : ra.endsWith('%') ? parseFloat(ra) / 100 : parseFloat(ra);
    return { r: parseFloat(rgba[1] ?? '0') / 255, g: parseFloat(rgba[2] ?? '0') / 255, b: parseFloat(rgba[3] ?? '0') / 255, a };
  }
  // 解析失败回退原画布默认 #16213e
  return { r: 22 / 255, g: 33 / 255, b: 62 / 255, a: fallbackAlpha };
}

/** 视觉参数化样式（GUI 驱动：四角独立圆角 / 两套 CSS box-shadow / 三态边框 / 透明度，全 uniform + 实例属性，零对象重建）
 * 默认值 1:1 对齐原项目：NodeShell borderRadius 2 / NodeItem 空闲 0 1px 2px rgba(0,0,0,0.04) /
 * hover 6px 8px 20px rgba(0,0,0,0.35) / outline 默认 0 选中 2px #e94560 */
export interface V2StyleParams {
  // ① 圆角（CSS border-radius 四值语义：TL TR BR BL，每角独立控制）
  radiusTL: number; radiusTR: number; radiusBR: number; radiusBL: number;
  // ② 外部投影（CSS box-shadow 1:1：offsetX offsetY blur spread color，空闲态一套）
  shadowOffsetX: number; shadowOffsetY: number; // CSS 语义，y 向下为正
  shadowBlur: number; shadowSpread: number; shadowOpacity: number;
  shadowColor: string;
  // ② hover 独立投影（原项目 NodeItem hoverEffect：6px 8px 20px 0.35 直接切换）
  hoverShadowOffsetX: number; hoverShadowOffsetY: number;
  hoverShadowBlur: number; hoverShadowSpread: number; hoverShadowOpacity: number;
  // ③ 边线（类型/颜色/粗细；三态颜色优先级 selected > hover > default，宽度共用）
  borderType: 0 | 1;        // 0=实线 1=虚线（选中/悬停/常驻统一）
  borderWidth: number;      // 粗细（CSS outline-width 语义：完全在卡片外圈，0=关闭）
  borderDefaultColor: string; borderHoverColor: string; borderSelectedColor: string;
  // ④ 透明度
  opacity: number;
}
export const DEFAULT_STYLE: V2StyleParams = {
  radiusTL: 2, radiusTR: 2, radiusBR: 2, radiusBL: 2, // 原项目 NodeShell borderRadius 默认 2
  shadowOffsetX: 0, shadowOffsetY: 1, shadowBlur: 2, shadowSpread: 0, shadowOpacity: 0.04, // 原项目 NodeItem 空闲 0 1px 2px rgba(0,0,0,0.04)
  shadowColor: '#000000',
  hoverShadowOffsetX: 6, hoverShadowOffsetY: 8, hoverShadowBlur: 20, hoverShadowSpread: 0, hoverShadowOpacity: 0.35, // 原项目 hover 6px 8px 20px rgba(0,0,0,0.35)
  borderType: 0, borderWidth: 0, // 原项目 NodeShell outlineWidth 默认 0（无常驻描边）
  borderDefaultColor: '#0f3460', borderHoverColor: '#90cdf4', borderSelectedColor: '#e94560', // 原项目 outlineColor 默认 #0f3460 / 选中 #e94560
  opacity: 1,
};

/** 边线视觉参数（用户拍板 5 参数：①粗细 ②颜色 ③边缘渐变辉光 ④连线段数 ⑤透明度 + 活跃态双态；
 * 去脉冲：活跃 = 静态虚线。非活跃 1:1 对齐原项目 EdgeLayer 合并 path rgba(255,255,255,0.55) 1.5px；
 * 活跃对齐 #e94560 2.5px + 辉光 7px 0.35 + dasharray "16 80"） */
export interface EdgeStyleParams {
  lineWidth: number;    // ①主线宽（屏幕 px，非活跃态 1.5）
  color: string;        // ②非活跃色（#ffffff，配合 lineOpacity 0.55 = rgba(255,255,255,0.55)）
  lineOpacity: number;  // ⑤主线透明度（非活跃 0.55）
  glowWidth: number;    // ③活跃辉光底层线宽（px，宽度方向高斯衰减 = 边缘渐变辉光）
  glowOpacity: number;  // ③辉光层透明度（0.35）
  segments: number;     // ④贝塞尔采样段数（4..64；自适应降级链动态减半）
  activeColor: string;  // 活跃色（#e94560）
  activeWidth: number;  // 活跃主线宽（2.5px）
}
export const DEFAULT_EDGE_STYLE: EdgeStyleParams = {
  lineWidth: 1.5, color: '#ffffff', lineOpacity: 0.55,
  glowWidth: 7, glowOpacity: 0.35, segments: 32,
  activeColor: '#e94560', activeWidth: 2.5,
};

/** 描边虚线周期（世界单位换算用）：dash 16px + gap 80px（原项目 dasharray "16 80"） */
export const BORDER_DASH_SUM_PX = 96;
/** 边活跃态虚线周期：dash 16 + gap 80 */
export const EDGE_DASH_SUM_PX = 96;
/** 边活跃态虚线占空比 dash/(dash+gap) */
export const EDGE_DASH_RATIO = 16 / 96;

/** 组框视觉参数（SDF 虚线距离场 + 半透明背景，GUI 驱动） */
export interface GroupStyleParams {
  dashPx: number;      // 虚线长（屏幕 px，随缩放保持恒定）
  gapPx: number;       // 间隔（屏幕 px）
  lineWidth: number;   // 轮廓线宽（px）
  lineOpacity: number; // 轮廓透明度（未选中态）
  lineColor: string;   // 未选中轮廓色
  selectColor: string; // 选中轮廓色
  bgOpacity: number;   // 背景透明度
}
// 默认值与 DOM 版 GroupItem 内置默认同源（config-dialog DEFAULT_CANVAS_CONFIG：
// 背景 rgba(255,255,255,0.04) / 圆角 2 / 描边 1px dashed rgba(233,69,96,0.5) / offset 3 / opacity 1）
export const DEFAULT_GROUP_STYLE: GroupStyleParams = {
  dashPx: 4, gapPx: 4, lineWidth: 1, lineOpacity: 0.5,
  lineColor: '#e94560', selectColor: '#e94560', bgOpacity: 0.04,
};

/**
 * 组样式节点级覆盖（T7：DOM 版 GroupItem 三层模型「节点字段 > GroupDefaults > 内置默认」；
 * adapter 从组节点字段 + GroupDefaults 解析后注入，未覆盖字段回退引擎共享默认）
 */
export interface GroupStyleOverride {
  backgroundColor?: string;      // rgba/hex，支持渐变字符串（引擎仅取首色平涂，渐变列 T11）
  borderRadius?: number;         // 世界 px
  outlineColor?: string;         // 描边色（未选中）
  outlineWidth?: number;         // 世界 px
  outlineType?: 'solid' | 'dashed';
  outlineOffset?: number;        // 世界 px（SDF 环带外扩，DOM 版 outlineOffset 语义）
  opacity?: number;              // 0-1
  titleColor?: string;           // 标题文本色
}
/** 阴影 quad 外扩量：CSS box-shadow 可见范围 = 2×blur + |offset| + |spread|（空闲/hover 取最大，高斯尾部截断到 1% 以下） */
function shadowPad(p: V2StyleParams): number {
  const blur = Math.max(p.shadowBlur, p.hoverShadowBlur);
  const off = Math.max(
    Math.abs(p.shadowOffsetX), Math.abs(p.shadowOffsetY),
    Math.abs(p.hoverShadowOffsetX), Math.abs(p.hoverShadowOffsetY),
  );
  const spread = Math.max(p.shadowSpread, p.hoverShadowSpread);
  return blur * 2 + off + spread + 2;
}

const GROUP_PAD = 16;
const GROUP_RADIUS = 2;
const GROUP_TITLE_H = 28;    // 组标题高度（zeroexo GROUP_TITLE_HEIGHT=28，T7 与 DOM 版对齐）
const DRAG_THRESHOLD = 4;    // 拖拽激活阈值 px（纯点击不触发拖拽，与 POC 一致）
const GRID_STEP = 50;        // Shift 吸附步长（X/Y 平移网格，对应官方 translationSnap）
const PIN_R = 7;             // PIN 半径（原版 14px/2）
const PIN_BORDER = 1.8;      // PIN 环边框厚度
const PIN_OUTSET = PIN_R + 4; // PIN 圆心与节点边缘的距离（原项目约束：圆心在边缘外侧 pinSize/2，保持距离不压边）
const PIN_HOVER_ZONE = 40;   // PIN hover 容器宽度 px（原版 hover 区，悬停显示 PIN + 光晕 + crosshair）
const SPRING_STIFF = 9;      // 回弹振荡角频率 rad/s（欠阻尼：Q 弹过冲）
const SPRING_DAMP = 6;       // 回弹阻尼系数 1/s（ζ ≈ 0.67，1~2 次过冲后收敛）
const CAMERA_Z_MARGIN = 200; // 相机平面保护：组 Z 永远不超相机平面 - 该余量
const INST_CAPACITY_START = 256; // InstancedMesh 初始容量（超出自动 ×2 扩容）

interface GroupVisual {
  mesh: THREE.Mesh;  // SDF 组框（背景 + 虚线描边 + 选中红晕 + hover + 阴影，反馈 11：与节点同源渲染算法）
  title: THREE.Mesh; // 组标题（CanvasTexture，打底盖住轮廓）
}

export class ThreeCanvasV2 {
  // 核心
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private orthoCam: THREE.OrthographicCamera;
  private perspCam: THREE.PerspectiveCamera;
  private camera: THREE.Camera;
  private container: HTMLElement;
  private raf = 0;
  private disposed = false;

  // 视口（与主项目 viewport 语义一致：x/y 为视口中心世界坐标，k 为缩放）
  private vp: V2Viewport = { x: 0, y: 0, k: 1 };

  // 节点/组（InstancedMesh 单 draw call）
  private nodes = new Map<string, V2Node>();
  private nodeByInst = new Map<number, V2Node>();
  private instMesh!: THREE.InstancedMesh;
  private instNodeMat!: THREE.ShaderMaterial;      // 卡片材质（深度策略 applyDepthMode 动态切换 depthWrite）
  private instSizeAttr!: THREE.InstancedBufferAttribute;
  private instColorAttr!: THREE.InstancedBufferAttribute;
  private instRadiusAttr!: THREE.InstancedBufferAttribute;
  private capacity = 0;
  private activeCount = 0;
  private instDummy = new THREE.Object3D(); // 写 instanceMatrix 的临时对象
  private shadowMesh!: THREE.InstancedMesh; // SDF 解析阴影层（共享 instMesh geometry/实例属性，独立矩阵 z-2）
  private instSelectedAttr!: THREE.InstancedBufferAttribute; // aSelected 选中标记（0/1，边框由卡片 shader 环带绘制）
  private instHoverAttr!: THREE.InstancedBufferAttribute;    // aHover 悬停标记（0/1，指针移动检测）
  private instUvRectAttr!: THREE.InstancedBufferAttribute;   // T4R: aUvRect 内容 uv 矩形（0,0,0,0 = 无内容）
  private hoverNode: V2Node | null = null;
  private hoverGroup: string | null = null; // 组框 hover 标记（反馈 11：节点有的组也该有，uHover 驱动辉光/提亮）
  private groups = new Map<string, GroupVisual>();
  private groupRoot = new THREE.Group(); // 组框层（节点之下）
  private edgeRoot = new THREE.Group();  // 边层
  private proxyObj = new THREE.Object3D(); // TransformControls 代理（实例位置不可直接 attach）
  // 边线共享 uniform（共享值对象模式：onBeforeCompile 注入的是同一引用，setEdgeStyle 直改 value 即时生效）
  private edgeGlowUniforms = { uGlowMix: { value: 1.0 } };   // glow 层恒定全高斯（边缘渐变辉光）
  private edgeLineUniforms = { uGlowMix: { value: 0 } };     // 主线纯色（辉光由活跃 glow 层承担）
  // 组框共享 uniform（共享值对象模式：所有组材质引用同一套，setGroupStyle 直改 value 即时生效；
  // 尺寸/虚线周期/选中/浮空等 per-组 uniform 由 updateGroups 直写各材质）
  private groupSharedUniforms = {
    uRadius: { value: GROUP_RADIUS }, // 组框圆角（容器语义，与节点圆角参数分离）
    opacity: { value: DEFAULT_GROUP_STYLE.bgOpacity },
    uBgColor: { value: new THREE.Color('#ffffff').convertLinearToSRGB() },
    uLineOpacity: { value: DEFAULT_GROUP_STYLE.lineOpacity },
    uLineColor: { value: new THREE.Color(DEFAULT_GROUP_STYLE.lineColor).convertLinearToSRGB() },
    uSelectColor: { value: new THREE.Color(DEFAULT_GROUP_STYLE.selectColor).convertLinearToSRGB() },
    uGlowOpacity: { value: 0.2 },    // 选中红晕强度（CSS 0 0 0 4px rgba(233,69,96,0.2)，T7 对齐 DOM 默认）
    uShadowOpacity: { value: 0.15 }, // 组框阴影浓度（CSS 0 2px 6px rgba(0,0,0,0.15)，T7 对齐 DOM 默认）
    uShadowColor: { value: new THREE.Color('#000000') },
  };

  // ==================== 边线/组框参数（GUI 驱动，setEdgeStyle/setGroupStyle 零重建更新） ====================
  private edgeStyle: EdgeStyleParams = { ...DEFAULT_EDGE_STYLE };
  private groupStyle: GroupStyleParams = { ...DEFAULT_GROUP_STYLE };
  /** T7: 外部注入组 bounds（adapter 用 DOM 同源 computeGroupBounds 计算后注入，引擎直接消费，几何 1:1） */
  private externalGroupBounds = new Map<string, { x: number; y: number; w: number; h: number; title: string }>();
  /** T7: per-组样式覆盖（组节点字段 + GroupDefaults 解析结果；null/缺字段回退共享默认） */
  private externalGroupStyles = new Map<string, GroupStyleOverride>();
  /** T7: 组标题纹理打底色（= 画布背景色，DOM 版 var(--zeroexo-canvas-bg)） */
  private groupTitleBg = '#0d1117';
  /** T7: 浅色主题判定（与 GroupItem isLight 同源：非 dark 即浅色） */
  private groupIsLight = typeof window !== 'undefined' && !window.matchMedia('(prefers-color-scheme: dark)').matches;
  /** 边活跃态表（key = `${a}|${b}`；选中/悬停任一端节点 → 活跃。非活跃单层实线，活跃辉光+虚线） */
  private edgeActive = new Map<string, boolean>();
  /** 贝塞尔采样段数（= edgeStyle.segments；自适应降级链动态减半/翻倍，addEdge/updateEdgesFor 读取） */
  private bezierSegments = DEFAULT_EDGE_STYLE.segments;

  // ==================== 性能自适应降级（低端机回退链，反馈 9） ====================
  /** 自适应开关（GUI 可关；关闭后不自动降级，仍可手动） */
  adaptiveDegrade = true;
  /** 屏幕外剔除开关（2D 视口矩形粗筛 → 实例 scale 0 / mesh visible，低频节流） */
  cullEnabled = true;
  /** 当前降级级别 0=全效 · 1=pixelRatio 2→1.5 · 2=阴影关+段数减半 · 3=pixelRatio 1+段数再减半 · 4=圆角归零 */
  private degradeLevel = 0;
  private fpsTimer = 0;
  private fpsCount = 0;
  private lowFpsStreak = 0;
  private highFpsStreak = 0;
  private origPixelRatio = Math.min(window.devicePixelRatio, 2);
  private origRadius = DEFAULT_STYLE.radiusTL;
  private cullTimer = 0;
  private cullState = new Map<number, boolean>(); // instIndex → 上次可见（只写变化实例，避免拖动时全量矩阵重写）

  // ==================== 非活跃 tick 关闭（dirty 驱动渲染：静止时 rAF 完全暂停，GPU 零负载） ====================
  private dirty = true;
  private interacting = false; // 指针/滚轮活跃期间强制渲染（防个别 handler 漏 markDirty）
  private wheelSettle = 0; // 滚轮停止后 120ms 解除强制渲染

  // 3D 模式
  isLayerMode = false;
  /**
   * 组框渲染归属（T7 生产接入）：'engine' = 引擎 SDF 渲染（demo/直连默认）；
   * 'dom' = 2D 平面视角下组框由 DOM GroupLayer 原组件渲染（像素级 1:1 + 全交互复用），
   * 引擎仅 3D 模式渲染组框 SDF。adapter（ThreeCanvasHost 生产路径）构造时置为 'dom'。
   */
  groupRenderMode: 'engine' | 'dom' = 'engine';
  private orbitCenter = new THREE.Vector3(0, 0, 0);
  private orbit = { theta: 0, phi: 0, radius: 1500 };
  private savedCam = { x: 0, y: 0, k: 1 };
  private camAnim: {
    start: number; dur: number;
    fromPos: THREE.Vector3; fromQuat: THREE.Quaternion;
    toPos: THREE.Vector3; toQuat: THREE.Quaternion;
    fromZs: number[]; toZs: number[];
    onDone?: () => void;
  } | null = null;
  private layerGroups: string[] = [];
  private groupZOffsets = new Map<string, number>();
  // 反馈 11：节点自身 Z 浮动（组内拖 Z 不触发整组移动；相对组平面偏移 + 松手 spring 回弹）
  private nodeFloatZ = new Map<string, number>(); // 节点 id → 浮动偏移（世界单位）
  private nodeZSprings = new Map<string, { from: number; t0: number }>(); // 松手回弹动画（欠阻尼振荡，Q 弹过冲）
  private control: TransformControls;
  selected: V2Node | null = null; // 公开供页面读取（胶囊菜单移动跟随判断）
  private selectedGroup: string | null = null; // 选中组（POC：点击组框背景选中整组）
  private proxyGroupObj = new THREE.Object3D(); // TransformControls 组代理（组无实体对象，代理位置驱动节点）
  private gizmoGroupBase = { x: 0, y: 0, z: 0 }; // 组代理 attach 时的基准（增量语义）

  // 视觉参数化（GUI 驱动：卡片/阴影材质共享同一套 uniform，调节即时生效零重建）
  private style: V2StyleParams = { ...DEFAULT_STYLE };
  private styleUniforms = {
    uRadius: { value: new THREE.Vector4(DEFAULT_STYLE.radiusTL, DEFAULT_STYLE.radiusTR, DEFAULT_STYLE.radiusBR, DEFAULT_STYLE.radiusBL) }, // 四角圆角（卡片/阴影共享）
    uBorderW: { value: DEFAULT_STYLE.borderWidth },
    uDashPeriod: { value: 0 }, // 描边虚线周期（世界单位 = BORDER_DASH_SUM_PX/k；0=实线，applyViewport 时换算）
    uBorderDashRatio: { value: 16 / BORDER_DASH_SUM_PX },
    uCardPad: { value: DEFAULT_STYLE.borderWidth + 2 }, // 卡片 quad 外扩（描边 + AA 余量）
    uBorderDefault: { value: new THREE.Color(DEFAULT_STYLE.borderDefaultColor).convertLinearToSRGB() },
    uBorderHover: { value: new THREE.Color(DEFAULT_STYLE.borderHoverColor).convertLinearToSRGB() },
    uSelectColor: { value: new THREE.Color(DEFAULT_STYLE.borderSelectedColor).convertLinearToSRGB() },
    // 空闲阴影（CSS 1:1：offsetX offsetY blur spread opacity）
    uShadowOffset: { value: new THREE.Vector2(DEFAULT_STYLE.shadowOffsetX, DEFAULT_STYLE.shadowOffsetY) },
    uBlur: { value: DEFAULT_STYLE.shadowBlur },
    uSpread: { value: DEFAULT_STYLE.shadowSpread },
    uOpacity: { value: DEFAULT_STYLE.shadowOpacity },
    // hover 阴影独立参数组（直接切换非缩放）
    uHoverOffset: { value: new THREE.Vector2(DEFAULT_STYLE.hoverShadowOffsetX, DEFAULT_STYLE.hoverShadowOffsetY) },
    uHoverBlur: { value: DEFAULT_STYLE.hoverShadowBlur },
    uHoverSpread: { value: DEFAULT_STYLE.hoverShadowSpread },
    uHoverOpacity: { value: DEFAULT_STYLE.hoverShadowOpacity },
    uPad: { value: shadowPad(DEFAULT_STYLE) },
    uShadowColor: { value: new THREE.Color(DEFAULT_STYLE.shadowColor).convertLinearToSRGB() },
    opacity: { value: 1 }, // 节点透明度
  };

  // 交互回调
  onNodeClick: ((id: string | null) => void) | null = null;
  onGroupClick: ((gid: string | null) => void) | null = null;
  onNodeMove: ((id: string, x: number, y: number) => void) | null = null;
  /** 拖动结束（松手）回调：适配层提交 MoveNodesCommand 落盘；ids = 本次拖动节点 */
  onNodeDragEnd: ((ids: string[]) => void) | null = null;
  onViewportChange: ((vp: V2Viewport) => void) | null = null;
  on3DStateChange: ((is3D: boolean) => void) | null = null;
  // 性能回调（自适应降级状态推送，GUI 显示）
  onPerfUpdate: ((fps: number, level: number) => void) | null = null;
  onDegradeChange: ((level: number) => void) | null = null;

  // 拖拽状态
  private dragging: { id: string; offX: number; offY: number; nodeZ: number } | null = null;
  private pending: { x: number; y: number; type: 'drag' | 'groupDrag' | 'orbit' | 'pan'; id?: string; offX?: number; offY?: number; gid?: string } | null = null;
  private groupDrag: { gid: string; ids: string[]; starts: { x: number; y: number }[]; grabWorld: { x: number; y: number }; planeZ: number } | null = null;
  private orbitDrag: { sx: number; sy: number; theta: number; phi: number } | null = null; // 左键空白环绕（阈值激活，起始角绝对偏移）
  private orbitPan: { sx: number; sy: number; cx: number; cy: number } | null = null; // 中键平移 orbit 焦点
  private panning: { sx: number; sy: number; vx: number; vy: number } | null = null;
  // 拖拽连线状态机（反馈 11：PIN hover 按下 → 预览贝塞尔 → 松手建立边，复刻原版 connection controller）
  private connectState: { fromId: string; side: 'left' | 'right' } | null = null;
  private connectPreview: { glow: Line2; line: Line2 } | null = null;
  // PIN hover 区（反馈 11：复刻原版 40px 边缘容器——悬停显示 PIN + 光晕 + crosshair；3D 下虚线球体）
  private pinHoverState: { nodeId: string; side: 'left' | 'right' } | null = null;
  private pinHoverG: THREE.Group | null = null;  // 2D：圆环 + 十字 + 外圈光晕（磁吸吸附提示）
  private pinSphereG: THREE.Group | null = null; // 3D：虚线球体（三正交圆环 dash）

  // ===== 背景网格（还原原画布 viewport CSS background-image：dots/lines，随视口平移缩放） =====
  private bgQuad: THREE.Mesh | null = null;
  private bgMode: 'none' | 'dots' | 'lines' = 'none'; // 默认 none：透明叠加页面背景色
  private bgGridSize = 32; // 原画布 grid_size 默认
  private bgUniforms = {
    uMode: { value: 0 },
    uDPR: { value: 1 },
    uOffset: { value: new THREE.Vector2(0, 0) },
    uGridPx: { value: 32 },
    uZoom: { value: 1 },
    uDotColor: { value: new THREE.Vector4(22 / 255, 33 / 255, 62 / 255, 0.24) },
    uLineColor: { value: new THREE.Vector4(22 / 255, 33 / 255, 62 / 255, 1) },
  };

  private raycaster = new THREE.Raycaster();
  private tmpV2 = new THREE.Vector2();

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // 演示背景：完全透明（alpha 通道保留），直接享受页面原本背景画布（layoutStyle theme.canvas.background），
    // 阴影投射到真实背景上与 CSS box-shadow 语义一致；原硬编码 #1a1a2e 已废弃
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    const w = container.clientWidth, h = container.clientHeight;
    this.orthoCam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, -10000, 10000);
    this.orthoCam.position.z = 100;
    this.perspCam = new THREE.PerspectiveCamera(45, w / h, 1, 20000);
    this.camera = this.orthoCam;

    this.scene.add(this.groupRoot);
    this.scene.add(this.edgeRoot);

    // 背景网格层（全屏 NDC quad，renderOrder 最前；默认 none 完全透明，页面背景色透出）
    this.bgQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: BG_VERT,
        fragmentShader: BG_FRAG,
        uniforms: this.bgUniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      })
    );
    this.bgQuad.frustumCulled = false;
    this.bgQuad.renderOrder = -10;
    this.bgUniforms.uDPR.value = this.renderer.getPixelRatio();
    this.scene.add(this.bgQuad);

    // 节点 InstancedMesh（单 draw call 渲染所有节点，SDF 圆角 + 反缩放补偿）
    this.ensureCapacity(INST_CAPACITY_START);
    this.scene.add(this.proxyObj);
    this.scene.add(this.proxyGroupObj);

    // 样式 uniform 绑定（卡片/阴影材质共享 styleUniforms，GUI 调节即时生效；扩容重建后重新绑定）
    this.bindStyleUniforms();

    // ===== 官方 TransformControls（3D 模式）=====
    this.control = new TransformControls(this.orthoCam, this.renderer.domElement);
    this.control.setMode('translate');
    this.control.setSize(0.8);
    this.control.showY = true;
    this.scene.add(this.control.getHelper());
    this.control.enabled = false;
    this.control.addEventListener('dragging-changed', (e) => {
      this.controlDragging = !!e.value;
      if (e.value) this.interacting = true;
      else {
        this.interacting = false;
        // 拖动结束：适配层在此提交位置命令（MoveNodesCommand 一次 undo 恢复全部起点）
        if (this.selected) this.onNodeDragEnd?.([this.selected.id]);
        // 反馈 11：节点 Z 拖拽松手 → spring 回弹动画（欠阻尼振荡 Q 弹过冲，磁铁吸附语义；
        // 仅浮动非零时启动，spring 收敛后代理归位组平面）
        if (this.selected) {
          const fz = this.nodeFloatZ.get(this.selected.id);
          if (fz !== undefined && Math.abs(fz) > 0.5) {
            this.nodeZSprings.set(this.selected.id, { from: fz, t0: performance.now() });
          }
        }
        this.markDirty();
      }
    });
    this.control.addEventListener('objectChange', () => {
      const obj = this.control.object;
      if (obj === this.proxyObj && this.selected) {
        // 代理 XY → 节点位置
        this.setNodePos(this.selected, obj.position.x, obj.position.y);
        // Z 轴拖动 = 节点自身 Z 浮动（反馈 11：不触发整组移动——原实现写 groupZOffsets 导致
        // 整组 Z 移动；现写入 nodeFloatZ 相对组平面偏移，松手后 spring 回弹回组平面）
        const z = Math.min(obj.position.z, this.perspCam.position.z - CAMERA_Z_MARGIN);
        const baseZ = this.nodeWorldZ(this.selected) - (this.nodeFloatZ.get(this.selected.id) ?? 0);
        const floatZ = z - baseZ;
        if (floatZ !== (this.nodeFloatZ.get(this.selected.id) ?? 0)) {
          this.nodeFloatZ.set(this.selected.id, floatZ);
          this.nodeZSprings.delete(this.selected.id); // 拖动中取消回弹（重新拖 = 新意图）
          this.syncInstGroupZ();
          this.updateGroups();
          this.syncAllEdges(); // 连线 z 跟随节点浮动
        }
        this.syncNode(this.selected);
      } else if (obj === this.proxyGroupObj && this.selectedGroup) {
        // 组代理：XY 增量 → 组内节点整体平移；Z 增量 → 组 Z 偏移（相机平面保护）
        const gid = this.selectedGroup;
        const dx = obj.position.x - this.gizmoGroupBase.x;
        const dy = obj.position.y - this.gizmoGroupBase.y;
        const dz = obj.position.z - this.gizmoGroupBase.z;
        if (dx !== 0 || dy !== 0) {
          for (const n of this.nodes.values()) {
            if (n.data.groupId === gid) this.setNodePos(n, n.data.x + dx, n.data.y + dy);
          }
          this.updateGroups();
        }
        if (dz !== 0) {
          const z = Math.min(this.gizmoGroupBase.z + dz, this.perspCam.position.z - CAMERA_Z_MARGIN);
          this.groupZOffsets.set(gid, z);
          this.syncInstGroupZ();
          this.updateGroups();
        }
        this.updateGroups();
        for (const n of this.nodes.values()) {
          if (n.data.groupId === gid) this.updateEdgesFor(n.id);
        }
      }
    });
    this.control.addEventListener('change', () => { this.updateGroups(); this.markDirty(); });

    this.bindEvents();
    this.resize();
    this.markDirty(); // 首帧渲染（此后静止即停 rAF，交互/动画/参数变化时唤醒）
  }

  private controlDragging = false;

  // ==================== 材质工厂 ====================

  /** SDF 解析阴影材质（CSS box-shadow 语义：offset + 高斯模糊 σ=blur/2 + opacity，全 uniform 参数化） */
  private makeShadowMat(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uOffset: { value: new THREE.Vector2(DEFAULT_STYLE.shadowOffsetX, DEFAULT_STYLE.shadowOffsetY) },
        uBlur: { value: DEFAULT_STYLE.shadowBlur },
        uSpread: { value: DEFAULT_STYLE.shadowSpread },
        uOpacity: { value: DEFAULT_STYLE.shadowOpacity },
        uPad: { value: shadowPad(DEFAULT_STYLE) },
        uShadowColor: { value: new THREE.Color(DEFAULT_STYLE.shadowColor) },
        uHoverOffset: { value: new THREE.Vector2(DEFAULT_STYLE.hoverShadowOffsetX, DEFAULT_STYLE.hoverShadowOffsetY) },
        uHoverBlur: { value: DEFAULT_STYLE.hoverShadowBlur },
        uHoverSpread: { value: DEFAULT_STYLE.hoverShadowSpread },
        uHoverOpacity: { value: DEFAULT_STYLE.hoverShadowOpacity },
      },
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      transparent: true,
      depthWrite: false, // 阴影不写深度：同组卡片覆盖阴影，跨组按 z 序自然层叠
    });
    return mat;
  }

  /** 样式 uniform 绑定（卡片/阴影材质引用同一套 styleUniforms；扩容重建材质后重新调用） */
  private bindStyleUniforms(): void {
    const nodeU = (this.instMesh.material as THREE.ShaderMaterial).uniforms;
    nodeU.uRadius = this.styleUniforms.uRadius;
    nodeU.uBorderW = this.styleUniforms.uBorderW;
    nodeU.uDashPeriod = this.styleUniforms.uDashPeriod;
    nodeU.uBorderDashRatio = this.styleUniforms.uBorderDashRatio;
    nodeU.uCardPad = this.styleUniforms.uCardPad;
    nodeU.uBorderDefault = this.styleUniforms.uBorderDefault;
    nodeU.uBorderHover = this.styleUniforms.uBorderHover;
    nodeU.uSelectColor = this.styleUniforms.uSelectColor;
    nodeU.opacity = this.styleUniforms.opacity;
    const shadowU = (this.shadowMesh.material as THREE.ShaderMaterial).uniforms;
    shadowU.uOffset = this.styleUniforms.uShadowOffset;
    shadowU.uBlur = this.styleUniforms.uBlur;
    shadowU.uSpread = this.styleUniforms.uSpread;
    shadowU.uOpacity = this.styleUniforms.uOpacity;
    shadowU.uPad = this.styleUniforms.uPad;
    shadowU.uShadowColor = this.styleUniforms.uShadowColor;
    shadowU.uHoverOffset = this.styleUniforms.uHoverOffset;
    shadowU.uHoverBlur = this.styleUniforms.uHoverBlur;
    shadowU.uHoverSpread = this.styleUniforms.uHoverSpread;
    shadowU.uHoverOpacity = this.styleUniforms.uHoverOpacity;
    shadowU.uRadius = this.styleUniforms.uRadius; // 阴影圆角跟随 GUI 四角圆角（共享 uniform）
  }

  /** InstancedMesh 节点材质（SDF 圆角，全部实例共用一份 = 1 draw call） */
  private makeInstancedNodeMat(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      transparent: true,
      depthWrite: false, // 2D：不写深度（层叠由绘制顺序保证，防白边）；3D：applyDepthMode 切换为写深度（深度遮挡）
      uniforms: {
        opacity: { value: 1 },
        uCardPad: { value: DEFAULT_STYLE.borderWidth + 2 },
        uAtlas: { value: null }, // T4R: 节点内容图集（host 侧 NodeContentAtlas 提供，setContentAtlas 注入）
      },
    });
    this.instNodeMat = mat;
    return mat;
  }

  /**
   * 边/组框线材质工厂（LineMaterial + onBeforeCompile 注入，与 SDF 阴影同源数学）：
   * - uGlowMix 高斯辉光：宽度方向自然衰减（vUv.y ∈ [0,1]，0.5=线中心，中心亮边缘淡），
   *   替换纯色条带（视觉“色块”）——glow 层纯高斯、主线轻微柔化；端帽区 vUv.y 越界距离>1 自动淡出
   * - dash 虚线距离场：uDashes 周期数 / uDashRatio 占空比（vUv.x 沿线段 0..1），
   *   smoothstep 抗锯齿端头（优于 LineDashedMaterial 硬方头无 AA），周期随缩放保持屏幕像素恒定
   * 注入点：color_fragment 之后（alpha 变量已声明，gl_FragColor 直接使用 alpha）
   * 注意（反馈 11 根因）：three 的 WebGLProgram 只从 GLSL 源码提取 uniform 声明，shader.uniforms
   * 仅是“值”——uGlowMix/uDashes/uDashRatio 必须注入声明（全局作用域），否则 GLSL 编译错误 →
   * Line2 全部不可渲染（连线/组框虚线不可见的真根因，反馈 10 只修了 resolution 爆炸未修此错）。
   * 值走共享对象（onBeforeCompile 时 assign 到 shader.uniforms 的是同一引用），
   * setEdgeStyle 直改共享对象 value 即时生效（原 material.uniforms 直改是克隆值，不生效）。
   */
  private makeLineMaterial(opts: { color: number; linewidth: number; opacity: number; glowMix?: number; glowMixUniform?: { value: number }; dash?: boolean; sharedUniforms?: Record<string, { value: unknown }> }): LineMaterial {
    const mat = new LineMaterial({ color: opts.color, linewidth: opts.linewidth, transparent: true, opacity: opts.opacity, worldUnits: false });
    const dashCode = opts.dash
      ? '\n      float dashSeg = fract(vUv.x * uDashes);\n      float dashAA = max(fwidth(vUv.x * uDashes) * 1.5, 1e-4);\n      alpha *= uDashes > 0.01 ? (smoothstep(-dashAA, dashAA, dashSeg) * (1.0 - smoothstep(uDashRatio - dashAA, uDashRatio + dashAA, dashSeg))) : 1.0;'
      : '';
    const glowUniform = opts.glowMixUniform ?? this.edgeLineUniforms.uGlowMix;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uGlowMix: glowUniform }, opts.sharedUniforms);
      if (!shader.fragmentShader.includes('uniform float uGlowMix;')) {
        // uniform 声明注入（全局作用域；防重复编译二次注入）
        shader.fragmentShader = shader.fragmentShader.replace(
          'void main() {',
          'uniform float uGlowMix;\nuniform float uDashes;\nuniform float uDashRatio;\n\nvoid main() {',
        );
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n' +
        '      // 宽度方向高斯辉光（0.5=线中心，边缘自然衰减）\n' +
        '      float wDist = abs(vUv.y - 0.5) * 2.0;\n' +
        '      alpha *= mix(1.0, exp(-pow(wDist * 3.0, 2.0)), uGlowMix);' +
        dashCode,
      );
    };
    return mat;
  }

  /**
   * 2D/3D 深度策略切换（解决 3D 模式节点堆叠面片闪烁）：
   * - 3D：卡片写深度 → 组 Z 深度天然遮挡，与绘制顺序解耦（帧间稳定）；
   *   同组共面节点深度相等（LessEqual 通过）→ 后画覆盖先画，实例顺序恒定无抖动
   * - 2D：卡片不写深度 → 层叠由 renderOrder + 绘制顺序保证（正视距离相等排序恒定）
   * 阴影/组框/PIN/边恒定 depthWrite=false（半透明层，靠卡片写入的深度被正确遮挡）
   */
  private applyDepthMode(): void {
    const write = this.isLayerMode;
    this.instNodeMat.depthWrite = write;
    for (const n of this.nodes.values()) {
      if (n.mesh) (n.mesh.material as THREE.ShaderMaterial).depthWrite = write;
    }
  }

  // ==================== InstancedMesh 容量管理 ====================

  /** 扩容（×2）：重建 InstancedMesh + 实例属性，拷贝旧数据，instIndex 不变 */
  private ensureCapacity(need: number): void {
    if (need <= this.capacity) return;
    const newCap = Math.max(this.capacity * 2, need);
    const geo = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(geo, this.makeInstancedNodeMat(), newCap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = this.activeCount;
    mesh.frustumCulled = false; // 实例散布范围广，关闭视锥剔除避免漏渲
    mesh.renderOrder = 2; // 卡片后于阴影渲染（2D 正视下透明排序距离相等，必须 renderOrder 分层）
    // SDF 阴影层：共享 geometry/实例属性，独立 instanceMatrix（z-2，quad 在 shader 外扩）
    const shadow = new THREE.InstancedMesh(geo, this.shadowMesh ? this.shadowMesh.material : this.makeShadowMat(), newCap);
    shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shadow.count = this.activeCount;
    shadow.frustumCulled = false;
    shadow.raycast = () => {}; // 阴影不参与拾取
    shadow.renderOrder = 1; // 阴影先渲染，卡片后渲染覆盖
    const sizeAttr = new THREE.InstancedBufferAttribute(new Float32Array(newCap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(newCap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const radiusAttr = new THREE.InstancedBufferAttribute(new Float32Array(newCap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const selectedAttr = new THREE.InstancedBufferAttribute(new Float32Array(newCap), 1).setUsage(THREE.DynamicDrawUsage);
    const hoverAttr = new THREE.InstancedBufferAttribute(new Float32Array(newCap), 1).setUsage(THREE.DynamicDrawUsage);
    const uvRectAttr = new THREE.InstancedBufferAttribute(new Float32Array(newCap * 4), 4).setUsage(THREE.DynamicDrawUsage); // T4R: 内容 uv 矩形
    geo.setAttribute('aSize', sizeAttr);
    geo.setAttribute('aColor', colorAttr);
    geo.setAttribute('aRadius', radiusAttr);
    geo.setAttribute('aSelected', selectedAttr);
    geo.setAttribute('aHover', hoverAttr);
    geo.setAttribute('aUvRect', uvRectAttr);
    // 拷贝旧数据（卡片 + 阴影双矩阵）
    if (this.instMesh) {
      for (let i = 0; i < this.activeCount; i++) {
        sizeAttr.setXY(i, this.instSizeAttr.getX(i), this.instSizeAttr.getY(i));
        colorAttr.setXYZ(i, this.instColorAttr.getX(i), this.instColorAttr.getY(i), this.instColorAttr.getZ(i));
        radiusAttr.setX(i, this.instRadiusAttr.getX(i));
        selectedAttr.setX(i, this.instSelectedAttr.getX(i));
        hoverAttr.setX(i, this.instHoverAttr.getX(i));
        uvRectAttr.setXYZW(i, this.instUvRectAttr.getX(i), this.instUvRectAttr.getY(i), this.instUvRectAttr.getZ(i), this.instUvRectAttr.getW(i)); // T4R
        const m = new THREE.Matrix4();
        this.instMesh.getMatrixAt(i, m);
        mesh.setMatrixAt(i, m);
        const ms = new THREE.Matrix4();
        this.shadowMesh.getMatrixAt(i, ms);
        shadow.setMatrixAt(i, ms);
      }
      mesh.instanceMatrix.needsUpdate = true;
      shadow.instanceMatrix.needsUpdate = true;
      this.scene.remove(this.instMesh);
      this.instMesh.geometry.dispose();
      (this.instMesh.material as THREE.Material).dispose();
      this.scene.remove(this.shadowMesh);
      this.shadowMesh.dispose();
    }
    this.instMesh = mesh;
    this.shadowMesh = shadow;
    this.instSizeAttr = sizeAttr;
    this.instColorAttr = colorAttr;
    this.instRadiusAttr = radiusAttr;
    this.instSelectedAttr = selectedAttr;
    this.instHoverAttr = hoverAttr;
    this.instUvRectAttr = uvRectAttr;
    this.capacity = newCap;
    this.scene.add(mesh);
    this.scene.add(shadow);
    if (this.activeCount >= 0) this.bindStyleUniformsSafe();
  }

  /** 扩容后重绑样式 uniform（首次构造时 styleUniforms 已就绪） */
  private bindStyleUniformsSafe(): void {
    if (this.styleUniforms) this.bindStyleUniforms();
  }

  /** 写实例变换（位置 + 尺寸，z 用于 3D 组分层偏移；同步写阴影层矩阵 z-2） */
  private setInstMatrix(idx: number, x: number, y: number, z: number, w: number, h: number): void {
    this.instDummy.position.set(x, y, z);
    this.instDummy.scale.set(w, h, 1);
    this.instDummy.updateMatrix();
    this.instMesh.setMatrixAt(idx, this.instDummy.matrix);
    // 阴影矩阵：同 XY 尺寸，z 下沉 2（CSS 语义：阴影在元素 z 序之下）
    this.instDummy.position.z = z - 2;
    this.instDummy.updateMatrix();
    this.shadowMesh.setMatrixAt(idx, this.instDummy.matrix);
    this.instMesh.instanceMatrix.needsUpdate = true;
    this.shadowMesh.instanceMatrix.needsUpdate = true;
    // 重置 raycast 包围球缓存（InstancedMesh.raycast 仅在 null 时惰性重算；
    // 不重置会导致 3D 组 Z 偏移后射线与旧球体不相交 → 拾取全 miss）
    this.instMesh.boundingSphere = null;
  }

  /** 槽位数据拷贝（swap-remove 用） */
  private copyInst(dst: number, src: number): void {
    this.instSizeAttr.setXY(dst, this.instSizeAttr.getX(src), this.instSizeAttr.getY(src));
    this.instColorAttr.setXYZ(dst, this.instColorAttr.getX(src), this.instColorAttr.getY(src), this.instColorAttr.getZ(src));
    this.instRadiusAttr.setXYZW(dst, this.instRadiusAttr.getX(src), this.instRadiusAttr.getY(src), this.instRadiusAttr.getZ(src), this.instRadiusAttr.getW(src));
    this.instSelectedAttr.setX(dst, this.instSelectedAttr.getX(src)); // 选中标记随槽位补位
    this.instSelectedAttr.needsUpdate = true;
    this.instHoverAttr.setX(dst, this.instHoverAttr.getX(src)); // hover 标记随槽位补位
    this.instHoverAttr.needsUpdate = true;
    this.instUvRectAttr.setXYZW(dst, this.instUvRectAttr.getX(src), this.instUvRectAttr.getY(src), this.instUvRectAttr.getZ(src), this.instUvRectAttr.getW(src)); // T4R: 内容 uv 随槽位补位
    this.instUvRectAttr.needsUpdate = true;
    const m = new THREE.Matrix4();
    this.instMesh.getMatrixAt(src, m);
    this.instMesh.setMatrixAt(dst, m);
    const ms = new THREE.Matrix4();
    this.shadowMesh.getMatrixAt(src, ms);
    this.shadowMesh.setMatrixAt(dst, ms);
    this.instMesh.instanceMatrix.needsUpdate = true;
    this.shadowMesh.instanceMatrix.needsUpdate = true;
    this.instMesh.boundingSphere = null; // 同上：实例位置变化后重算包围球
  }

  /** 节点位置写入（实例属性 + 3D 组 Z 偏移 + 节点自身浮动；图片节点直写 Mesh + 阴影层） */
  private setNodePos(n: V2Node, x: number, y: number): void {
    n.data.x = x;
    n.data.y = y;
    const z = this.nodeWorldZ(n);
    if (n.mesh) {
      n.mesh.position.set(x, y, z);
      n.imgShadow?.position.set(x, y, z - 2);
    } else this.setInstMatrix(n.instIndex, x, y, z, n.data.w, n.data.h);
  }

  /** 持久分层状态下新出现的组立即分配 Z 层（3D 中/退出后新增节点不落 z=0） */
  private ensureGroupLayer(gid: string | null): void {
    if (!gid || this.layerGroups.length === 0 || this.groupZOffsets.has(gid)) return;
    this.layerGroups.push(gid);
    this.groupZOffsets.set(gid, (this.layerGroups.length - 1) * ThreeCanvasV2.LAYER_SPREAD);
  }

  /**
   * 节点改属组（显式建组/入组的唯一入口：组由用户显式创建，节点不隐式建组）
   * gid 为 null 时移出组（回到根层 z=0）；组 Z 层、组框、边深度同步。
   */
  setNodeGroup(id: string, gid: string | null): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.data.groupId = gid;
    this.ensureGroupLayer(gid);
    this.syncInstGroupZ();
    this.updateGroups();
    this.syncAllEdges();
    this.syncNode(n);
  }

  // ==================== 节点内容纹理（T4R 全面 Three.js） ====================

  /** 注入内容图集纹理（host 侧 NodeContentAtlas 的 canvas 纹理；null 关闭内容层） */
  setContentAtlas(tex: THREE.Texture | null): void {
    const u = (this.instMesh.material as THREE.ShaderMaterial).uniforms.uAtlas;
    if (u) u.value = tex;
    this.markDirty();
  }

  /** 写节点内容 uv 矩形（atlas 归一化 uv；null 清除内容）；instIndex<0 的图片节点走独立 Mesh 不受影响 */
  setNodeContentRect(id: string, uvRect: [number, number, number, number] | null): void {
    const n = this.nodes.get(id);
    if (!n || n.instIndex < 0) return;
    const a = this.instUvRectAttr;
    if (uvRect) a.setXYZW(n.instIndex, uvRect[0], uvRect[1], uvRect[2], uvRect[3]);
    else a.setXYZW(n.instIndex, 0, 0, 0, 0);
    a.needsUpdate = true;
    this.markDirty();
  }

  // ==================== 节点 CRUD ====================

  addNode(opts: { id?: string; x: number; y: number; w: number; h: number; color?: string; texture?: THREE.Texture; groupId?: string | null; label?: string }): string {
    const id = opts.id ?? `n${Math.random().toString(36).slice(2, 9)}`;
    if (this.activeCount >= this.capacity) this.ensureCapacity(this.capacity * 2);
    const idx = this.activeCount++;
    this.instMesh.count = this.activeCount;
    this.shadowMesh.count = this.activeCount;
    // 圆角 clamp 上限：短边 1/4（还原 CSS 浏览器 clamp 行为）；实际半径 = min(该上限, GUI 全局半径)
    const radius = Math.min(opts.w, opts.h) / 4;
    // 颜色空间：ColorManagement 默认把 sRGB hex 转 Linear 工作空间，而 ShaderMaterial 直输
    // gl_FragColor 不走 three 的 linear→sRGB 输出转换 → 转回 sRGB 原值，保证所见即本色
    const color = new THREE.Color(opts.color ?? '#ffffff').convertLinearToSRGB();
    this.ensureGroupLayer(opts.groupId ?? null);
    const z = opts.groupId ? (this.groupZOffsets.get(opts.groupId) ?? 0) : 0;
    this.setInstMatrix(idx, opts.x, opts.y, z, opts.w, opts.h);
    this.instSizeAttr.setXY(idx, opts.w, opts.h);
    this.instColorAttr.setXYZ(idx, color.r, color.g, color.b);
    this.instRadiusAttr.setXYZW(idx, radius, radius, radius, radius);
    this.instSizeAttr.needsUpdate = true;
    this.instColorAttr.needsUpdate = true;
    this.instRadiusAttr.needsUpdate = true;
    const n: V2Node = { id, instIndex: idx, data: { x: opts.x, y: opts.y, w: opts.w, h: opts.h, color: opts.color ?? '#161616', groupId: opts.groupId ?? null, label: opts.label ?? id } };
    this.nodes.set(id, n);
    this.nodeByInst.set(idx, n);
    this.updateGroups();
    this.markDirty();
    return id;
  }

  /** 程序化节点数据同步（适配层 store→引擎；不触发 onNodeMove 防回环） */
  updateNode(id: string, patch: { x?: number; y?: number; w?: number; h?: number; color?: string; label?: string; groupId?: string | null }): void {
    const n = this.nodes.get(id);
    if (!n) return;
    const d = n.data;
    if (patch.x !== undefined) d.x = patch.x;
    if (patch.y !== undefined) d.y = patch.y;
    if (patch.w !== undefined) d.w = patch.w;
    if (patch.h !== undefined) d.h = patch.h;
    if (patch.color !== undefined) d.color = patch.color;
    if (patch.label !== undefined) d.label = patch.label;
    if (patch.groupId !== undefined && patch.groupId !== d.groupId) {
      d.groupId = patch.groupId;
      this.ensureGroupLayer(patch.groupId);
    }
    if (n.instIndex >= 0) {
      this.setInstMatrix(n.instIndex, d.x, d.y, this.nodeWorldZ(n), d.w, d.h);
      this.instSizeAttr.setXY(n.instIndex, d.w, d.h);
      if (patch.color !== undefined) {
        const c = new THREE.Color(patch.color).convertLinearToSRGB();
        this.instColorAttr.setXYZ(n.instIndex, c.r, c.g, c.b);
      }
      this.instSizeAttr.needsUpdate = true;
      this.instColorAttr.needsUpdate = true;
    } else if (n.mesh) {
      n.mesh.position.set(d.x, d.y, this.nodeWorldZ(n));
      n.mesh.scale.set(d.w, d.h, 1);
      n.imgShadow?.position.set(d.x, d.y, this.nodeWorldZ(n) - 2);
      n.imgShadow?.scale.set(d.w, d.h, 1);
      (n.mesh.material as THREE.ShaderMaterial).uniforms.uSize!.value.set(d.w, d.h);
      (n.imgShadow?.material as THREE.ShaderMaterial | undefined)?.uniforms.uSize!.value.set(d.w, d.h);
    }
    this.syncInstGroupZ();
    this.updateGroups();
    this.updateEdgesFor(id);
    this.markDirty();
  }

  /** 查询节点（适配层 diff 用） */
  getNode(id: string): V2Node | undefined {
    return this.nodes.get(id);
  }

  /**
   * 图片节点：独立 Mesh + 纹理（demo 阶段；3w 规模正式化走 TextureAtlas 进 InstancedMesh）。
   * 纹理保持原始像素分辨率不压缩，colorSpace 保持 NoColorSpace 直输本色（sRGB 原值采样直出，
   * 与纯色节点手动 convertLinearToSRGB 同一语义；若设 SRGBColorSpace，WebGL2 硬件 SRGB8_ALPHA8
   * 自动解码为 linear，而 ShaderMaterial 无 colorspace_fragment 反向 encode → 输出变暗）。
   * 与纯色节点享受同等增益：SDF 圆角裁剪 + 外描边三态 + SDF 解析 box-shadow（独立阴影层）。
   */
  addImageNode(opts: { id?: string; x: number; y: number; w: number; h: number; texture: THREE.Texture; groupId?: string | null; label?: string }): string {
    const id = opts.id ?? `img${Math.random().toString(36).slice(2, 9)}`;
    this.ensureGroupLayer(opts.groupId ?? null);
    const z = opts.groupId ? (this.groupZOffsets.get(opts.groupId) ?? 0) : 0;
    const radius = Math.min(opts.w, opts.h) / 4; // 圆角 clamp 上限（同 addNode：短边 1/4）
    // 卡片：纹理 + SDF 圆角 + 外描边三态（uSelected/uHovered 独立 uniform，选中/悬停时写 1 个 float）
    const mat = new THREE.ShaderMaterial({
      vertexShader: IMG_VERT,
      fragmentShader: IMG_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: opts.texture },
        uSize: { value: new THREE.Vector2(opts.w, opts.h) },
        uRadius: { value: new THREE.Vector4(radius, radius, radius, radius) },
        uCardPad: { value: DEFAULT_STYLE.borderWidth + 2 },
        // 共享 styleUniforms 引用：setStyle 调节即时生效（颜色/宽度/虚线/透明度）
        uBorderW: this.styleUniforms.uBorderW,
        uDashPeriod: this.styleUniforms.uDashPeriod,
        uBorderDashRatio: this.styleUniforms.uBorderDashRatio,
        uBorderDefault: this.styleUniforms.uBorderDefault,
        uBorderHover: this.styleUniforms.uBorderHover,
        uSelectColor: this.styleUniforms.uSelectColor,
        opacity: this.styleUniforms.opacity,
        uSelected: { value: 0 },
        uHovered: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.position.set(opts.x, opts.y, z);
    mesh.scale.set(opts.w, opts.h, 1);
    mesh.userData.nodeId = id;
    mesh.renderOrder = 2; // 卡片后于阴影渲染（与实例卡片分层一致）
    this.scene.add(mesh);
    // 阴影层：独立 quad（z-2），SDF 解析 box-shadow，共享 styleUniforms 的阴影参数
    const shadowMat = new THREE.ShaderMaterial({
      vertexShader: IMG_SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSize: { value: new THREE.Vector2(opts.w, opts.h) },
        uRadius: { value: new THREE.Vector4(radius, radius, radius, radius) },
        uHovered: { value: 0 },
        uOffset: this.styleUniforms.uShadowOffset,
        uBlur: this.styleUniforms.uBlur,
        uSpread: this.styleUniforms.uSpread,
        uOpacity: this.styleUniforms.uOpacity,
        uPad: this.styleUniforms.uPad,
        uShadowColor: this.styleUniforms.uShadowColor,
        uHoverOffset: this.styleUniforms.uHoverOffset,
        uHoverBlur: this.styleUniforms.uHoverBlur,
        uHoverSpread: this.styleUniforms.uHoverSpread,
        uHoverOpacity: this.styleUniforms.uHoverOpacity,
      },
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    shadow.position.set(opts.x, opts.y, z - 2);
    shadow.scale.set(opts.w, opts.h, 1);
    shadow.raycast = () => {}; // 阴影不参与拾取
    shadow.renderOrder = 1; // 阴影先渲染
    this.scene.add(shadow);
    const n: V2Node = { id, instIndex: -1, mesh, imgShadow: shadow, data: { x: opts.x, y: opts.y, w: opts.w, h: opts.h, color: '#ffffff', groupId: opts.groupId ?? null, label: opts.label ?? id } };
    this.nodes.set(id, n);
    this.updateGroups();
    this.markDirty();
    return id;
  }

  removeNode(id: string): void {
    const n = this.nodes.get(id);
    if (!n) return;
    // swap-remove：末尾活跃实例补位，instIndex 不变式保持紧凑（仅实例节点，图片节点无槽位）
    if (n.instIndex >= 0) {
      const lastIdx = this.activeCount - 1;
      if (n.instIndex !== lastIdx) {
        this.copyInst(n.instIndex, lastIdx);
        const lastNode = this.nodeByInst.get(lastIdx);
        if (lastNode) {
          lastNode.instIndex = n.instIndex;
          this.nodeByInst.set(n.instIndex, lastNode);
        }
      }
      this.nodeByInst.delete(lastIdx);
      this.activeCount--;
      this.instMesh.count = this.activeCount;
      this.shadowMesh.count = this.activeCount;
    }
    this.nodes.delete(id);
    // 图片节点：移除 Mesh + 阴影层 + 释放纹理/几何
    if (n.mesh) {
      this.scene.remove(n.mesh);
      const mapTex = (n.mesh.material as THREE.ShaderMaterial).uniforms.uMap?.value as THREE.Texture | undefined;
      mapTex?.dispose();
      (n.mesh.material as THREE.Material).dispose();
      n.mesh.geometry.dispose();
    }
    if (n.imgShadow) {
      this.scene.remove(n.imgShadow);
      (n.imgShadow.material as THREE.Material).dispose();
      n.imgShadow.geometry.dispose();
    }
    // 清理关联边
    for (let i = this.edges.length - 1; i >= 0; i--) {
      const e = this.edges[i];
      if (!e) continue;
      if (e.a === id || e.b === id) {
        this.edgeRoot.remove(e.glow, e.line, e.pinGroup);
        e.glow.geometry.dispose();
        (e.glow.material as THREE.Material).dispose();
        e.line.geometry.dispose();
        (e.line.material as THREE.Material).dispose();
        this.edges.splice(i, 1);
      }
    }
    if (this.selected?.id === id) this.select(null);
    this.updateGroups();
  }

  clear(): void {
    // 清理所有边
    for (const e of this.edges) {
      this.edgeRoot.remove(e.glow, e.line, e.pinGroup);
      e.glow.geometry.dispose();
      (e.glow.material as THREE.Material).dispose();
      e.line.geometry.dispose();
      (e.line.material as THREE.Material).dispose();
    }
    this.edges.length = 0;
    for (const id of [...this.nodes.keys()]) this.removeNode(id);
    this.markDirty();
  }

  /** hover 标记切换（只在变化时写 1~2 个 float；实例节点走 aHover 属性，图片节点走 uHovered uniform） */
  private setHover(id: string | null): void {
    const next = id ? this.nodes.get(id) ?? null : null;
    if (next === this.hoverNode) return;
    if (this.hoverNode && this.hoverNode.instIndex >= 0) this.instHoverAttr.setX(this.hoverNode.instIndex, 0);
    if (next && next.instIndex >= 0) this.instHoverAttr.setX(next.instIndex, 1);
    this.instHoverAttr.needsUpdate = true;
    // 图片节点（独立材质）：卡片描边 hover 态 + 阴影增强同源切换
    if (this.hoverNode?.mesh) {
      (this.hoverNode.mesh.material as THREE.ShaderMaterial).uniforms.uHovered!.value = 0;
      const shU = (this.hoverNode.imgShadow?.material as THREE.ShaderMaterial | undefined)?.uniforms.uHovered;
      if (shU) shU.value = 0;
    }
    if (next?.mesh) {
      (next.mesh.material as THREE.ShaderMaterial).uniforms.uHovered!.value = 1;
      const shU = (next.imgShadow?.material as THREE.ShaderMaterial | undefined)?.uniforms.uHovered;
      if (shU) shU.value = 1;
    }
    this.hoverNode = next;
    this.updateEdgeStates(); // hover 变化 → 关联边活跃态联动（选中/悬停高亮）
  }

  select(id: string | null): void {
    const prev = this.selected;
    this.selected = id ? this.nodes.get(id) ?? null : null;
    // 选中描边：实例节点走实例属性标记（只写 1~2 个 float），图片节点走 uSelected uniform；
    // 描边由卡片 shader 外圈环带绘制（CSS outline 语义），自动跟随节点位置/尺寸/组 Z，无独立对象
    if (prev && prev.instIndex >= 0) { this.instSelectedAttr.setX(prev.instIndex, 0); }
    if (this.selected && this.selected.instIndex >= 0) { this.instSelectedAttr.setX(this.selected.instIndex, 1); }
    this.instSelectedAttr.needsUpdate = true;
    if (prev?.mesh) (prev.mesh.material as THREE.ShaderMaterial).uniforms.uSelected!.value = 0;
    if (this.selected?.mesh) (this.selected.mesh.material as THREE.ShaderMaterial).uniforms.uSelected!.value = 1;
    if (this.isLayerMode) {
      if (this.selected) {
        this.proxyObj.position.set(this.selected.data.x, this.selected.data.y, this.nodeWorldZ(this.selected));
        this.control.attach(this.proxyObj);
      } else {
        this.control.detach();
      }
    }
    this.updateEdgeStates(); // 选中变化 → 关联边活跃态联动
  }

  /** 节点数据变更后同步：组框/边/坐标轴代理/回调（选中描边已并入卡片 shader，无需跟随逻辑） */
  private syncNode(n: V2Node): void {
    this.updateGroups();
    this.updateEdgesFor(n.id); // 连线跟随节点移动
    // 3D 模式坐标轴代理跟随节点（POC gizmo attach 实体自动跟随，代理模式需手动同步；z 含浮动偏移）
    if (this.isLayerMode && this.selected === n && this.control.object === this.proxyObj) {
      this.proxyObj.position.set(n.data.x, n.data.y, this.nodeWorldZ(n));
    }
    this.onNodeMove?.(n.id, n.data.x, n.data.y);
  }

  /** 节点世界 Z（反馈 11：组偏移 + 节点自身浮动偏移；所有 z 计算单一事实源，含代理/实例/边端点） */
  private nodeWorldZ(n: V2Node): number {
    return (n.data.groupId ? (this.groupZOffsets.get(n.data.groupId) ?? 0) : 0) + (this.nodeFloatZ.get(n.id) ?? 0);
  }

  /** 组选中（反馈 11：SDF 组框选中态由 uSelected uniform 驱动——红晕 + 选中描边色全在 shader 内） */
  private selectGroup(gid: string | null): void {
    const prev = this.selectedGroup;
    this.selectedGroup = gid;
    for (const [id, v] of this.groups) {
      (v.mesh.material as THREE.ShaderMaterial).uniforms.uSelected!.value = id === gid ? 1 : 0;
    }
    // T7: 选中态标题色（DOM：isSelected ? 红 0.95 : 主题默认），纹理重绘
    if (prev && prev !== gid) { const v = this.groups.get(prev); if (v) this.refreshGroupTitleTexture(v, prev); }
    if (gid) { const v = this.groups.get(gid); if (v) this.refreshGroupTitleTexture(v, gid); }
    if (this.isLayerMode) {
      if (gid) this.attachGroupGizmo();
      else if (this.control.object === this.proxyGroupObj) this.control.detach();
    }
    this.onGroupClick?.(gid);
    this.markDirty();
  }

  /** 3D 模式坐标轴跟随选中组（POC attachSelection：控制柄显示在组中心） */
  private attachGroupGizmo(): void {
    const gid = this.selectedGroup;
    if (!gid) return;
    let cx = 0, cy = 0, count = 0;
    for (const n of this.nodes.values()) {
      if (n.data.groupId === gid) { cx += n.data.x; cy += n.data.y; count++; }
    }
    if (count === 0) return;
    cx /= count; cy /= count;
    const zOff = this.groupZOffsets.get(gid) ?? 0;
    this.proxyGroupObj.position.set(cx, cy, zOff);
    this.gizmoGroupBase = { x: cx, y: cy, z: zOff };
    this.control.attach(this.proxyGroupObj);
  }

  /**
   * 拾取组框背景（节点未命中时调用；组框在节点之下，节点优先）。
   * 修复反馈 11 组选中 BUG：多组重叠/共面时 hits[0] 是拾取顺序（=创建顺序）而非视觉层级 →
   * 按 z 降序（3D 高 Z 组视觉在上）+ 同 z 后创建优先（子组/后组覆盖先组）排序取第一个。
   */
  private pickGroup(sx: number, sy: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.tmpV2.set(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.tmpV2, this.camera);
    const targets: THREE.Object3D[] = [];
    for (const v of this.groups.values()) if (v.mesh.visible) targets.push(v.mesh);
    if (targets.length === 0) return null;
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    // 视觉层级判定：z 降序（3D 下高 Z 组在上）；同 z（2D 共面）后创建者优先
    const order = [...this.groups.keys()]; // Map 插入序 = 创建序
    hits.sort((a, b) => {
      const za = a.object.position.z, zb = b.object.position.z;
      if (za !== zb) return zb - za;
      const ia = order.indexOf(a.object.userData.groupId as string);
      const ib = order.indexOf(b.object.userData.groupId as string);
      return ib - ia; // 后创建（index 大）优先
    });
    const hit = hits[0];
    if (!hit) return null;
    return (hit.object.userData.groupId as string) ?? null;
  }

  // ==================== 组框 ====================

  /**
   * 组标题纹理画布（T7 与 DOM 版 GroupItem 标题栏 1:1：28px 高、11px/600、左对齐 padding 8px、
   * 文字色直绘（选中红/主题色/titleColor 覆盖），背景 = 画布背景色盖住组框虚线；
   * 画布宽跟随组宽（dpr 缩放，clamp 4096 防爆显存），材质 color 恒白不染背景）
   */
  private makeGroupTitleTexture(opts: { text: string; widthPx: number; color: string; bg: string }): THREE.Texture {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(128, Math.min(Math.ceil(opts.widthPx * dpr), 4096));
    const h = Math.ceil(GROUP_TITLE_H * dpr);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    // 画布背景色打底盖住组框轮廓（复刻 title 的 var(--zeroexo-canvas-bg)）
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, w, h);
    // T7: 字体栈与 DOM 版 --font-body 同源（DM Sans 优先，中文回退 system-ui），保证字形像素级一致
    ctx.font = `600 ${11 * dpr}px 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
    ctx.fillStyle = opts.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.text, 8 * dpr, h / 2);
    const t = new THREE.CanvasTexture(c);
    // NoColorSpace 直通：CanvasTexture 默认 sRGB 编码数据，ShaderMaterial/MeshBasicMaterial 输出本色
    return t;
  }

  /** 组标题纹理重绘（宽跟随组宽；文字色 = titleColor 覆盖 ?? 选中红 ?? 主题默认色） */
  private refreshGroupTitleTexture(v: GroupVisual, gid: string): void {
    const ext = this.externalGroupBounds.get(gid);
    const w = ext ? ext.w : 128;
    const o = this.externalGroupStyles.get(gid);
    const color = o?.titleColor ?? (this.selectedGroup === gid ? 'rgba(233,69,96,0.95)' : (this.groupIsLight ? '#1c1917' : 'rgba(245,245,244,0.9)'));
    const mat = v.title.material as THREE.MeshBasicMaterial;
    const old = mat.map;
    mat.map = this.makeGroupTitleTexture({ text: ext?.title ?? gid, widthPx: w, color, bg: this.groupTitleBg });
    mat.needsUpdate = true;
    if (old) old.dispose();
  }

  /**
   * 创建组框可视化（反馈 11：组 = 节点 SDF 同源变体——背景/虚线描边/选中红晕/hover/阴影全在 shader 内，
   * 替代原 bg+glow+Line2 独立对象拼装；mesh.scale 同步 uSize 供 raycast 拾取）。
   * 共享 uniform 引用 groupSharedUniforms（setGroupStyle 直改即时生效），per-组 uniform 由 updateGroups 直写。
   */
  private createGroupVisual(gid: string): GroupVisual {
    const mat = new THREE.ShaderMaterial({
      vertexShader: GROUP_VERT,
      fragmentShader: GROUP_FRAG,
      transparent: true,
      depthWrite: false, // 组框半透明层（同节点阴影：不写深度，2D/3D 均靠层序）
      side: THREE.DoubleSide, // 3D 下方视角组框背面可见（拾取/渲染双保证）
      uniforms: {
        uSize: { value: new THREE.Vector2(1, 1) },
        uPad: { value: 24 },
        uSelected: { value: 0 },
        uHover: { value: 0 },
        uDashes: { value: 20 },
        uDashRatio: { value: 0.66 },
        uOutlineOffset: { value: 0 },
        uBorderW: { value: 1 },
        uGlowR: { value: 4.5 },
        uShadowBlur: { value: 6 },
        uShadowOffset: { value: new THREE.Vector2(0, 0) },
        // 共享值对象（GUI 驱动参数）
        uRadius: this.groupSharedUniforms.uRadius,
        opacity: this.groupSharedUniforms.opacity,
        uBgColor: this.groupSharedUniforms.uBgColor,
        uLineOpacity: this.groupSharedUniforms.uLineOpacity,
        uLineColor: this.groupSharedUniforms.uLineColor,
        uSelectColor: this.groupSharedUniforms.uSelectColor,
        uGlowOpacity: this.groupSharedUniforms.uGlowOpacity,
        uShadowOpacity: this.groupSharedUniforms.uShadowOpacity,
        uShadowColor: this.groupSharedUniforms.uShadowColor,
      },
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = 0; // 组框层最底（节点/阴影之下）
    mesh.userData.groupId = gid;
    const title = new THREE.Mesh(
      new THREE.PlaneGeometry(1, GROUP_TITLE_H),
      new THREE.MeshBasicMaterial({ map: this.makeGroupTitleTexture({ text: gid, widthPx: 128, color: this.groupIsLight ? '#1c1917' : 'rgba(245,245,244,0.9)', bg: this.groupTitleBg }), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    title.renderOrder = 0;
    this.groupRoot.add(mesh, title);
    const v: GroupVisual = { mesh, title };
    this.groups.set(gid, v);
    return v;
  }

  /**
   * 组框更新（反馈 11：SDF 同源后全部参数化——uSize/uPad/虚线周期/线宽/红晕/阴影直写 uniform，
   * 零对象重建；dash 周期随本组尺寸换算保持屏幕像素恒定：周长 ≈ 2(w+h) - 8r + 2πr）。
   */
  private updateGroups(): void {
    // T7: 生产 three 模式 2D 下组框由 DOM GroupLayer 渲染（像素级 1:1 + 徽标/handles/pin/重命名全交互），
    // 引擎不渲染组框 SDF，避免双重绘制；3D 模式（isLayerMode）恢复引擎 SDF 渲染
    if (!this.isLayerMode && this.groupRenderMode === 'dom') return;
    // 数据源：外部注入 bounds（T7 adapter 用 DOM 同源 computeGroupBounds 计算后注入，几何 1:1）优先；
    // 叶子聚合仅作为 demo 直连引擎（无 adapter）时的回退
    const byGroup = new Map<string, { minX: number; minY: number; maxX: number; maxY: number; count: number }>();
    for (const n of this.nodes.values()) {
      const gid = n.data.groupId;
      if (!gid || this.externalGroupBounds.has(gid)) continue;
      let b = byGroup.get(gid);
      if (!b) { b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 }; byGroup.set(gid, b); }
      b.minX = Math.min(b.minX, n.data.x - n.data.w / 2);
      b.maxX = Math.max(b.maxX, n.data.x + n.data.w / 2);
      b.minY = Math.min(b.minY, n.data.y - n.data.h / 2);
      b.maxY = Math.max(b.maxY, n.data.y + n.data.h / 2);
      b.count++;
    }
    // 隐藏/移除已空组（外部记录也作为存活依据）
    for (const [gid, v] of this.groups) {
      if (!byGroup.has(gid) && !this.externalGroupBounds.has(gid)) {
        this.groupRoot.remove(v.mesh, v.title);
        (v.mesh.material as THREE.Material).dispose();
        v.mesh.geometry.dispose();
        const tm = v.title.material as THREE.MeshBasicMaterial;
        tm.map?.dispose();
        tm.dispose();
        v.title.geometry.dispose();
        this.groups.delete(gid);
        // 组已空：清除选中态（POC：空组隐藏）
        if (this.selectedGroup === gid) this.selectGroup(null);
      }
    }
    // 屏幕像素恒定换算（依赖视口缩放 k）：线宽/红晕/阴影 blur 世界单位 = px / k；quad 外扩覆盖全部尾部
    const k = this.vp.k;
    const uBorderW = this.groupStyle.lineWidth / k;
    const uGlowR = 4 / k;            // T7: CSS 选中红晕 box-shadow 0 0 0 4px（硬环宽度，2D 1:1）
    const uShadowBlur = 6 / k;       // T7: CSS 空闲阴影 blur 6px
    const uShadowOffsetY = 2 / k;    // T7: CSS 阴影垂直偏移 2px（0 2px 6px）
    const uOutlineOffset = 3 / k;    // T7: DOM outlineOffset 内置默认 3px
    const uPad = Math.max(uBorderW + uOutlineOffset + 2, uGlowR * 1.3, uShadowBlur * 2 + 2);
    // T7: 组框圆角反缩放（DOM calc(2px * invK) 屏幕恒定 2px；共享 uniform 值直改全局生效）
    this.groupSharedUniforms.uRadius.value = GROUP_RADIUS / k;
    // T7: 组标题反缩放（DOM 标题栏高 28px*invK / 上缘上方 (28+2)px*invK → 2D 屏幕恒定；3D 透视无恒定语义保持世界单位）
    const titleScaleY = this.isLayerMode ? 1 : 1 / k;
    const titleOffsetY = this.isLayerMode ? GROUP_TITLE_H / 2 + 2 : (GROUP_TITLE_H / 2 + 2) / k;
    const dashSum = this.groupStyle.dashPx + this.groupStyle.gapPx;
    // 外部注入组（几何 = adapter 同源计算，直接消费 rect；标题 1:1 定位在框上缘上方）
    for (const [gid, ext] of this.externalGroupBounds) {
      const zOff = this.groupZOffsets.get(gid) ?? 0;
      let v = this.groups.get(gid);
      if (!v) v = this.createGroupVisual(gid);
      const w = ext.w, h = ext.h;
      const cx = ext.x + w / 2, cy = ext.y + h / 2;
      // dash 周期随本组尺寸换算（屏幕像素恒定）：周长 ≈ 2(w+h) - 8r + 2πr
      const perim = 2 * (w + h) - 8 * GROUP_RADIUS + 2 * Math.PI * GROUP_RADIUS;
      const u = (v.mesh.material as THREE.ShaderMaterial).uniforms;
      (u.uSize!.value as THREE.Vector2).set(w, h);
      u.uDashes!.value = (perim * k) / dashSum;
      u.uDashRatio!.value = this.groupStyle.dashPx / dashSum;
      u.uBorderW!.value = uBorderW;
      u.uOutlineOffset!.value = uOutlineOffset;
      u.uGlowR!.value = uGlowR;
      u.uShadowBlur!.value = uShadowBlur;
      (u.uShadowOffset!.value as THREE.Vector2).set(0, uShadowOffsetY);
      u.uPad!.value = uPad;
      this.applyGroupStyleOverride(v, gid, k);
      v.mesh.position.set(cx, cy, zOff - 5); // 组框在节点/阴影之下（原 bg z 语义）
      v.mesh.scale.set(w, h, 1);             // 同步 scale：SDF 外扩由 shader 顶点计算，scale 仅供 raycast 包围盒
      // 标题 1:1（DOM：top: -(28+2)px 相对框上缘、高 28 → 中心 y = bounds.y - 16；全宽跟随组宽）
      // T7: 2D 屏幕恒定反缩放（高 28px、偏移 30px），3D 透视保持世界单位
      v.title.scale.set(w, titleScaleY, 1);
      v.title.position.set(cx, ext.y - titleOffsetY, zOff - 3);
    }
    // demo 回退（叶子聚合，几何为简化包围盒 ± GROUP_PAD，仅无 adapter 直连引擎时可见）
    for (const [gid, b] of byGroup) {
      const zOff = this.groupZOffsets.get(gid) ?? 0;
      let v = this.groups.get(gid);
      if (!v) v = this.createGroupVisual(gid);
      const minX = b.minX - GROUP_PAD, maxX = b.maxX + GROUP_PAD;
      const minY = b.minY - GROUP_PAD, maxY = b.maxY + GROUP_PAD;
      const w = maxX - minX, h = maxY - minY;
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      // dash 周期随本组尺寸换算（屏幕像素恒定）：周长 ≈ 2(w+h) - 8r + 2πr
      const perim = 2 * (w + h) - 8 * GROUP_RADIUS + 2 * Math.PI * GROUP_RADIUS;
      const u = (v.mesh.material as THREE.ShaderMaterial).uniforms;
      (u.uSize!.value as THREE.Vector2).set(w, h);
      u.uDashes!.value = (perim * k) / dashSum;
      u.uDashRatio!.value = this.groupStyle.dashPx / dashSum;
      u.uBorderW!.value = uBorderW;
      u.uOutlineOffset!.value = uOutlineOffset;
      u.uGlowR!.value = uGlowR;
      u.uShadowBlur!.value = uShadowBlur;
      (u.uShadowOffset!.value as THREE.Vector2).set(0, uShadowOffsetY);
      u.uPad!.value = uPad;
      v.mesh.position.set(cx, cy, zOff - 5); // 组框在节点/阴影之下（原 bg z 语义）
      v.mesh.scale.set(w, h, 1);             // 同步 scale：SDF 外扩由 shader 顶点计算，scale 仅供 raycast 包围盒
      v.title.scale.set(w, titleScaleY, 1);
      // demo 标题同 1:1 语义：框上缘上方 2px 起（中心 y = minY - GROUP_PAD - H/2 - 2）
      v.title.position.set(cx, minY - titleOffsetY, zOff - 3);
    }
  }

  /** T7: per-组样式覆盖（组节点字段 + GroupDefaults 解析结果 → uniform 直写；未覆盖字段保持共享默认） */
  private applyGroupStyleOverride(v: GroupVisual, gid: string, k: number): void {
    const o = this.externalGroupStyles.get(gid);
    if (!o) return;
    const u = (v.mesh.material as THREE.ShaderMaterial).uniforms;
    if (o.backgroundColor) {
      const c = parseCssColor(o.backgroundColor, 1);
      (u.uBgColor!.value as THREE.Color).setRGB(c.r, c.g, c.b).convertLinearToSRGB();
      u.opacity!.value = c.a * (o.opacity ?? 1);
    } else if (o.opacity !== undefined) {
      u.opacity!.value = this.groupStyle.bgOpacity * o.opacity;
    }
    if (o.borderRadius !== undefined) {
      // per-组圆角：替换共享引用为独立值（不污染其他组），清除时由 setGroupStyleOverride(null) 还原
      // T7: DOM calc(borderRadius px * invK) 语义 → 世界单位 = px / k（2D 屏幕恒定）
      if (!v.mesh.userData.styleOverride) {
        u.uRadius = { value: o.borderRadius / k };
        v.mesh.userData.styleOverride = true;
      }
      u.uRadius!.value = o.borderRadius / k;
    }
    if (o.outlineColor) {
      const c = parseCssColor(o.outlineColor, 1);
      (u.uLineColor!.value as THREE.Color).setRGB(c.r, c.g, c.b).convertLinearToSRGB();
      u.uLineOpacity!.value = c.a * (o.opacity ?? 1);
    }
    if (o.outlineWidth !== undefined) u.uBorderW!.value = o.outlineWidth / k;
    if (o.outlineType === 'solid') u.uDashRatio!.value = 1;
    if (o.outlineOffset !== undefined) u.uOutlineOffset!.value = o.outlineOffset / k;
  }

  // ==================== 边 / PIN ====================

  private edges: { id: string; glow: Line2; line: Line2; pinGroup: THREE.Group; a: string; b: string }[] = [];

  /**
   * PIN 复刻（纯 3D 复原，还原 PinView 空心圆环 + "✚" 风格）
   * - 单 quad + SDF shader：主圆环 + 加号 + 外部虚线环 + hover 光晕（fwidth AA，无锯齿）
   * - 世界单位固定尺寸，3D 模式 loop 中 billboard 朝向相机（透视下保持正圆）
   * - 整体 Group 贴节点边缘外侧（PIN_OUTSET 保持距离）
   */
  private makePin(color: number, opts?: { glow?: boolean }): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      vertexShader: PIN_VERT,
      fragmentShader: PIN_FRAG,
      defines: {
        PIN_R: PIN_R.toFixed(1),
        PIN_BORDER: PIN_BORDER.toFixed(1),
        PIN_R_OUT: (PIN_R * 1.6).toFixed(1),
      },
      uniforms: {
        uColor: { value: new THREE.Color(color).convertLinearToSRGB() },
        uGlow: { value: opts?.glow ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(PIN_R * 4.8, PIN_R * 4.8), mat);
    quad.renderOrder = 3; // 边层（PIN 在节点之上）
    quad.userData.pinQuad = true; // loop 中 3D billboard 标记
    g.add(quad);
    return g;
  }

  /** 贝塞尔采样（与原始 edge-layer bezierPath 一致的三次贝塞尔；z 在两端点间插值，3D 分层下连线跟随组 Z） */
  private sampleBezier(ax: number, ay: number, az: number, bx: number, by: number, bz: number, segments: number): number[] {
    const dx = Math.abs(bx - ax);
    // 控制偏移：与原项目 EdgeLayer 一致 max(40, dx*0.5)
    const offset = Math.max(40, dx * 0.5);
    const c1x = ax + offset, c1y = ay;
    const c2x = bx - offset, c2y = by;
    const pts: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const mt = 1 - t;
      const x = mt * mt * mt * ax + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * bx;
      const y = mt * mt * mt * ay + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * by;
      pts.push(x, y, az + (bz - az) * t + 1); // z 沿曲线插值 + 1 略高于节点面
    }
    return pts;
  }

  /** 贝塞尔采样点累计长度（世界单位，活跃虚线周期换算用） */
  private bezierLen(positions: number[]): number {
    let len = 0;
    for (let i = 3; i < positions.length; i += 3) {
      const x0 = positions[i - 3] ?? 0;
      const y0 = positions[i - 2] ?? 0;
      const x1 = positions[i] ?? 0;
      const y1 = positions[i + 1] ?? 0;
      len += Math.hypot(x1 - x0, y1 - y0);
    }
    return len;
  }

  /**
   * 连线复刻（还原 EdgeLayer SVG 风格，双态）:
   * - 非活跃：单层主线（1.5px #ffffff 0.55 实线），辉光层隐藏（原项目合并 path）
   * - 活跃：辉光底层（7px 0.35 #e94560 高斯）+ 主线（2.5px #e94560 静态虚线 16+80，去脉冲）
   * - 两端 PIN 空心圆环 + 加号 + 虚线外环（SDF shader，AA 补偿）
   * - 端点连 PIN 圆心（PIN 圆心在节点边缘外侧 PIN_OUTSET，保持距离）
   */
  addEdge(aId: string, bId: string, opts?: { color?: number; id?: string }): void {
    const a = this.nodes.get(aId), b = this.nodes.get(bId);
    if (!a || !b) return;
    const color = opts?.color ?? 0xffffff;
    const edgeId = opts?.id ?? `${aId}|${bId}`;
    // PIN 位置：圆心在节点边缘外侧 PIN_OUTSET（与原项目 pinSize/2 约束一致，保持距离）
    const ax = a.data.x + a.data.w / 2 + PIN_OUTSET, ay = a.data.y;
    const bx = b.data.x - b.data.w / 2 - PIN_OUTSET, by = b.data.y;
    const za = this.nodeWorldZ(a);
    const zb = this.nodeWorldZ(b);
    // 贝塞尔采样（z 跟随两端点组偏移；段数 = bezierSegments，自适应降级链可减半）
    const positions = this.sampleBezier(ax, ay, za, bx, by, zb, this.bezierSegments);
    // 辉光底层（活跃态显示：宽 + 低透明度，宽度方向高斯衰减 = 边缘渐变辉光）
    const glowGeo = new LineGeometry();
    glowGeo.setPositions(positions);
    const glowMat = this.makeLineMaterial({ color, linewidth: DEFAULT_EDGE_STYLE.glowWidth, opacity: DEFAULT_EDGE_STYLE.glowOpacity, glowMixUniform: this.edgeGlowUniforms.uGlowMix }); // 纯高斯辉光层
    const glow = new Line2(glowGeo, glowMat);
    glow.renderOrder = 3; // 边层在节点之上（连线/PIN 覆盖卡片边缘，与原项目 EdgeLayer 一致）
    glow.visible = false; // 非活跃无辉光（原项目合并 path 单层）
    // 主线（per-edge dash uniform：活跃静态虚线 16+80 屏幕像素恒定，非活跃 uDashes=0 实线）
    const lineGeo = new LineGeometry();
    lineGeo.setPositions(positions);
    const dashUniforms = { uDashes: { value: 0 }, uDashRatio: { value: EDGE_DASH_RATIO } };
    const lineMat = this.makeLineMaterial({ color, linewidth: DEFAULT_EDGE_STYLE.lineWidth, opacity: DEFAULT_EDGE_STYLE.lineOpacity, glowMixUniform: this.edgeLineUniforms.uGlowMix, dash: true, sharedUniforms: dashUniforms });
    const line = new Line2(lineGeo, lineMat);
    line.renderOrder = 3;
    line.userData.dashUniforms = dashUniforms;
    line.userData.dashPeriods = (this.bezierLen(positions) * this.vp.k) / EDGE_DASH_SUM_PX; // 线段像素长/周期
    // PIN 圆点（z 贴各自节点组平面）
    const pinA = this.makePin(color);
    pinA.position.set(ax, ay, za + 1.5);
    const pinB = this.makePin(color);
    pinB.position.set(bx, by, zb + 1.5);
    const pinGroup = new THREE.Group();
    pinGroup.add(pinA, pinB);
    pinGroup.renderOrder = 3;
    this.edgeRoot.add(glow, line, pinGroup);
    this.edges.push({ id: edgeId, glow, line, pinGroup, a: aId, b: bId });
    // 关键：LineMaterial 的 resolution 必须同步视口尺寸，否则线宽计算 offset/=resolution.y 按 (1,1) 算 → 爆炸成屏幕级宽度
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    if (cw > 0 && ch > 0) {
      glowMat.resolution.set(cw, ch);
      lineMat.resolution.set(cw, ch);
    }
    this.updateEdgeStates(); // 初始活跃态（选中/悬停节点连边高亮）
  }

  /** 删除边（适配层按 EdgeRecord.id 同步删除；dispose 全部 GPU 资源） */
  removeEdge(id: string): void {
    const i = this.edges.findIndex((e) => e.id === id);
    if (i < 0) return;
    const e = this.edges[i];
    if (!e) return;
    this.edgeRoot.remove(e.glow, e.line, e.pinGroup);
    (e.glow.geometry as LineGeometry).dispose();
    (e.glow.material as LineMaterial).dispose();
    (e.line.geometry as LineGeometry).dispose();
    (e.line.material as LineMaterial).dispose();
    const disposeObj = (o: THREE.Object3D): void => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
      for (const c of o.children) disposeObj(c);
    };
    e.pinGroup.children.forEach(disposeObj);
    this.edges.splice(i, 1);
    this.edgeActive.delete(this.edgeKey(e.a, e.b));
    this.markDirty();
  }

  /** 节点移动时同步更新关联边的贝塞尔曲线（z 跟随组偏移，3D 分层下连线不断开） */
  private updateEdgesFor(nodeId: string): void {
    for (const e of this.edges) {
      if (e.a !== nodeId && e.b !== nodeId) continue;
      const a = this.nodes.get(e.a), b = this.nodes.get(e.b);
      if (!a || !b) continue;
      const ax = a.data.x + a.data.w / 2 + PIN_OUTSET, ay = a.data.y;
      const bx = b.data.x - b.data.w / 2 - PIN_OUTSET, by = b.data.y;
      const za = this.nodeWorldZ(a);
      const zb = this.nodeWorldZ(b);
      const positions = this.sampleBezier(ax, ay, za, bx, by, zb, this.bezierSegments);
      (e.glow.geometry as LineGeometry).setPositions(positions);
      (e.line.geometry as LineGeometry).setPositions(positions);
      // 活跃虚线周期随线段长度换算（屏幕像素恒定：总长×k / EDGE_DASH_SUM_PX）
      const du = (e.line as Line2).userData.dashUniforms as { uDashes: { value: number } } | undefined;
      const dashPeriods = (this.bezierLen(positions) * this.vp.k) / EDGE_DASH_SUM_PX;
      (e.line as Line2).userData.dashPeriods = dashPeriods;
      if (du) du.uDashes.value = this.edgeActive.get(this.edgeKey(e.a, e.b)) ? dashPeriods : 0;
      // PIN 跟随（z 贴各自节点组平面）
      const pins = e.pinGroup.children;
      if (pins[0]) pins[0].position.set(ax, ay, za + 1.5);
      if (pins[1]) pins[1].position.set(bx, by, zb + 1.5);
    }
  }

  /** 全量边同步（3D 进/出动画期间组 Z 偏移逐帧变化时调用） */
  private syncAllEdges(): void {
    for (const e of this.edges) this.updateEdgesFor(e.a);
  }

  // ==================== 视口 ====================

  setViewport(vp: V2Viewport): void {
    this.vp = { ...vp };
    this.applyViewport();
  }
  getViewport(): V2Viewport { return { ...this.vp }; }

  /** 背景网格配置（与原画布 CanvasView background props 1:1 对齐：dots/lines/none + 三色 + grid_size） */
  setBackground(opts: {
    background?: 'dots' | 'lines' | 'none';
    grid_color?: string;
    grid_dot_color?: string;
    grid_line_color?: string;
    grid_size?: number;
  }): void {
    const { background, grid_color, grid_dot_color, grid_line_color, grid_size } = opts;
    if (background !== undefined) this.bgMode = background;
    if (grid_size !== undefined) this.bgGridSize = grid_size;
    const dc = parseCssColor(grid_dot_color ?? grid_color ?? '#16213e', 0.24); // dot alpha 默认 0.24（原 CSS）
    const lc = parseCssColor(grid_line_color ?? grid_color ?? '#16213e', 1);
    this.bgUniforms.uDotColor.value.set(dc.r, dc.g, dc.b, dc.a);
    this.bgUniforms.uLineColor.value.set(lc.r, lc.g, lc.b, lc.a);
    this.bgUniforms.uMode.value = this.bgMode === 'none' ? 0 : this.bgMode === 'dots' ? 1 : 2;
    this.applyViewport();
  }

  /** 节点中心世界坐标 → 屏幕坐标（2D 胶囊菜单定位用；2D/3D 统一投影） */
  nodeScreenPos(id: string): { x: number; y: number } | null {
    const n = this.nodes.get(id);
    if (!n) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(n.data.x, n.data.y, this.nodeWorldZ(n)).project(this.camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** 公开拾取（右键菜单用）：屏幕坐标 → 节点 id（无命中返回 null） */
  pickAt(sx: number, sy: number): string | null {
    return this.pickNode(sx, sy)?.id ?? null;
  }

  private applyViewport(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const hw = w / 2 / this.vp.k, hh = h / 2 / this.vp.k;
    this.orthoCam.left = this.vp.x - hw; this.orthoCam.right = this.vp.x + hw;
    this.orthoCam.top = this.vp.y + hh; this.orthoCam.bottom = this.vp.y - hh;
    this.orthoCam.updateProjectionMatrix();
    this.updateGroups(); // 像素恒定换算依赖 k
    // 描边虚线周期世界单位换算（依赖 k；borderType=1 时生效，屏幕像素恒定）
    this.styleUniforms.uDashPeriod.value = this.style.borderType === 1 ? BORDER_DASH_SUM_PX / this.vp.k : 0;
    // 背景网格同步（CSS 语义：单元 = grid_size*k，偏移取模，随视口平移）
    this.bgUniforms.uOffset.value.set(this.vp.x, this.vp.y);
    this.bgUniforms.uGridPx.value = this.bgGridSize * this.vp.k;
    this.bgUniforms.uZoom.value = this.vp.k;
    this.markDirty();
  }

  // ==================== 视觉参数化（GUI 驱动） ====================

  /** 获取当前样式参数 */
  getStyle(): V2StyleParams { return { ...this.style }; }

  /**
   * 设置样式参数（圆角/阴影/选中描边，支持部分字段）：
   * 全部走 uniform/实例属性更新，零对象重建，3w 规模下依然单 draw call。
   */
  setStyle(patch: Partial<V2StyleParams>): void {
    this.style = { ...this.style, ...patch };
    const s = this.style;
    const u = this.styleUniforms;
    // ① 四角圆角（CSS border-radius 四值：TL TR BR BL）
    (u.uRadius.value as THREE.Vector4).set(s.radiusTL, s.radiusTR, s.radiusBR, s.radiusBL);
    // ③ 边线：宽度/三态色/虚线周期（世界单位换算依赖 k，applyViewport 同步）
    u.uBorderW.value = s.borderWidth;
    u.uCardPad.value = s.borderWidth + 2; // 卡片 quad 外扩跟随描边宽度（+AA 余量）
    u.uDashPeriod.value = s.borderType === 1 ? BORDER_DASH_SUM_PX / this.vp.k : 0;
    (u.uBorderDefault.value as THREE.Color).set(s.borderDefaultColor).convertLinearToSRGB();
    (u.uBorderHover.value as THREE.Color).set(s.borderHoverColor).convertLinearToSRGB();
    (u.uSelectColor.value as THREE.Color).set(s.borderSelectedColor).convertLinearToSRGB();
    // ② 空闲阴影（CSS 1:1：offsetX offsetY blur spread opacity）
    (u.uShadowOffset.value as THREE.Vector2).set(s.shadowOffsetX, s.shadowOffsetY);
    u.uBlur.value = s.shadowBlur;
    u.uSpread.value = s.shadowSpread;
    u.uOpacity.value = s.shadowOpacity;
    // ② hover 阴影独立参数组（直接切换非缩放）
    (u.uHoverOffset.value as THREE.Vector2).set(s.hoverShadowOffsetX, s.hoverShadowOffsetY);
    u.uHoverBlur.value = s.hoverShadowBlur;
    u.uHoverSpread.value = s.hoverShadowSpread;
    u.uHoverOpacity.value = s.hoverShadowOpacity;
    u.uPad.value = shadowPad(s);
    (u.uShadowColor.value as THREE.Color).set(s.shadowColor).convertLinearToSRGB();
    // ④ 节点透明度
    u.opacity.value = s.opacity;
    // 图片节点（独立材质）：同步共享 uniform 之外的独立项（uCardPad + uRadius 卡片/阴影）
    for (const n of this.nodes.values()) {
      const imgMat = n.mesh?.material as THREE.ShaderMaterial | undefined;
      const cardPad = imgMat?.uniforms.uCardPad;
      if (cardPad) cardPad.value = s.borderWidth + 2;
      const imgRadius = imgMat?.uniforms.uRadius; // IMG_VERT 内已 clamp 短边 1/4
      if (imgRadius) (imgRadius.value as THREE.Vector4).set(s.radiusTL, s.radiusTR, s.radiusBR, s.radiusBL);
      const shMat = n.imgShadow?.material as THREE.ShaderMaterial | undefined;
      const shRadius = shMat?.uniforms.uRadius;
      if (shRadius) (shRadius.value as THREE.Vector4).set(s.radiusTL, s.radiusTR, s.radiusBR, s.radiusBL);
    }
  }

  /** 阴影显隐（性能对比用；隐藏后阴影 draw call 完全跳过，含图片节点独立阴影层） */
  setShadowVisible(v: boolean): void {
    this.shadowMesh.visible = v;
    for (const n of this.nodes.values()) {
      if (n.imgShadow) n.imgShadow.visible = v;
    }
    this.markDirty();
  }

  /** 边线参数（①粗细 ②颜色 ③辉光 ④段数 ⑤透明度 + 活跃色/活跃宽；LineMaterial 属性+uniform 直改，零重建） */
  setEdgeStyle(patch: Partial<EdgeStyleParams>): void {
    this.edgeStyle = { ...this.edgeStyle, ...patch };
    const s = this.edgeStyle;
    this.bezierSegments = Math.max(4, Math.round(s.segments));
    for (const e of this.edges) {
      // 按当前活跃态重放双态视觉（非活跃：单层主线；活跃：辉光+主线虚线）
      this.applyEdgeVisual(e, this.edgeActive.get(this.edgeKey(e.a, e.b)) ?? false);
    }
    this.syncAllEdges(); // 段数变化时重建几何（更新 edges 引用后调用）
    this.markDirty();
  }

  /** 边唯一 key（活跃态表键） */
  private edgeKey(a: string, b: string): string { return `${a}|${b}`; }

  /**
   * 边双态视觉（原项目 EdgeLayer 双态 1:1）：
   * - 非活跃：单层主线（1.5px #ffffff opacity 0.55 实线），glow 层隐藏
   * - 活跃（选中/悬停/关联）：辉光层 7px 0.35 #e94560 + 主线 2.5px #e94560 静态虚线
   *   （dash 16+80 屏幕像素恒定，去脉冲）
   * 全部 LineMaterial 属性 + 共享 uniform 直改，零重建
   */
  private applyEdgeVisual(e: { glow: Line2; line: Line2 }, active: boolean): void {
    const s = this.edgeStyle;
    const g = e.glow.material as LineMaterial;
    const l = e.line.material as LineMaterial;
    const du = e.line.userData.dashUniforms as { uDashes: { value: number } } | undefined;
    if (active) {
      g.visible = true;
      g.linewidth = s.glowWidth;
      g.opacity = s.glowOpacity;
      g.color.set(s.activeColor);
      l.linewidth = s.activeWidth;
      l.opacity = 1;
      l.color.set(s.activeColor);
      if (du) du.uDashes.value = (e.line.userData.dashPeriods as number) ?? 0; // 静态虚线（周期数随线段长度）
    } else {
      g.visible = false;
      l.linewidth = s.lineWidth;
      l.opacity = s.lineOpacity;
      l.color.set(s.color);
      if (du) du.uDashes.value = 0; // 实线（shader 条件跳过 dash）
    }
  }

  /** 选中/悬停联动（aa06）：任一端节点选中或悬停 → 边活跃（原项目 EdgeLayer active 判定语义） */
  private updateEdgeStates(): void {
    for (const e of this.edges) {
      const k = this.edgeKey(e.a, e.b);
      const a = this.selected?.id === e.a || this.selected?.id === e.b;
      const h = this.hoverNode !== null && (this.hoverNode.id === e.a || this.hoverNode.id === e.b);
      const active = a || h;
      if (active !== this.edgeActive.get(k)) {
        this.edgeActive.set(k, active);
        this.applyEdgeVisual(e, active);
      }
    }
    this.markDirty();
  }

  /** 组框参数（虚线长/间隔/线宽/透明度/颜色/背景透明度；共享值对象直改 + updateGroups 重算 dash/线宽像素恒定） */
  setGroupStyle(patch: Partial<GroupStyleParams>): void {
    this.groupStyle = { ...this.groupStyle, ...patch };
    const s = this.groupStyle;
    const g = this.groupSharedUniforms;
    g.opacity.value = s.bgOpacity;
    g.uLineOpacity.value = s.lineOpacity;
    (g.uLineColor.value as THREE.Color).set(s.lineColor).convertLinearToSRGB();
    (g.uSelectColor.value as THREE.Color).set(s.selectColor).convertLinearToSRGB();
    this.updateGroups(); // 重算 dash 周期 + uBorderW（屏幕像素恒定依赖 k）
    this.markDirty();
  }

  // ==================== T7: 外部组注入（adapter 同源几何/样式，生产模式唯一数据源） ====================

  /** 注入组 bounds（adapter 用 DOM 同源 computeGroupBounds 计算）；title/组宽变化时重绘标题纹理 */
  setGroupBounds(gid: string, rect: { x: number; y: number; w: number; h: number }, title?: string): void {
    const cur = this.externalGroupBounds.get(gid);
    const wChanged = !cur || Math.abs(cur.w - rect.w) > 0.5;
    const titleChanged = title !== undefined && (!cur || cur.title !== title);
    this.externalGroupBounds.set(gid, {
      x: rect.x, y: rect.y, w: rect.w, h: rect.h,
      title: title ?? cur?.title ?? gid,
    });
    if (wChanged || titleChanged) {
      const v = this.groups.get(gid);
      if (v) this.refreshGroupTitleTexture(v, gid);
    }
    this.updateGroups();
    this.markDirty();
  }

  /** per-组样式覆盖（组节点字段 + GroupDefaults 解析结果；null 清除覆盖回退共享默认） */
  setGroupStyleOverride(gid: string, patch: GroupStyleOverride | null): void {
    if (patch === null) {
      this.externalGroupStyles.delete(gid);
      const v = this.groups.get(gid);
      if (v) {
        // 还原共享引用（圆角）后整体重算
        const u = (v.mesh.material as THREE.ShaderMaterial).uniforms;
        if (v.mesh.userData.styleOverride) {
          u.uRadius = this.groupSharedUniforms.uRadius;
          v.mesh.userData.styleOverride = false;
        }
        this.updateGroups();
      }
    } else {
      this.externalGroupStyles.set(gid, patch);
      const v = this.groups.get(gid);
      if (v) {
        this.applyGroupStyleOverride(v, gid, this.vp.k);
        this.refreshGroupTitleTexture(v, gid); // titleColor 覆盖即时生效
      }
    }
    this.markDirty();
  }

  /** 拖拽跟随直写（DOM 版 dragOffsets transform 语义：bounds 平移不变性；同时更新 rect 与 mesh/title 位置） */
  setGroupTransform(gid: string, dx: number, dy: number): void {
    const cur = this.externalGroupBounds.get(gid);
    if (!cur) return;
    this.externalGroupBounds.set(gid, { ...cur, x: cur.x + dx, y: cur.y + dy });
    const v = this.groups.get(gid);
    if (!v) return;
    const zOff = this.groupZOffsets.get(gid) ?? 0;
    v.mesh.position.set(cur.x + dx + cur.w / 2, cur.y + dy + cur.h / 2, zOff - 5);
    // T7: 标题偏移 2D 反缩放（与 updateGroups 同语义）
    const titleOffsetY = this.isLayerMode ? GROUP_TITLE_H / 2 + 2 : (GROUP_TITLE_H / 2 + 2) / this.vp.k;
    v.title.position.set(cur.x + dx + cur.w / 2, cur.y + dy - titleOffsetY, zOff - 3);
  }

  /** 移除外部组（store 删除组节点时调用，随后清空 external 记录） */
  removeGroup(gid: string): void {
    this.externalGroupBounds.delete(gid);
    this.externalGroupStyles.delete(gid);
    this.updateGroups();
    this.markDirty();
  }

  /** 组标题纹理打底色（= 画布背景色，DOM 版 var(--zeroexo-canvas-bg)） */
  setGroupTitleBackground(color: string): void {
    if (color === this.groupTitleBg) return;
    this.groupTitleBg = color;
    for (const [gid, v] of this.groups) this.refreshGroupTitleTexture(v, gid);
    this.markDirty();
  }

  // ==================== 3D 模式（与 POC three-image-canvas-test.html 一致） ====================

  private static readonly ORBIT_THETA_MAX = 1.0;   // 水平 ≈ 57°
  private static readonly ORBIT_PHI_MIN = -0.3;    // 向下 ≈ -17°
  private static readonly ORBIT_PHI_MAX = 0.9;     // 向上 ≈ 52°
  private static readonly LAYER_SPREAD = 300;       // 组 Z 轴间距
  private static readonly ANIM_DUR = 800;           // 过渡动画时长 ms

  /** easeInOutCubic（与 POC 一致） */
  private ease(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /** 透视相机等效距离：FOV45 下画面与当前正交视图完全一致（无缝起点） */
  private layerEqDist(): number {
    return (this.container.clientHeight / 2) / Math.tan(THREE.MathUtils.degToRad(45) / 2) / this.vp.k;
  }

  /** 启动相机过渡动画（位置 + 四元数插值 + 组 Z 同步展开/收起） */
  private startCamAnim(
    fromPos: THREE.Vector3, fromQuat: THREE.Quaternion,
    toPos: THREE.Vector3, toQuat: THREE.Quaternion,
    fromZs: number[], toZs: number[],
    dur: number, onDone?: () => void,
  ): void {
    this.camAnim = {
      start: performance.now(), dur,
      fromPos: fromPos.clone(), fromQuat: fromQuat.clone(),
      toPos: toPos.clone(), toQuat: toQuat.clone(),
      fromZs, toZs, onDone,
    };
    this.markDirty(); // 动画启动唤醒渲染链
  }

  private updateCamAnim(): void {
    if (!this.camAnim) return;
    const { start, dur, fromPos, fromQuat, toPos, toQuat, fromZs, toZs, onDone } = this.camAnim;
    const elapsed = performance.now() - start;
    const t = Math.min(elapsed / dur, 1);
    const e = this.ease(t);
    // 相机位置/朝向插值
    this.perspCam.position.lerpVectors(fromPos, toPos, e);
    this.perspCam.quaternion.slerpQuaternions(fromQuat, toQuat, e);
    // 组 Z 同步展开/收起
    for (let i = 0; i < this.layerGroups.length; i++) {
      const gid = this.layerGroups[i];
      if (gid === undefined) continue;
      const fz = fromZs[i] ?? 0, tz = toZs[i] ?? 0;
      this.groupZOffsets.set(gid, fz + (tz - fz) * e);
    }
    this.updateGroups(); // 组框跟随 Z 偏移
    this.syncInstGroupZ(); // 节点实例跟随组 Z（InstancedMesh 无继承，手动同步）
    this.syncAllEdges(); // 连线跟随组 Z（3D 分层下不断开）
    if (t >= 1) {
      this.camAnim = null;
      onDone?.();
    }
  }

  /** 3D 分层时把节点 Z 同步到所属组偏移 + 节点自身浮动（实例 + 图片 Mesh + 阴影层，组 Z/浮动变化时调用） */
  private syncInstGroupZ(): void {
    for (const n of this.nodes.values()) {
      const z = this.nodeWorldZ(n);
      if (n.mesh) {
        n.mesh.position.z = z;
        if (n.imgShadow) n.imgShadow.position.z = z - 2;
      } else this.setInstMatrix(n.instIndex, n.data.x, n.data.y, z, n.data.w, n.data.h);
    }
  }

  enter3D(): void {
    if (this.isLayerMode || this.camAnim) return;
    this.isLayerMode = true;
    this.updateGroups(); // T7: 组框渲染归属切回引擎（2D 由 DOM GroupLayer 承担，3D 由引擎 SDF 承担）
    this.applyDepthMode(); // 3D：卡片写深度（深度遮挡，帧间稳定，消除堆叠闪烁）
    // 保存当前正交相机状态
    this.savedCam = { x: this.vp.x, y: this.vp.y, k: this.vp.k };
    // 计算所有节点中心作为 orbit 焦点
    let cx = 0, cy = 0, n = 0;
    for (const nd of this.nodes.values()) {
      cx += nd.data.x; cy += nd.data.y; n++;
    }
    if (n > 0) this.orbitCenter.set(cx / n, cy / n, 0);
    // 分层状态持久化：首次进入才展开动画；再次进入直接复用已有 Z 分层（不重播合并/展开）
    const firstTime = this.layerGroups.length === 0;
    const groupCentroids = new Map<string, number>();
    for (const nd of this.nodes.values()) {
      const gid = nd.data.groupId;
      if (!gid) continue;
      groupCentroids.set(gid, (groupCentroids.get(gid) ?? 0) + nd.data.y);
    }
    const all = [...groupCentroids.keys()];
    if (firstTime) {
      // 首次：组按 Y 坐标排序（模拟 zIndex），从 0 展开到 LAYER_SPREAD
      this.layerGroups = all.sort((a, b) => (groupCentroids.get(b) ?? 0) - (groupCentroids.get(a) ?? 0));
    } else {
      // 持久分层：保留既有顺序与 Z，新出现的组追加到末尾
      const existing = this.layerGroups.filter((g) => all.includes(g));
      const added = all.filter((g) => !this.layerGroups.includes(g));
      this.layerGroups = [...existing, ...added];
      added.forEach((gid, i) => this.groupZOffsets.set(gid, (existing.length + i) * ThreeCanvasV2.LAYER_SPREAD));
    }
    const curZs = this.layerGroups.map((gid) => this.groupZOffsets.get(gid) ?? 0);
    const fromZs = firstTime ? this.layerGroups.map((_, i) => i * 30) : curZs; // 首次起点预拉开 1/10
    const toZs = firstTime ? this.layerGroups.map((_, i) => i * ThreeCanvasV2.LAYER_SPREAD) : curZs;
    // 目标 orbit 视角
    this.orbit.theta = 0;
    this.orbit.phi = 0.3; // ~17° 俯视
    this.orbit.radius = 1500;
    const toPos = new THREE.Vector3(
      this.orbitCenter.x + this.orbit.radius * Math.sin(this.orbit.theta) * Math.cos(this.orbit.phi),
      this.orbitCenter.y + this.orbit.radius * Math.sin(this.orbit.phi),
      this.orbitCenter.z + this.orbit.radius * Math.cos(this.orbit.theta) * Math.cos(this.orbit.phi),
    );
    const toQuat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(toPos, this.orbitCenter, new THREE.Vector3(0, 1, 0)),
    );
    // 起点：等效透视位置（画面与当前 2D 完全一致）→ 无缝拉出 3D
    const fromPos = new THREE.Vector3(this.savedCam.x, this.savedCam.y, this.layerEqDist());
    const fromQuat = new THREE.Quaternion();
    // 立即切换到透视相机并置于等效起始位姿（POC：camera = perspCam 先于动画，画面即刻可见）
    this.camera = this.perspCam;
    this.control.camera = this.perspCam;
    this.perspCam.position.copy(fromPos);
    this.perspCam.quaternion.copy(fromQuat);
    this.perspCam.fov = 45;
    this.perspCam.updateProjectionMatrix();
    this.control.enabled = true;
    // 立即恢复选中目标的坐标轴（POC attachSelection：进入层级模式重新挂载；z 含节点浮动）
    if (this.selected) {
      this.proxyObj.position.set(this.selected.data.x, this.selected.data.y, this.nodeWorldZ(this.selected));
      this.control.attach(this.proxyObj);
    } else if (this.selectedGroup) {
      this.attachGroupGizmo(); // 选中组时坐标轴控制组
    }
    // 启动 800ms 过渡动画（期间渲染 perspCam 插值，画面从 2D 无缝拉出）
    this.startCamAnim(fromPos, fromQuat, toPos, toQuat, fromZs, toZs, ThreeCanvasV2.ANIM_DUR, () => {
      this.on3DStateChange?.(true);
    });
  }

  exit3D(): void {
    if (!this.isLayerMode || this.camAnim) return;
    this.isLayerMode = false;
    this.applyDepthMode(); // 2D：卡片不写深度（层叠由绘制顺序保证）
    this.control.detach();
    this.control.enabled = false;
    // 注意：control.camera 保持 perspCam，动画结束 onDone 再切回 orthoCam（POC 一致）
    // 从当前 orbit 状态动画回 2D
    const fromPos = this.perspCam.position.clone();
    const fromQuat = this.perspCam.quaternion.clone();
    const toPos = new THREE.Vector3(this.savedCam.x, this.savedCam.y, this.layerEqDist());
    const toQuat = new THREE.Quaternion(); // 正向（无旋转）
    const fromZs = this.layerGroups.map((gid) => this.groupZOffsets.get(gid) ?? 0);
    const toZs = [...fromZs]; // 分层状态持久化：退出 3D 不合并 Z，再次进入直接可见分层
    this.startCamAnim(fromPos, fromQuat, toPos, toQuat, fromZs, toZs, ThreeCanvasV2.ANIM_DUR, () => {
      this.camera = this.orthoCam;
      this.control.camera = this.orthoCam;
      // 恢复正交相机状态
      this.orthoCam.position.set(this.savedCam.x, this.savedCam.y, 100);
      this.orthoCam.rotation.set(0, 0, 0);
      this.vp = { x: this.savedCam.x, y: this.savedCam.y, k: this.savedCam.k };
      this.applyViewport();
      this.orbit.theta = 0;
      this.orbit.phi = 0;
      this.on3DStateChange?.(false);
    });
  }

  setGizmoMode(mode: 'translate' | 'rotate' | 'scale'): void { this.control.setMode(mode); }
  toggleRotateEnabled(enabled: boolean): void { this.rotateEnabled = enabled; }
  private rotateEnabled = false;

  /** 每帧更新透视相机（orbit 球面坐标，非动画期间） */
  private updatePerspCam(): void {
    if (this.camAnim) return; // 动画期间由 updateCamAnim 接管
    const { theta, phi, radius } = this.orbit;
    this.perspCam.position.set(
      this.orbitCenter.x + radius * Math.sin(theta) * Math.cos(phi),
      this.orbitCenter.y + radius * Math.sin(phi),
      this.orbitCenter.z + radius * Math.cos(theta) * Math.cos(phi),
    );
    this.perspCam.lookAt(this.orbitCenter);
  }

  // ==================== 交互 ====================

  /** PIN hover 区判定（基于已拾取节点 + 世界坐标，复刻原版 40px 边缘容器；3D 透视下用节点 Z 平面近似） */
  private pickPinZoneOn(n: V2Node, sx: number, sy: number): { nodeId: string; side: 'left' | 'right' } | null {
    const zone = PIN_HOVER_ZONE / this.vp.k; // 屏幕 px → 世界（2D 精确；3D 下 vp.k 为进入前缩放，近似可用）
    const wp = this.screenToWorld(sx, sy, this.nodeWorldZ(n));
    // 命中判定以 PIN 圆心为基准（圆心在节点边缘外侧 PIN_OUTSET，与渲染位置一致）
    const lx = n.data.x - n.data.w / 2 - PIN_OUTSET;
    const rx = n.data.x + n.data.w / 2 + PIN_OUTSET;
    if (Math.abs(wp.x - lx) <= zone) return { nodeId: n.id, side: 'left' };
    if (Math.abs(wp.x - rx) <= zone) return { nodeId: n.id, side: 'right' };
    return null;
  }

  /** 独立入口（pointerdown 用：先拾取节点再判定 hover 区） */
  private pickPinZone(sx: number, sy: number): { nodeId: string; side: 'left' | 'right' } | null {
    const n = this.pickNode(sx, sy);
    if (!n) return null;
    return this.pickPinZoneOn(n, sx, sy);
  }

  /** PIN hover 提示组（SDF 圆环 + 十字 + 外圈光晕 + 虚线外环，还原原版 box-shadow 光晕语义；惰性创建一次） */
  private ensurePinHover(): void {
    if (this.pinHoverG) return;
    const g = new THREE.Group();
    g.add(this.makePin(0xffffff, { glow: true })); // 主环 + 十字 + 虚线外环 + 光晕（全 SDF AA）
    g.visible = false;
    this.scene.add(g);
    this.pinHoverG = g;
  }

  /** 3D PIN hover 虚线球体（反馈 11：3D 语义提示；三正交圆环 + dash，复用 makeLineMaterial 虚线管线） */
  private ensurePinSphere(): void {
    if (this.pinSphereG) return;
    const g = new THREE.Group();
    const r = 16; // 世界半径（3D 下固定尺寸，随 orbit 距离自然缩放）
    const seg = 48;
    const rings: [number, number][] = [[0, 1], [0, 2], [1, 2]]; // XY / XZ / YZ 三正交平面
    for (const [i, j] of rings) {
      const pts: number[] = [];
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const p: [number, number, number] = [0, 0, 0];
        p[i] = Math.cos(a) * r;
        p[j] = Math.sin(a) * r;
        pts.push(p[0], p[1], p[2]);
      }
      const geo = new LineGeometry();
      geo.setPositions(pts);
      const mat = this.makeLineMaterial({
        color: 0xffffff, linewidth: 1.5, opacity: 0.9, dash: true,
        sharedUniforms: { uDashes: { value: 12 }, uDashRatio: { value: 0.6 } },
      });
      // 关键：LineMaterial 的 resolution 必须同步视口尺寸，否则线宽 offset/=resolution.y 按 (1,1) 算 → 爆炸
      const cw = this.container.clientWidth, ch = this.container.clientHeight;
      if (cw > 0 && ch > 0) mat.resolution.set(cw, ch);
      const line = new Line2(geo, mat);
      line.renderOrder = 3;
      g.add(line);
    }
    g.visible = false;
    this.scene.add(g);
    this.pinSphereG = g;
  }

  /**
   * PIN hover 状态切换（反馈 11 复刻原版 hover 区：悬停显示 PIN + 光晕 + crosshair 光标；
   * 2D 圆环磁吸在节点边缘，3D 虚线球体）。磁吸 y 跟随由 onPointerMove 持续更新。
   */
  private setPinHover(pin: { nodeId: string; side: 'left' | 'right' } | null): void {
    const same = !!pin && !!this.pinHoverState && pin.nodeId === this.pinHoverState.nodeId && pin.side === this.pinHoverState.side;
    this.pinHoverState = pin;
    this.renderer.domElement.style.cursor = pin ? 'crosshair' : '';
    if (!pin) {
      if (this.pinHoverG) this.pinHoverG.visible = false;
      if (this.pinSphereG) this.pinSphereG.visible = false;
      return;
    }
    if (same) return; // 同一目标：位置由 move 磁吸更新，避免重复摆放
    const n = this.nodes.get(pin.nodeId);
    if (!n) return;
    // PIN 圆心在节点边缘外侧 PIN_OUTSET（与渲染/连线端点一致，保持距离不压边）
    const x = n.data.x + (pin.side === 'right' ? n.data.w / 2 + PIN_OUTSET : -n.data.w / 2 - PIN_OUTSET);
    const z = this.nodeWorldZ(n) + 1.5; // 贴节点边缘平面（同边 PIN z 语义）
    if (this.isLayerMode) {
      this.ensurePinSphere();
      this.pinSphereG!.visible = true;
      this.pinSphereG!.position.set(x, n.data.y, z);
      if (this.pinHoverG) this.pinHoverG.visible = false;
    } else {
      this.ensurePinHover();
      this.pinHoverG!.visible = true;
      this.pinHoverG!.position.set(x, n.data.y, z);
      if (this.pinSphereG) this.pinSphereG.visible = false;
    }
    this.markDirty();
  }

  /** 组框 hover 标记切换（反馈 11：节点有的组也该有；uHover 驱动 shader 内辉光/背景提亮）
   *  T7: 2D 模式关停——DOM 版 GroupItem 无 hover 视觉，多余辉光 = 像素级差异；仅 3D 增强保留 */
  private setGroupHover(gid: string | null): void {
    if (!this.isLayerMode) return;
    if (gid === this.hoverGroup) return;
    this.hoverGroup = gid;
    for (const [id, v] of this.groups) {
      (v.mesh.material as THREE.ShaderMaterial).uniforms.uHover!.value = id === gid ? 1 : 0;
    }
  }

  // ==================== 拖拽连线状态机（反馈 11：复刻原版 connection controller） ====================

  /** 预览连线惰性创建（glow + 主线双 Line2，贝塞尔几何由 updateConnectPreview 直写） */
  private ensureConnectPreview(): void {
    if (this.connectPreview) return;
    const color = 0xffffff;
    const glowMat = this.makeLineMaterial({ color, linewidth: 6, opacity: 0.2, glowMixUniform: this.edgeGlowUniforms.uGlowMix });
    const lineMat = this.makeLineMaterial({ color, linewidth: 2, opacity: 0.65, glowMixUniform: this.edgeLineUniforms.uGlowMix });
    const glow = new Line2(new LineGeometry(), glowMat);
    const line = new Line2(new LineGeometry(), lineMat);
    glow.renderOrder = 3;
    line.renderOrder = 3;
    glow.visible = false;
    line.visible = false;
    this.edgeRoot.add(glow, line);
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    if (cw > 0 && ch > 0) {
      glowMat.resolution.set(cw, ch);
      lineMat.resolution.set(cw, ch);
    }
    this.connectPreview = { glow, line };
  }

  /** 按下源 PIN：进入连线状态（预览显形，几何由 move 驱动） */
  private startConnect(pin: { nodeId: string; side: 'left' | 'right' }): void {
    const n = this.nodes.get(pin.nodeId);
    if (!n) return;
    this.connectState = { fromId: pin.nodeId, side: pin.side };
    this.ensureConnectPreview();
    this.connectPreview!.glow.visible = true;
    this.connectPreview!.line.visible = true;
    this.updateConnectPreviewTo(this.connectPreview!, n);
    this.markDirty();
  }

  /** 预览贝塞尔更新（从源 PIN 到鼠标世界点；目标未定前端点自由跟随，原版 connection controller 语义） */
  private updateConnectPreview(sx: number, sy: number): void {
    if (!this.connectState || !this.connectPreview) return;
    const n = this.nodes.get(this.connectState.fromId);
    if (!n) return;
    const wp = this.screenToWorld(sx, sy, this.nodeWorldZ(n));
    // 源 PIN 圆心在节点边缘外侧 PIN_OUTSET（与已建边端点一致）
    const ax = n.data.x + (this.connectState.side === 'right' ? n.data.w / 2 + PIN_OUTSET : -n.data.w / 2 - PIN_OUTSET);
    const positions = this.sampleBezier(ax, n.data.y, this.nodeWorldZ(n), wp.x, wp.y, this.nodeWorldZ(n), this.bezierSegments);
    (this.connectPreview.glow.geometry as LineGeometry).setPositions(positions);
    (this.connectPreview.line.geometry as LineGeometry).setPositions(positions);
    this.markDirty();
  }

  /** 预览初始几何（按下瞬间：从源 PIN 到节点中心，防止空白帧） */
  private updateConnectPreviewTo(pv: { glow: Line2; line: Line2 }, n: V2Node): void {
    const ax = n.data.x + (this.connectState!.side === 'right' ? n.data.w / 2 + PIN_OUTSET : -n.data.w / 2 - PIN_OUTSET);
    const positions = this.sampleBezier(ax, n.data.y, this.nodeWorldZ(n), n.data.x, n.data.y, this.nodeWorldZ(n), this.bezierSegments);
    (pv.glow.geometry as LineGeometry).setPositions(positions);
    (pv.line.geometry as LineGeometry).setPositions(positions);
  }

  /** 取消连线（预览隐藏 + 状态复位，不建边） */
  private cancelConnect(): void {
    this.connectState = null;
    if (this.connectPreview) {
      this.connectPreview.glow.visible = false;
      this.connectPreview.line.visible = false;
    }
    this.markDirty();
  }

  /** 屏幕坐标 → 世界坐标（射线与 z=planeZ 平面求交；组内节点拖拽需传组 Z 偏移，POC screenToWorld(planeZ)） */
  private screenToWorld(sx: number, sy: number, planeZ = 0): THREE.Vector3 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.tmpV2.set(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.tmpV2, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
    const out = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, out);
    return out ?? new THREE.Vector3(this.vp.x, this.vp.y, planeZ);
  }

  private pickNode(sx: number, sy: number): V2Node | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.tmpV2.set(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.tmpV2, this.camera);
    // 图片节点（独立 Mesh）与纯色节点（InstancedMesh）双拾取，按射线距离取最近命中
    let best: V2Node | null = null;
    let bestDist = Infinity;
    const imgMeshes = [...this.nodes.values()].filter((n) => n.mesh).map((n) => n.mesh!) ;
    if (imgMeshes.length > 0) {
      const ih = this.raycaster.intersectObjects(imgMeshes, false);
      const hit = ih[0];
      if (hit && hit.distance < bestDist) {
        bestDist = hit.distance;
        best = this.nodes.get(hit.object.userData.nodeId as string) ?? null;
      }
    }
    const hits = this.raycaster.intersectObject(this.instMesh, false);
    const hit = hits[0]; // 取第一个命中（离相机最近 = 视觉最前层，POC hits[0]）
    if (hit && hit.distance < bestDist && hit.instanceId !== undefined) {
      best = this.nodeByInst.get(hit.instanceId) ?? null;
    }
    return best;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.camAnim) return; // 动画期间禁止交互
    if (this.controlDragging) return; // TransformControls 接管中
    this.interacting = true;
    this.markDirty();
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      if (this.isLayerMode) {
        // 3D 模式：中键平移 orbit 焦点（POC pan 分支）
        this.orbitPan = { sx: e.clientX, sy: e.clientY, cx: this.orbitCenter.x, cy: this.orbitCenter.y };
      } else {
        this.panning = { sx: e.clientX, sy: e.clientY, vx: this.vp.x, vy: this.vp.y };
      }
      return;
    }
    if (e.button !== 0) return;
    // 已有连线预览（上一条未松手）：先取消再继续（原版 connection controller 单连线语义）
    if (this.connectState) this.cancelConnect();
    // PIN hover 区命中 → 拖拽连线（反馈 11：先于节点选中，复刻原版 hover 容器按下拖线）
    const pin = this.pickPinZone(e.clientX, e.clientY);
    if (pin) {
      this.startConnect(pin);
      return;
    }
    // 节点命中 → 选中 + 待定拖拽（2D/3D 统一，POC 指针状态机；组内节点在其世界 Z 平面抓取点跟随）
    const n = this.pickNode(e.clientX, e.clientY);
    if (n) {
      this.select(n.id);
      this.selectGroup(null); // 选节点时取消组选中
      this.onNodeClick?.(n.id);
      const wp = this.screenToWorld(e.clientX, e.clientY, this.nodeWorldZ(n));
      this.pending = { x: e.clientX, y: e.clientY, type: 'drag', id: n.id, offX: wp.x - n.data.x, offY: wp.y - n.data.y };
      return;
    }
    // 组框命中 → 选中整组 + 待定组拖动（可整体拖动，坐标轴控制组）
    const gid = this.pickGroup(e.clientX, e.clientY);
    if (gid !== null) {
      this.select(null);
      this.selectGroup(gid);
      this.onNodeClick?.(null);
      this.pending = { x: e.clientX, y: e.clientY, type: 'groupDrag', gid };
      return;
    }
    // 空白 → 取消选中 + 待定 orbit（3D）/ pan（2D），阈值激活防误触（POC）
    this.select(null);
    this.selectGroup(null);
    this.onNodeClick?.(null);
    this.pending = { x: e.clientX, y: e.clientY, type: this.isLayerMode ? 'orbit' : 'pan' };
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.camAnim) return;
    if (this.controlDragging) return;
    this.markDirty(); // hover 检测/拖拽/orbit 都需要持续渲染
    // 连线拖拽中：预览贝塞尔跟随鼠标（优先于一切拖拽分支）
    if (this.connectState) {
      this.updateConnectPreview(e.clientX, e.clientY);
      return;
    }
    // 待定操作：超过拖拽阈值才激活（纯点击/微小抖动不触发拖拽，与 POC 一致）
    if (this.pending) {
      const dx = e.clientX - this.pending.x;
      const dy = e.clientY - this.pending.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      const p = this.pending;
      this.pending = null;
      if (p.type === 'drag' && p.id !== undefined && p.offX !== undefined && p.offY !== undefined) {
        const nd = this.nodes.get(p.id);
        const nodeZ = nd ? this.nodeWorldZ(nd) : 0;
        this.dragging = { id: p.id, offX: p.offX, offY: p.offY, nodeZ };
      } else if (p.type === 'groupDrag' && p.gid) {
        // 激活组拖动：记录组内节点起始位置 + 按下点抓取坐标（在组 Z 平面反算，2D 习惯抓取点跟随）
        const ids: string[] = [];
        const starts: { x: number; y: number }[] = [];
        for (const nd of this.nodes.values()) {
          if (nd.data.groupId === p.gid) { ids.push(nd.id); starts.push({ x: nd.data.x, y: nd.data.y }); }
        }
        const planeZ = this.groupZOffsets.get(p.gid) ?? 0;
        const wp = this.screenToWorld(p.x, p.y, planeZ);
        this.groupDrag = { gid: p.gid, ids, starts, grabWorld: { x: wp.x, y: wp.y }, planeZ };
      } else if (p.type === 'orbit') {
        this.orbitDrag = { sx: p.x, sy: p.y, theta: this.orbit.theta, phi: this.orbit.phi };
      } else if (p.type === 'pan') {
        this.panning = { sx: p.x, sy: p.y, vx: this.vp.x, vy: this.vp.y };
      }
    }
    if (this.dragging) {
      const n = this.nodes.get(this.dragging.id);
      if (n) {
        // 在节点世界 Z 平面（组 Z 偏移）反算，3D 分层下拖拽不漂移（POC state.nodeZ）
        const wp = this.screenToWorld(e.clientX, e.clientY, this.dragging.nodeZ);
        this.setNodePos(n, wp.x - this.dragging.offX, wp.y - this.dragging.offY);
        this.syncNode(n);
      }
      return;
    }
    if (this.groupDrag) {
      // 组框拖动：整组平面移动（POC moveGroupPlane，在组 Z 平面投影，组 position 保持 x/y=0）
      const wp = this.screenToWorld(e.clientX, e.clientY, this.groupDrag.planeZ);
      let dx = wp.x - this.groupDrag.grabWorld.x;
      let dy = wp.y - this.groupDrag.grabWorld.y;
      if (e.shiftKey) { dx = Math.round(dx / GRID_STEP) * GRID_STEP; dy = Math.round(dy / GRID_STEP) * GRID_STEP; }
      for (let i = 0; i < this.groupDrag.ids.length; i++) {
        const nd = this.nodes.get(this.groupDrag.ids[i] ?? '');
        if (!nd) continue;
        const s = this.groupDrag.starts[i];
        if (!s) continue;
        this.setNodePos(nd, s.x + dx, s.y + dy);
        // T7: 补报成员终点（组拖拽直写不经过 dragging 分支；adapter 据此记录 pendingEnds 供松手落盘）
        this.onNodeMove?.(nd.id, nd.data.x, nd.data.y);
      }
      this.updateGroups(); // 组框跟随整组移动
      for (const id of this.groupDrag.ids) this.updateEdgesFor(id);
      // 3D 模式组坐标轴代理跟随整组移动（POC gizmo attach 组自动跟随）
      if (this.isLayerMode && this.selectedGroup === this.groupDrag.gid && this.control.object === this.proxyGroupObj) {
        this.attachGroupGizmo();
      }
      return;
    }
    if (this.panning) {
      const dx = (e.clientX - this.panning.sx) / this.vp.k;
      const dy = (e.clientY - this.panning.sy) / this.vp.k;
      this.vp.x = this.panning.vx - dx;
      this.vp.y = this.panning.vy + dy;
      this.applyViewport();
      this.onViewportChange?.(this.getViewport());
      return;
    }
    if (this.orbitDrag) {
      // 左键空白：有限 orbit 环绕（从拖拽起始角绝对偏移，POC orbit 分支）
      const dx = e.clientX - this.orbitDrag.sx;
      const dy = e.clientY - this.orbitDrag.sy;
      this.orbit.theta = THREE.MathUtils.clamp(this.orbitDrag.theta - dx * 0.005, -ThreeCanvasV2.ORBIT_THETA_MAX, ThreeCanvasV2.ORBIT_THETA_MAX);
      this.orbit.phi = THREE.MathUtils.clamp(this.orbitDrag.phi + dy * 0.005, ThreeCanvasV2.ORBIT_PHI_MIN, ThreeCanvasV2.ORBIT_PHI_MAX);
      this.updatePerspCam();
      return;
    }
    if (this.orbitPan) {
      // 中键：平移 orbit 焦点（像素 → 世界单位，随距离缩放，POC pan 分支）
      const dx = e.clientX - this.orbitPan.sx;
      const dy = e.clientY - this.orbitPan.sy;
      const k = (2 * this.orbit.radius * Math.tan(THREE.MathUtils.degToRad(45) / 2)) / this.container.clientHeight;
      this.orbitCenter.x = this.orbitPan.cx - dx * k;
      this.orbitCenter.y = this.orbitPan.cy + dy * k;
      this.updatePerspCam();
      return;
    }
    // 空闲态 hover 检测（CSS :hover 语义，驱动边框 hover 态；拖拽/环绕期间不检测）
    if (e.buttons === 0) {
      const hn = this.pickNode(e.clientX, e.clientY);
      // PIN hover 区（反馈 11：悬停边缘 40px 容器 → PIN + 光晕 + crosshair；2D 磁吸 y 跟随）
      const pin = hn ? this.pickPinZoneOn(hn, e.clientX, e.clientY) : null;
      this.setPinHover(pin);
      if (pin && hn && !this.isLayerMode && this.pinHoverG) {
        // 磁吸跟随：PIN 沿节点边缘上下吸附鼠标（hover 容器高度内 clamp，原版 magnetOffset 语义）
        const wp = this.screenToWorld(e.clientX, e.clientY, this.nodeWorldZ(hn));
        const halfZone = PIN_HOVER_ZONE / this.vp.k;
        const y = THREE.MathUtils.clamp(wp.y, hn.data.y - hn.data.h / 2 - halfZone, hn.data.y + hn.data.h / 2 + halfZone);
        this.pinHoverG.position.y = y;
      }
      this.setHover(hn ? hn.id : null);
      // 组 hover（节点未命中时检测组框；反馈 11：节点有的组也该有）
      this.setGroupHover(hn ? null : this.pickGroup(e.clientX, e.clientY));
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    // 连线松手：命中目标节点（非源节点）→ 建立边；否则取消预览（原版 connection controller 松手建边）
    if (this.connectState) {
      const target = this.pickNode(e.clientX, e.clientY);
      if (target && target.id !== this.connectState.fromId) {
        this.addEdge(this.connectState.fromId, target.id);
      }
      this.cancelConnect();
    }
    this.pending = null; // 纯点击：无拖拽，直接结束
    this.dragging = null;
    if (this.groupDrag) {
      // T7: 组拖拽松手 → 上报成员 ids，adapter 统一 MoveNodesCommand 落盘（一次 undo 恢复起点）
      const ids = this.groupDrag.ids;
      this.groupDrag = null;
      this.onNodeDragEnd?.(ids);
    }
    this.orbitDrag = null;
    this.orbitPan = null;
    this.panning = null;
    this.interacting = false;
    this.markDirty();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.camAnim) return;
    this.interacting = true;
    this.markDirty();
    const finish = () => {
      this.interacting = false;
      this.markDirty();
    };
    clearTimeout(this.wheelSettle);
    this.wheelSettle = window.setTimeout(finish, 120);
    if (this.isLayerMode) {
      this.orbit.radius = THREE.MathUtils.clamp(this.orbit.radius * (e.deltaY > 0 ? 1.1 : 0.9), 300, 8000);
      return;
    }
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const nk = THREE.MathUtils.clamp(this.vp.k * factor, 0.05, 5);
    // 以鼠标位置为锚点缩放
    const wp = this.screenToWorld(e.clientX, e.clientY);
    this.vp.x = wp.x - (wp.x - this.vp.x) * (this.vp.k / nk);
    this.vp.y = wp.y - (wp.y - this.vp.y) * (this.vp.k / nk);
    this.vp.k = nk;
    this.applyViewport();
    this.onViewportChange?.(this.getViewport());
  };

  private onKey = (e: KeyboardEvent): void => {
    if (this.camAnim) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!this.isLayerMode) return;
    switch (e.key.toLowerCase()) {
      case 'w': this.control.setMode('translate'); break;
      case 'e': if (this.rotateEnabled) this.control.setMode('rotate'); break; // 旋转默认关闭（待讨论）
      case 'r': this.control.setMode('scale'); break;
      case 'q': this.control.setSpace(this.control.space === 'world' ? 'local' : 'world'); break;
      case 'c': this.exit3D(); break;
    }
  };

  private bindEvents(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.resize);
  }

  resize = (): void => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.perspCam.aspect = w / h;
    this.perspCam.updateProjectionMatrix();
    // LineMaterial 分辨率同步（屏幕恒定线宽；组框已 SDF 化无 Line2，边线逐条同步）
    for (const e of this.edges) {
      (e.glow.material as LineMaterial).resolution.set(w, h);
      (e.line.material as LineMaterial).resolution.set(w, h);
    }
    if (this.connectPreview) {
      (this.connectPreview.glow.material as LineMaterial).resolution.set(w, h);
      (this.connectPreview.line.material as LineMaterial).resolution.set(w, h);
    }
    // 3D PIN hover 虚线球体（LineMaterial 同源：分辨率变化后线宽保持屏幕恒定）
    if (this.pinSphereG) {
      for (const c of this.pinSphereG.children) {
        (c as Line2).material.resolution.set(w, h);
      }
    }
    this.applyViewport();
  };

  // ==================== 渲染循环（非活跃 tick 关闭：dirty 驱动，静止时 rAF 完全暂停，GPU 零负载） ====================

  /**
   * 节点 Z 松手回弹动画（反馈 11：欠阻尼振荡 val = from·exp(-DAMP·t)·cos(STIFF·t)，Q 弹过冲后收敛；
   * 收敛阈值 0.5 世界单位 → 删除浮动 + 代理归位组平面；期间 markDirty 持续唤醒渲染链）
   */
  private updateNodeSprings(): void {
    if (this.nodeZSprings.size === 0) return;
    let changed = false;
    for (const [id, s] of this.nodeZSprings) {
      const t = (performance.now() - s.t0) / 1000;
      const val = s.from * Math.exp(-SPRING_DAMP * t) * Math.cos(SPRING_STIFF * t);
      if (Math.abs(val) < 0.5) {
        this.nodeZSprings.delete(id);
        this.nodeFloatZ.delete(id);
      } else {
        this.nodeFloatZ.set(id, val);
      }
      // 选中节点代理 Z 同步（TransformControls 非 dragging 时位置自由，回弹过程 gizmo 跟随跳动）
      if (this.selected?.id === id) {
        const n = this.selected;
        const baseZ = (n.data.groupId ? (this.groupZOffsets.get(n.data.groupId) ?? 0) : 0) + (this.nodeFloatZ.get(id) ?? 0);
        this.proxyObj.position.z = baseZ;
      }
      changed = true;
    }
    if (changed) {
      this.syncInstGroupZ();
      this.syncAllEdges(); // 连线 z 跟随浮动（回弹全程不断开）
      this.markDirty();
    }
  }

  /** 标记场景变化 → 唤醒渲染（交互/动画/参数变化时调用；静态时 rAF 停，省 CPU/GPU） */
  private markDirty(): void {
    this.dirty = true;
    if (this.disposed) return;
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (): void => {
    this.raf = 0;
    if (this.disposed) return;
    // 无变化 + 无动画 + 无活跃交互：不渲染（rAF 自然停止，非活跃 tick 关闭）
    if (!this.dirty && !this.camAnim && !this.interacting) return;
    this.dirty = false;
    if (this.camAnim) {
      this.updateCamAnim();
    } else if (this.isLayerMode) {
      this.updatePerspCam();
    }
    this.updateNodeSprings(); // 反馈 11：节点 Z 松手回弹（Q 弹振荡，内部 markDirty 驱动逐帧）
    // 3D：PIN quad billboard（SDF PIN 始终面向相机，透视下圆环保持正圆；2D 正视无需）
    if (this.isLayerMode) {
      this.scene.traverse((o) => { if (o.userData.pinQuad) o.quaternion.copy(this.camera.quaternion); });
    }
    this.renderer.render(this.scene, this.camera);
    this.sampleFps();
    this.cullTick();
    if (this.camAnim) this.markDirty(); // 动画期间持续唤醒
  };

  /** FPS 采样（500ms 窗口）+ 自适应降级判定（仅统计实际渲染帧，静止期不误判） */
  private sampleFps(): void {
    this.fpsCount++;
    this.fpsTimer += 16.7;
    if (this.fpsTimer < 500) return;
    const fps = this.fpsCount * 2;
    this.fpsTimer = 0;
    this.fpsCount = 0;
    if (this.adaptiveDegrade) {
      // 滞回防抖：连续 1s 低于 45 → 降一级；连续 1.5s 高于 55 → 回升一级
      if (fps < 45) this.lowFpsStreak++;
      else this.lowFpsStreak = 0;
      if (fps > 55) this.highFpsStreak++;
      else this.highFpsStreak = 0;
      if (this.lowFpsStreak >= 2) {
        this.degradeDown();
        this.lowFpsStreak = 0;
      } else if (this.highFpsStreak >= 3 && this.degradeLevel > 0) {
        this.degradeUp();
        this.highFpsStreak = 0;
      }
    }
    this.onPerfUpdate?.(fps, this.degradeLevel);
  }

  /** 降一级（L0→L4：pixelRatio 2→1.5 → 阴影关+段数减半 → pixelRatio 1+段数再减半 → 圆角归零） */
  private degradeDown(): void {
    if (this.degradeLevel >= 4) return;
    this.degradeLevel++;
    switch (this.degradeLevel) {
      case 1: this.renderer.setPixelRatio(Math.min(this.origPixelRatio, 1.5)); break;
      case 2:
        this.setShadowVisible(false);
        this.bezierSegments = Math.max(8, this.bezierSegments >> 1);
        this.syncAllEdges();
        break;
      case 3:
        this.renderer.setPixelRatio(1);
        this.bezierSegments = Math.max(4, this.bezierSegments >> 1);
        this.syncAllEdges();
        break;
      case 4: this.setStyle({ radiusTL: 0, radiusTR: 0, radiusBR: 0, radiusBL: 0 }); break;
    }
    this.onDegradeChange?.(this.degradeLevel);
  }

  /** 回升一级（反向恢复，滞回防抖；段数上限 32 = GUI 默认） */
  private degradeUp(): void {
    if (this.degradeLevel <= 0) return;
    switch (this.degradeLevel) {
      case 4: this.setStyle({ radiusTL: this.origRadius, radiusTR: this.origRadius, radiusBR: this.origRadius, radiusBL: this.origRadius }); break;
      case 3:
        this.renderer.setPixelRatio(1.5);
        this.bezierSegments = Math.min(32, this.bezierSegments << 1);
        this.syncAllEdges();
        break;
      case 2:
        this.setShadowVisible(true);
        this.bezierSegments = Math.min(32, this.bezierSegments << 1);
        this.syncAllEdges();
        break;
      case 1: this.renderer.setPixelRatio(this.origPixelRatio); break;
    }
    this.degradeLevel--;
    this.onDegradeChange?.(this.degradeLevel);
  }

  /** 屏幕外剔除节流（150ms；仅 2D 模式，3D 透视视锥由相机自然裁剪） */
  private cullTick(): void {
    this.cullTimer += 16.7;
    if (this.cullTimer < 150) return;
    this.cullTimer = 0;
    if (!this.cullEnabled) return;
    this.cullOutOfView();
  }

  /** 视口矩形粗筛：可视世界矩形外（+64px 缓冲）的实例 scale 0（退化三角形，GPU 光栅化阶段跳过）、
   * 图片 mesh/边/组框 visible=false。只写可见性变化的实例矩阵（拖动时不全量重写）；
   * 恢复时重建完整矩阵（setInstMatrix，z 跟随组偏移）。 */
  private cullOutOfView(): void {
    if (this.isLayerMode) return;
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    if (cw === 0 || ch === 0) return;
    const w = cw / this.vp.k, h = ch / this.vp.k;
    const minX = this.vp.x - w / 2, maxX = this.vp.x + w / 2;
    const minY = this.vp.y - h / 2, maxY = this.vp.y + h / 2;
    const pad = 64 / this.vp.k; // 屏幕外缓冲（阴影尾部/描边外扩）
    const visibleGroups = new Set<string>();
    for (const n of this.nodes.values()) {
      const x0 = n.data.x - n.data.w / 2, x1 = n.data.x + n.data.w / 2;
      const y0 = n.data.y - n.data.h / 2, y1 = n.data.y + n.data.h / 2;
      const vis = x1 >= minX - pad && x0 <= maxX + pad && y1 >= minY - pad && y0 <= maxY + pad;
      if (vis && n.data.groupId) visibleGroups.add(n.data.groupId);
      if (n.mesh) {
        n.mesh.visible = vis;
        if (n.imgShadow) n.imgShadow.visible = vis;
        continue;
      }
      const prev = this.cullState.get(n.instIndex);
      if (prev === undefined || prev !== vis) {
        this.cullState.set(n.instIndex, vis);
        if (vis) {
          this.setInstMatrix(n.instIndex, n.data.x, n.data.y, this.nodeWorldZ(n), n.data.w, n.data.h);
        } else {
          this.setInstHidden(n.instIndex);
        }
        this.instMesh.instanceMatrix.needsUpdate = true;
        this.shadowMesh.instanceMatrix.needsUpdate = true;
      }
    }
    // 边：任一端点在视口内则显示（端点粗判，廉价）
    for (const e of this.edges) {
      const a = this.nodes.get(e.a), b = this.nodes.get(e.b);
      const av = a ? a.data.x >= minX - pad && a.data.x <= maxX + pad && a.data.y >= minY - pad && a.data.y <= maxY + pad : false;
      const bv = b ? b.data.x >= minX - pad && b.data.x <= maxX + pad && b.data.y >= minY - pad && b.data.y <= maxY + pad : false;
      const v = av || bv;
      e.glow.visible = v;
      e.line.visible = v;
      e.pinGroup.visible = v;
    }
    // 组框：组内任一节点可见则显示（选中红晕不随 cull 关闭——反馈 11：cullOutOfView 曾覆盖选中 glow）
    for (const [gid, v] of this.groups) {
      const vis = visibleGroups.has(gid);
      v.mesh.visible = vis;
      v.title.visible = vis;
      // 选中光晕（选中态红晕由组框 shader 内绘制）随组可见性 + 选中态共存
      if (v.mesh.visible) (v.mesh.material as THREE.ShaderMaterial).uniforms.uSelected!.value = this.selectedGroup === gid ? 1 : 0;
    }
  }

  /** 实例隐藏（scale 0 退化三角形，GPU 光栅化阶段跳过；槽位保留，instIndex 不变式保持） */
  private setInstHidden(idx: number): void {
    this.instDummy.position.set(0, 0, -9999);
    this.instDummy.scale.set(0, 0, 1);
    this.instDummy.updateMatrix();
    this.instMesh.setMatrixAt(idx, this.instDummy.matrix);
    this.shadowMesh.setMatrixAt(idx, this.instDummy.matrix);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.wheelSettle);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.resize);
    // 反馈 11 新增对象清理：组框 SDF / 边线 / PIN hover / 连线预览
    for (const v of this.groups.values()) {
      (v.mesh.material as THREE.Material).dispose();
      v.mesh.geometry.dispose();
      const tm = v.title.material as THREE.MeshBasicMaterial;
      tm.map?.dispose();
      tm.dispose();
      v.title.geometry.dispose();
    }
    this.groups.clear();
    for (const e of this.edges) {
      e.glow.geometry.dispose();
      (e.glow.material as THREE.Material).dispose();
      e.line.geometry.dispose();
      (e.line.material as THREE.Material).dispose();
    }
    this.edges.length = 0;
    if (this.pinHoverG) {
      this.scene.remove(this.pinHoverG);
      for (const c of this.pinHoverG.children) {
        const m = c as THREE.Mesh;
        (m.material as THREE.Material)?.dispose();
        m.geometry?.dispose();
      }
    }
    if (this.pinSphereG) {
      this.scene.remove(this.pinSphereG);
      for (const c of this.pinSphereG.children) {
        const l = c as Line2;
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
    }
    if (this.connectPreview) {
      this.edgeRoot.remove(this.connectPreview.glow, this.connectPreview.line);
      this.connectPreview.glow.geometry.dispose();
      (this.connectPreview.glow.material as THREE.Material).dispose();
      this.connectPreview.line.geometry.dispose();
      (this.connectPreview.line.material as THREE.Material).dispose();
    }
    // 背景网格层（T2）
    if (this.bgQuad) {
      this.scene.remove(this.bgQuad);
      this.bgQuad.geometry.dispose();
      (this.bgQuad.material as THREE.Material).dispose();
    }
    this.renderer.dispose();
    el.remove();
  }
}

/** 程序生成演示纹理（渐变 + 编号，避免外部图片依赖） */
export function makeDemoTexture(seed: number, label: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 340; c.height = 240;
  const ctx = c.getContext('2d')!;
  const hue = (seed * 47) % 360;
  const g = ctx.createLinearGradient(0, 0, 340, 240);
  g.addColorStop(0, `hsl(${hue}, 65%, 38%)`);
  g.addColorStop(1, `hsl(${(hue + 60) % 360}, 70%, 22%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 340, 240);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 170, 120);
  const t = new THREE.CanvasTexture(c);
  // NoColorSpace 直通（同组标题纹理：sRGB 数据直出本色，防硬件解码变暗）
  t.anisotropy = 4;
  return t;
}
