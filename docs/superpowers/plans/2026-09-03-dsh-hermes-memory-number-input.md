# Hermes Memory 数字输入框优化实施计划

## 目标与约束

把记忆设置页的数字输入框调整为接近 DSH 原生 Input 的样式。实现范围只包含客户端样式和对应的样式回归测试，不改变设置数据结构、数值校验或保存流程。

## 实施步骤

### 任务 1：先补数字输入框样式回归测试

- [x] 在 `tests/client-styles.test.mjs` 增加测试，检查数字输入框具备 32px 高度、8px 圆角、DSH 背景/边框/品牌色 token，以及隐藏数字微调箭头的规则。
- [x] 运行 `node --import tsx --test tests/client-styles.test.mjs`，确认新增断言在当前样式上失败。

### 任务 2：实现 DSH 风格数字输入框

- [x] 在 `src/client/memory-settings.module.css` 为 `.field input[type='number']` 增加 DSH Input 的尺寸、内边距、边框、背景、字体和文字颜色。
- [x] 增加键盘聚焦样式、禁用样式和 WebKit/标准数字输入外观规则。
- [x] 保留现有响应式宽度规则及组件中的 `type="number"`、`min`、`max` 和 `onChange`。

### 任务 3：验证并提交

- [x] 运行客户端测试、`npm run typecheck`、`npm run build` 和 `git diff --check`。
- [x] 检查构建产物包含新 DSH token 且没有回退到旧的 `--dsh-fg-*` token。
- [x] 提交为 `feat(client): polish memory number inputs`。

### 任务 4：采用 DSH 原生设置卡片布局

- [x] 在 `src/client/MemorySettings.tsx` 为设置分组增加说明、展开状态和键盘可访问的折叠按钮，基础记忆默认展开，其余分组默认收起。
- [x] 在 `src/client/memory-settings.module.css` 增加 DSH 卡片边框、圆角、背景、分隔线和折叠箭头样式，保留即时保存和现有控件。
- [x] 在 `tests/client-styles.test.mjs` 增加卡片结构和样式回归断言。
- [x] 运行客户端测试、`npm run typecheck`、`npm run build` 和 `git diff --check`，然后提交卡片化布局改动。
