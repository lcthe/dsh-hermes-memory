# dsh-hermes-memory V8 设计规范：可复用技能记忆

**日期：** 2026-09-04
**状态：** 待实现

## 1. 目标

V8 从成功的复杂任务中提炼可复用流程，并通过 DSH 原生 skill registry、catalog 和 `skill` 加载工具提供给后续会话。Hermes 负责持久化、候选生成、安全校验和 provider；DSH 负责技能发现、作用域合并、模型目录和按需加载。

插件不复制 Pi 的技能运行时，也不在记忆插件中实现第二套技能 catalog 或加载工具。

## 2. 数据模型

新增 `skills` 表，每条记录包含：

- 稳定 ID；
- kebab-case `name`；
- 有界 `description`；
- Markdown `content`；
- `scope: 'user' | 'project'`；
- project scope 必需的 `projectKey`；
- `createdAt`、`updatedAt`；
- 来源 session ID、flush sequence 和提炼方式；
- `schemaVersion: 1`。

名称在同一有效 scope 内唯一。项目技能只在精确匹配的当前工作区可见；用户技能对所有工作区可见，且 DSH 原生更近作用域的同名技能优先级规则保持权威。

## 3. DSH 原生 provider

Hermes 在 `ctx.skills` 可用时注册一个持久化 provider：

- `list({ cwd })` 从技能表返回当前用户和授权项目的摘要；
- `get(candidate, { cwd })` 重新读取记录并再次验证作用域；
- 新增、更新或删除技能后触发 provider invalidation；
- provider 释放后不再发出变更；
- `ctx.skills` 不存在时，普通记忆功能继续工作，技能工具返回稳定的 `skill_service_unavailable`。

provider 返回 DSH `SkillDefinition`，默认允许模型和用户调用。技能正文由 DSH 原生 `skill` 工具按需加载，不注入普通 memory context。

## 4. 管理工具

新增四个工具：

- `memory_skill_create`；
- `memory_skill_list`；
- `memory_skill_update`；
- `memory_skill_remove`。

所有写操作执行名称、描述、正文、scope、workspace 和安全校验。更新使用稳定 ID，不能用 project 参数越权移动记录；scope 变更必须显式删除后重建。列表只返回有界摘要，查看完整正文通过 DSH 原生 skill loader 完成。

## 5. 自动技能提炼

自动提炼默认关闭。启用后，在 session flush 时仅对满足复杂度门槛的成功任务调度：默认至少 8 次成功工具调用且至少使用 2 种不同工具，并且 session 尚未针对该 flush sequence 完成技能评估。

复用 V5 的后台 job、结构化 subagent、最小 session 投影和 review 状态模式，但使用独立的 skill-review 状态。模型只能返回 `create` 候选：名称、描述、正文、scope 和理由。Host 负责：

- 确认任务没有未解决的失败结尾；
- 校验结构和字符预算；
- 强制 project scope 绑定当前工作区；
- 执行安全扫描；
- 检查同名和近似重复；
- 限制每个 session 最多创建 1 个技能；
- 保存来源并触发 provider invalidation。

自动提炼不得更新或删除现有技能；同名候选直接跳过，后续修改由显式工具完成。

## 6. 设置

新增设置：

- `skillLearningEnabled`，默认 `false`；
- `skillMinToolCalls`，默认 `8`；
- `skillMinDistinctTools`，默认 `2`；
- `skillMaxContentChars`，默认 `8_000`；
- `skillDefaultScope`，默认 `project`。

设置页增加“技能学习”卡片。它只管理开关和预算，不显示技能正文或模型凭据。

## 7. 测试和验收

- user/project 技能按 cwd 正确出现在 DSH 原生 catalog；
- project 技能不能从其他工作区列出或加载；
- provider invalidation 使新增、更新和删除在后续 catalog 读取中可见；
- 名称、描述、正文、scope、安全扫描和字符预算均被 Host 校验；
- 不满足复杂度门槛、任务失败、设置关闭或无 provider 时不提炼；
- 同一 flush 不重复评估，同名候选不覆盖已有技能；
- 自动提炼每个 session 最多创建一个技能且不能更新或删除；
- 插件 teardown 正确释放 provider 和后台任务；
- 普通记忆在 `ctx.skills` 不可用时仍正常工作；
- typecheck、测试、build 和打包检查通过。

## 8. 非目标

- 不直接写入 DSH 或 Agents 的用户文件夹；
- 不实现脚本、二进制和任意附件生成；首版技能只有受限 Markdown 正文；
- 不自动覆盖同名技能；
- 不让模型绕过 DSH 原生 catalog 和 loader。
