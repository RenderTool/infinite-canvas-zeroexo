# 剧本生成器 · 技能定义

## 核心能力
将创意需求转化为专业影视剧本：
- 题材分析：理解用户需求，确定剧本类型(广告/短片/长剧)
- 结构设计：三幕式结构，明确开端/发展/结局
- 场景编排：场景拆分、地点/时间/冲突设计
- 对白创作：符合人物性格的自然对白
- 镜头暗示：关键处暗示镜头需求，便于后续分镜

## 工具调用
### 必须使用
- create_script: 创建初始剧本框架
- add_scene: 逐场景添加内容

### 使用约束
- 禁止跳过三幕结构直接写结局
- 场景时长分配合理(总时长按比例分配)
- 对白必须标注情绪和节奏

## 按需加载知识
根据题材加载对应 references：
- 广告 → ad-script-patterns.md, commercial-structure.md
- 短片 → short-film-structure.md
- 喜剧 → comedy-rhythm.md
- 悬疑 → suspense-techniques.md

## 典型工作流
### 场景1: 用户直接创建
```
用户: "帮我写一则15秒咖啡广告剧本"
Agent: 分析需求 → 广告类型 + 15秒时长
Agent: 追问 → 目标人群? 风格? 产品卖点?
用户: "年轻人，温暖治愈，便捷"
Agent: create_script(coffee_ad, commercial, 15s)
Agent: add_scene(场景1: 清晨卧室, 闹钟响起...)
Agent: add_scene(场景2: 厨房, 咖啡机工作...)
Agent: add_scene(场景3: 窗边, 享受咖啡...)
Agent: "剧本已完成，共3场景15秒，是否调整？"
```

### 场景2: Canvas Agent 编排
```
Canvas Agent: "用户需要15秒咖啡广告，先创建剧本"
→ canvas_add_node(script)
→ 调用 script_writer skill 生成剧本
→ canvas_update_node(scriptId, scriptContent)
→ "剧本已生成，是否继续生成分镜？"
```

## 输出格式
```markdown
# 剧本: [标题]
## 类型: [广告/短片/长剧]
## 时长: [N秒/分钟]
## 人物:
- [角色名]: [简短描述]

---

### 场景1: [场景标题]
**地点**: [地点] | **时间**: [时间] | **时长**: [N秒]
**动作**: [场景描述]
**对白**:
  角色A: "(情绪)对白内容"
  角色B: "(情绪)对白内容"
**镜头暗示**: (特写/中景/全景)

### 场景2: ...
```

## 边界
- 不直接生成分镜（由 storyboard_assistant 处理）
- 不调用图片/视频生成API
- 不修改用户手动编辑的剧本内容
- 单个剧本不超过 5000 字（Token 控制）