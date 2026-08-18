# 角色三视图生成规范（Character Turnaround）

> 用于「同一角色」的正面 / 侧面 / 背面三种角度参考图，保证长篇小说 / 短剧中同一角色在数百个镜头里外貌一致。
> 配合 `ai_image` 工具的 `mode: 'turnaround'` 使用；也可由 Agent 编排为「3 次单图 + add_variant」的拆分形态。

---

## 一、两种生成形态

| 形态 | 做法 | 产出 | 适用 |
|---|---|---|---|
| **A. 单张并排** | 一次 `ai_image(mode='turnaround')`，一张图内并排呈现 3 个角度 | 1 张三视图参考图 | 模型支持「转面/角色卡」时 |
| **B. 拆成 3 张** | 3 次 `ai_image(mode='standard')`，分别生成正面 / 侧面 / 背面，存入 3 个 `variant` | 3 张独立角度图 | 模型转面不稳时（更稳，推荐） |

> Agent 决策：优先尝试 A；若结果同一性差，回退 B 拆 3 张并标注各角度。

---

## 二、prompt 模板（供 `ai_image`）

### 形态 A：单张并排（`mode='turnaround'` 自动拼接）
```
{主体描述}, character turnaround reference sheet,
three views side by side: front view (facing camera), side profile, back view,
same character, same clothing and wardrobe, same hair style, same lighting angle,
consistent body proportions, neutral studio background, full body, character design sheet
```

### 形态 B：拆 3 张（`mode='standard'`，每次只改角度词）
```
{主体描述}, front view, facing the camera, full body, same character, studio neutral background
{主体描述}, side profile view, facing left, full body, same character, studio neutral background
{主体描述}, back view, from behind, full body, same character, studio neutral background
```

---

## 三、一致性六大要点（跨角度必须严格一致）

1. **外貌**：发型、脸型、瞳色、肤色、标志性特征（痣/疤/纹身）逐字复用，不得改写。
2. **服装**：同一套着装与配色（含配饰、鞋履、发饰）。
3. **光源**：三个角度使用**同一主光源方向与色温**（如统一左侧 45° 柔光），避免各角度光色不同。
4. **比例**：全身、头身比一致；禁止某角度被裁切或俯仰变化过大。
5. **体态/步态**：同一个站姿与人物气质（源自表演档案）。
6. **背景**：统一中性纯色棚拍背景，避免背景元素干扰主体识别。

> 以上全部来自 `ai_image` 的 mode 内部拼接，Agent 只需提供 `{主体描述}` 与 `model`。

---

## 四、与表演档案（acting-performance）配合

- 生成前先取该角色的 `appearance` + `wardrobe` + `consistencyPrompt` 作为 `{主体描述}` 的基底。
- 三视图只描述**静态外貌**，**禁止**混入情绪/动作临时态（微笑/奔跑/惊讶），确保可作为一致性锚点。

---

## 五、落地到数据

- 形态 A：一张图 → `replace_entity_image(entityId, storageKey)` 作为主形象。
- 形态 B：三张图 → `add_variant(entityId, { name: '正面'|'侧面'|'背面', imageStorageKey })`，分别存入 `variants`。
- 依赖 `character-prompts.md` 的主体提示词质量规范作为 `{主体描述}` 的写法基准。