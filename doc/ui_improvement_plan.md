# Motif 前端 UI/UX 改进计划

> 版本：v1.1（阶段 A/B/C 已完成）
> 阶段归属：P3（与网页抓取器并行）
> 技术栈：React 18 + Tailwind CSS 3.4 + shadcn/ui + Radix UI + Zustand 5
> 审查依据：`vercel-react-best-practices` + `ui-design-system` skill

---

## 目录

1. [现状评估](#1-现状评估)
2. [设计方向](#2-设计方向)
3. [改造清单](#3-改造清单)
4. [影响分析与风险](#4-影响分析与风险)
5. [执行路线图](#5-执行路线图)
6. [技术栈补充](#6-技术栈补充)
7. [验收标准](#7-验收标准)

---

## 1. 现状评估

### 1.1 优势

| 维度 | 状态 |
|------|------|
| 技术栈 | shadcn/ui + Radix + Tailwind + Zustand，现代且轻量 |
| 暗色主题 | 自定义 HSL token 系统，整体色调统一 |
| 响应式 | 双模布局（desktop sidebar / mobile bottom nav），`useGridZoom` pinch-zoom 网格 |
| 组件化 | shadcn/ui 原语 + 自定义业务组件，`cn()` 统一 class 合并 |
| 交互细节 | 星级评分渐变动效、LightBox 手势仲裁、全图放大模式（PC 鼠标映射 + 移动端 pinch-to-zoom） |

### 1.2 待改进项

| 维度 | 问题 |
|------|------|
| 设计 token | 仅一层语义 token，缺少原语层和组件层；`--muted` 与 `--secondary` 值完全相同（冗余） |
| 对比度 | `--muted-foreground`（55% 亮度）在深色背景上勉强过 WCAG AA |
| 字号 | `text-[11px]`、`text-[9px]` 等任意值低于推荐最小 12px |
| 间距 | `px-3 sm:px-6`、`py-2 sm:py-3` 到处散落，无统一 spacing scale |
| 动效 | 仅 hover scale + 星级动画，缺少页面过渡、骨架屏、入场动画 |
| 表面层次 | 纯色平面卡片，缺少阴影/玻璃态的深度感 |
| 排版 | 系统字体堆栈，数字非等宽，现代感不足 |
| 性能 | Zustand 全量订阅（`useXxxStore()` 无 selector），大网格触发不必要 re-render |
| isMobile 检测 | 3 种不一致方式（`innerWidth`、`ontouchstart`、`pointer: coarse`） |

---

## 2. 设计方向

### 2.1 目标风格：精致层次 + 微动效

关键词：**现代、简洁、即时响应、深度感**

| 维度 | 改造前 | 实际实现 |
|------|--------|----------|
| 表面 | 纯色 `bg-card` | 保持纯色 `bg-card`（玻璃态实测不协调，已取消） |
| 边框 | 实线 `border-border` | 保持不变 |
| 圆角 | 统一 `0.5rem` | 层级分明：新增 `xl` 圆角档 |
| 阴影 | 无 | Dialog `shadow-2xl shadow-black/30`，卡片 hover `shadow-lg shadow-black/30` |
| 动效 | hover scale | 骨架屏 → `fade-in-up` stagger 入场 → hover 微缩放 + shadow |
| 排版 | 系统字体 | Inter Variable（`@fontsource-variable/inter`） |
| 色彩强调 | 单一 indigo | 保持 indigo 主色（渐变按钮实测不协调，已取消） |
| 空状态 | 纯文字 | `EmptyState` 组件（icon + title + description + action） |

### 2.2 三层 Token 架构

```css
:root {
  /* ── Tier 1: 原语（不可变色值） ── */
  --gray-950: 222 20% 7%;
  --gray-900: 222 18% 12%;
  --gray-800: 222 18% 18%;
  --gray-700: 222 18% 22%;
  --gray-500: 222 18% 30%;
  --gray-400: 210 15% 60%;   /* 提亮：55% → 60%，确保 AA */
  --gray-100: 210 20% 90%;
  --indigo-400: 238 76% 75%;
  --indigo-500: 238 70% 60%;
  --purple-500: 270 60% 60%;
  --red-500: 0 62.8% 30.6%;

  /* ── Tier 2: 语义（主题感知，切换主题只改这层） ── */
  --background: var(--gray-950);
  --foreground: var(--gray-100);
  --surface: var(--gray-900);          /* 替代 --card */
  --surface-raised: var(--gray-800);   /* 替代 --muted / --secondary */
  --surface-overlay: var(--gray-700);  /* 替代 --accent */
  --text-primary: var(--gray-100);
  --text-secondary: var(--gray-400);   /* 替代 --muted-foreground */
  --border: var(--gray-700);
  --accent: var(--indigo-400);
  --destructive: var(--red-500);

  /* ── Tier 3: 组件级 ── */
  --header-height: 3.5rem;
  --sidebar-collapsed: 4rem;
  --sidebar-expanded: 12rem;
  --card-radius: 0.75rem;
  --button-radius: 0.5rem;
  --page-padding-x: 0.75rem;         /* mobile */
  --page-padding-x-sm: 1.5rem;       /* desktop */
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 200ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

> **迁移策略**：在 `index.css` 中定义新 Tier 1 原语，然后将 Tier 2 语义映射回现有 CSS 变量名（`--card`、`--muted` 等），**不改变 Tailwind class 名**，实现零迁移成本的 token 升级。后续逐步在新代码中使用语义名。

### 2.3 间距规范

| Token | Mobile | Desktop | 用途 |
|-------|--------|---------|------|
| `--space-page-x` | `0.75rem` (px-3) | `1.5rem` (px-6) | 页面水平内边距 |
| `--space-section-y` | `0.5rem` (py-2) | `0.75rem` (py-3) | 区块垂直间距 |
| `--space-inline` | `0.25rem` (gap-1) | `0.5rem` (gap-2) | 行内元素间距 |
| `--space-card-gap` | `2px` | `8px` | 网格卡片间距（useGridZoom 控制） |

### 2.4 字号规范

| 用途 | 最小值 | 推荐 Tailwind class |
|------|--------|---------------------|
| 正文 | 14px | `text-sm` |
| 次要信息 | 12px | `text-xs` |
| Badge/徽标 | 10px | `text-[10px]` |
| 禁止使用 | <10px | — |

---

## 3. 改造清单

### 3.1 阶段 A — 安全基础（已完成）

| # | 改造项 | 涉及文件 | 状态 | 说明 |
|---|--------|----------|------|------|
| A1 | `--muted-foreground` 亮度 55%→60% | `index.css` | 已完成 | `--gray-400: 210 15% 60%` |
| A2 | `text-[11px]` → `text-xs` (12px) | PersonCard, AlbumCard, PersonHome | 已完成 | 最小字号合规 |
| A3 | `text-[9px]` → `text-[10px]` | Sidebar, BottomNav | 已完成 | Badge 字号提升 |
| A4 | `text-[10px]` → `text-xs` | PersonHome, AlbumDetail, TaskDetailDialog | 已完成 | 统一次要信息字号 |
| A5 | 合并 `--muted` 与 `--secondary` | `index.css` | 已完成 | 注释标注两者为同一值 |
| A6 | Tier 1 原语定义 | `index.css` | 已完成 | Tier 1 原语 + Tier 2 `var()` 映射，零迁移 |

### 3.2 阶段 B — 视觉升级（已完成）

| # | 改造项 | 涉及文件 | 状态 | 说明 |
|---|--------|----------|------|------|
| B1 | 引入 Inter 字体 | `main.tsx`, `index.css` | 已完成 | `@fontsource-variable/inter`，`main.tsx` 中 import |
| B2 | ~~主按钮渐变~~ | — | 已取消 | 渐变效果实测不协调，保持 `bg-primary` 纯色 |
| B3 | 卡片 hover 精致化 | MediaCard, PersonCard, AlbumCard | 已完成 | `scale-[1.02] + shadow-lg shadow-black/30` |
| B4 | ~~浮层玻璃态~~ | — | 已取消 | `backdrop-blur` 性能影响 + 视觉不协调，Sidebar/Dialog 保持 `bg-card` 纯色，Dialog 增强 `shadow-2xl` |
| B5 | 圆角层级化 | `tailwind.config.ts` | 已完成 | 新增 `xl` 圆角档 |
| B6 | 空状态组件 | MediaLibrary, PersonHome, AlbumDetail, Workspace, TaskQueue, RecycleBin | 已完成 | `EmptyState` 组件（icon + title + description + action） |
| B7 | 骨架屏组件 | `Skeleton.tsx` + 4 页面 | 已完成 | `Skeleton` / `SkeletonGrid` 替代"加载中..."文字 |

### 3.3 阶段 C — 体验打磨（已完成）

| # | 改造项 | 涉及文件 | 状态 | 说明 |
|---|--------|----------|------|------|
| C1 | 卡片入场 stagger fade-in | MediaCard, PersonCard, AlbumCard | 已完成 | CSS `animate-fade-in-up` + `animIndex` prop，延迟上限 600ms |
| C2 | ~~路由过渡动画~~ | — | 已取消 | 实测 opacity 过渡造成页面闪动和切换延迟，已移除 |
| C3 | isMobile 检测统一 | `hooks/useDevice.ts` + 13 消费文件 | 已完成 | `useDevice()` → `{ isMobile, isTouch }`，`isTouch` 模块级常量 |
| C4 | `prefers-reduced-motion` 支持 | `index.css` | 已完成 | 禁用动画和 backdrop-blur（替代原方案的运行时降级） |

### 3.4 阶段 D — 性能优化（高收益，需谨慎）

| # | 改造项 | 涉及文件 | 改动量 | 说明 |
|---|--------|----------|--------|------|
| D1 | Zustand selector — 高频组件 | MediaCard, PersonCard, AlbumCard | 3 文件 | `useXxxStore(s => s.field)` 或 `useShallow` |
| D2 | Zustand selector — 页面级 | 所有 pages + 主要 components | ~20 文件 | 全量改造，可分批 |
| D3 | 大列表虚拟化 | AlbumDetail, PersonHome | 2 文件 + useGridZoom 改造 | `@tanstack/react-virtual`，需重写网格逻辑 |
| D4 | `content-visibility: auto` 过渡方案 | 网格容器 CSS | 1-2 处 | D3 之前的轻量替代 |

---

## 4. 影响分析与风险

### 4.1 按改造项风险评级

| 级别 | 改造项 | 风险说明 |
|------|--------|----------|
| **无风险** | A1, A5, A6, B6 | 仅新增或改 CSS 值，不影响组件逻辑 |
| **低风险** | A2-A4, B1-B3, B5, B7, C1 | 视觉微调，需验证紧凑区域不溢出 |
| **中风险** | B4, C2, C3, C4 | `backdrop-blur` 性能、路由过渡影响 LightBox portal、isMobile 统一需覆盖 10 文件 |
| **高风险** | D1-D3 | Zustand 改造涉及 20+ 文件全量重写消费模式；虚拟化需重写 useGridZoom + 网格布局 |

### 4.2 关键兼容性风险

| 风险点 | 影响范围 | 缓解策略 |
|--------|----------|----------|
| **Layout JS isMobile 删除** | Sidebar 轮询 + BottomNav 在桌面端多余挂载 | **不删除**，保留 JS 检测；仅统一 hook 提取 |
| **Inter 字体字宽差异** | FilterBar 下拉、badge 可能截断 | 安装后全量截图 E2E 回归 |
| **backdrop-blur + 视频** | LightBox 视频帧率下降 | LightBox 内不用 blur；仅 Sidebar/Dialog 用 |
| **Zustand selector 改造** | 函数签名变化可能遗漏字段 | TypeScript 编译时检查 + E2E 全量回归 |
| **虚拟化 + pinch-zoom** | useGridZoom 的 CSS Grid 与 react-virtual 的 absolute 定位冲突 | 需完全重写网格，作为独立 PR |
| **骨架屏替换加载态** | 现有 `loading ? "加载中..." : content` 逻辑变更 | 条件分支保持一致 |

### 4.3 不变更项

以下现有功能**不受任何改造项影响**，无需回归：

- ComfyUI 集成（client.py / workflow.py / workflows）
- 后端 API 全量接口
- 数据库模型和迁移
- 文件路径引用机制
- 任务队列串行执行
- 导入流程（文件夹扫描/剪贴板）
- 评分计算逻辑
- 软删除 / 回收站机制
- 多选 / 批量操作逻辑

---

## 5. 执行路线图

### P3-UI 阶段划分

```
P3-UI-A  安全基础        ────  已完成  ──── 合并至 rewrite/v2
  │
P3-UI-B  视觉升级        ────  已完成  ──── 合并至 rewrite/v2
  │
P3-UI-C  体验打磨        ────  已完成  ──── 合并至 rewrite/v2
  │
P3-UI-D  性能优化        ────  待开始  ──── 独立 PR，分批合并
```

### 与现有 P3 的关系

P3 现有计划为**网页图片抓取器 + 平台账号管理**，UI 改进作为 P3 的并行模块：

| P3 子模块 | 内容 | 依赖 |
|-----------|------|------|
| **P3-Scraper** | 网页图片抓取器（小红书/B站/Twitter/Telegram/通用） | 独立 |
| **P3-UI** | 前端 UI/UX 改进（本文档） | 独立，与 Scraper 无依赖 |

两者可并行开发，P3-UI-A/B 可在 P3-Scraper 开发期间穿插完成。

### 每阶段交付物

| 阶段 | 交付物 | 验收方式 | 状态 |
|------|--------|----------|------|
| A | index.css token 三层架构 + 字号修复 + WCAG AA 对比度 | E2E 截图对比 | 已完成 |
| B | Inter 字体 + 骨架屏 + 空状态组件 + 卡片 hover shadow | E2E 截图审查 | 已完成 |
| C | useDevice hook + 入场 stagger 动画 + reduced-motion | E2E 截图 + 手动交互测试 | 已完成 |
| D | Zustand selector + 虚拟化 | 性能 profiling（React DevTools） + E2E 全量回归 | 待开始 |

---

## 6. 技术栈补充

| 用途 | 推荐包 | 版本 | 理由 |
|------|--------|------|------|
| 字体 | `@fontsource-variable/inter` | latest | 现代 UI 标配，可变字重，本地加载无 FOUT |
| 动画 | `framer-motion` | ^11 | React 生态最佳，手势+布局动画+退出动画 |
| 虚拟化 | `@tanstack/react-virtual` | ^3 | 轻量，与 React 18 兼容，hooks-based |
| Zustand 优化 | `zustand/shallow`（内置） | — | `useShallow` 自 Zustand 4.5+ 内置 |

> **实际引入**：阶段 A/B/C 仅引入 `@fontsource-variable/inter`，未引入 `framer-motion`（路由过渡已取消）。`@tanstack/react-virtual` 待阶段 D 引入。

---

## 7. 验收标准

### 7.1 通用标准

- [ ] 所有现有 E2E 测试通过
- [ ] 所有截图经 Claude 视觉审查确认布局正确
- [ ] WCAG AA 对比度：正文 ≥ 4.5:1，次要文字 ≥ 4.5:1，UI 控件 ≥ 3:1
- [ ] 最小字号 ≥ 10px，正文最小 12px
- [ ] 桌面端（1080p/2K/4K）+ 移动端（375px/414px）双模式正常

### 7.2 阶段 A 验收

- [x] `--muted-foreground` 对比度 ≥ 4.5:1（`--gray-400: 210 15% 60%`）
- [x] 无 `text-[11px]` 或更小的任意值（badge `text-[10px]` 除外）
- [x] Tier 1 原语变量定义在 `index.css`，Tier 2 通过 `var()` 映射
- [x] 所有页面视觉无破坏性变化

### 7.3 阶段 B 验收

- [x] Inter 字体正确加载，无 FOUT 闪烁（`@fontsource-variable/inter` 本地加载）
- [x] ~~主按钮渐变色~~ → 保持纯色 `bg-primary`（渐变视觉不协调，已取消）
- [x] 卡片 hover 有 shadow 层次感（`shadow-lg shadow-black/30`）
- [x] ~~Sidebar / Dialog 玻璃态~~ → 保持 `bg-card` 纯色，Dialog 增强阴影（玻璃态性能/视觉问题，已取消）
- [x] 所有"加载中..."替换为 `SkeletonGrid` 骨架屏
- [x] 所有空列表使用 `EmptyState` 组件（icon + title + description + action）

### 7.4 阶段 C 验收

- [x] ~~路由过渡动画~~ → 已取消（造成页面闪动和切换延迟）
- [x] `useDevice` hook 统一 13 个消费文件的设备检测
- [x] 卡片网格有入场 stagger 动画（`animate-fade-in-up`，最大延迟 600ms）
- [x] `prefers-reduced-motion` 媒体查询禁用动画和 blur

### 7.5 阶段 D 验收

- [ ] React DevTools Profiler：网格滚动时 MediaCard 无不必要 re-render
- [ ] 1000+ 媒体列表滚动流畅（≥ 30fps）
- [ ] pinch-zoom 功能正常（虚拟化后）
- [ ] 所有右键菜单、多选、LightBox 索引映射正确

---

## 附录：现有 CSS Token 迁移映射

| 现有 Tailwind class | 现有 CSS 变量 | 新 Tier 2 语义 | 改动方式 |
|---------------------|---------------|----------------|----------|
| `bg-background` | `--background` | `--background` | 不变 |
| `text-foreground` | `--foreground` | `--foreground` | 不变 |
| `bg-card` | `--card` | `--surface` | CSS 变量映射，class 不改 |
| `bg-muted` | `--muted` | `--surface-raised` | CSS 变量映射，class 不改 |
| `bg-secondary` | `--secondary` | `--surface-raised` | CSS 变量映射，class 不改 |
| `bg-accent` | `--accent` | `--surface-overlay` | CSS 变量映射，class 不改 |
| `text-muted-foreground` | `--muted-foreground` | `--text-secondary` | CSS 变量映射，class 不改 |
| `bg-primary` | `--primary` | `--accent` | CSS 变量映射，class 不改 |
| `border-border` | `--border` | `--border` | 不变 |
| `bg-destructive` | `--destructive` | `--destructive` | 不变 |

> **核心迁移策略**：只在 `index.css` 中新增 Tier 1 原语，让 Tier 2 `--card` 等现有变量指向原语。Tailwind class（`bg-card`、`text-muted-foreground` 等）完全不改，实现**零文件迁移**的 token 架构升级。
