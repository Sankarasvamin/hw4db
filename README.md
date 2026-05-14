# HW4DB AML Intelligence App

本仓库是数据库课程作业项目，主题为反洗钱侦察系统（Anti-Money Laundering, AML）。项目包含数据库设计、Supabase/PostgreSQL 查询接口、Next.js 前端检索页面，以及论文写作所需的数据流图和 ER 图材料。

## 项目目标

系统围绕银行交易反洗钱场景展开，重点展示以下数据库设计与应用能力：

- 使用关系型数据库组织用户、账户、交易、风控规则、预警和调查案件等核心实体。
- 通过 SQL 查询支持反洗钱场景中的风险检索、异常交易分析和结构化结果展示。
- 使用 Supabase 作为 PostgreSQL 后端，并通过 Next.js 页面提供可交互的查询入口。
- 为课程论文提供数据流图、ER 图和 LaTeX 插图代码，保证设计文档与实现材料一致。

## 技术栈

- Next.js 15
- React 19
- TypeScript
- Supabase / PostgreSQL
- Tailwind CSS
- pnpm

## 目录结构

```text
.
├── app/                         # Next.js 页面与 API 路由
├── components/                  # 查询界面与表格展示组件
├── lib/                         # Supabase 管理端访问与 AML 查询逻辑
├── supabase/migrations/         # PostgreSQL 迁移脚本
├── mLaundering.md               # AML 数据库 DDL 设计文档
├── seed_supabase_aml.py         # Supabase 示例数据写入脚本
├── 数据流图+ER图.png             # 原始合并图
├── 数据流图1.png ... 数据流图6.png
├── ER图1.png ... ER图4.png
└── 图片插入latex.md             # 论文插图 LaTeX 代码
```

## 本地运行

安装依赖：

```bash
pnpm install
```

复制环境变量模板并填写本地配置：

```bash
cp .env.example .env
```

启动开发服务器：

```bash
pnpm dev
```

构建生产版本：

```bash
pnpm build
```

## 环境变量

项目依赖 Supabase 和模型调用相关环境变量。请参考 `.env.example` 创建本地 `.env` 文件，并注意不要提交真实密钥。

常用变量包括：

- `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`

## 数据库材料

数据库设计主要集中在两个位置：

- `mLaundering.md`：完整 DDL 文档，适合阅读表结构、主外键关系和业务约束。
- `supabase/migrations/`：可执行的迁移 SQL，用于在 Supabase/PostgreSQL 中创建项目所需函数或结构。

如需写入示例数据，可根据本地 `.env` 配置运行：

```bash
python seed_supabase_aml.py
```

## 论文图表

仓库保留了论文写作用图：

- `数据流图1.png` 至 `数据流图6.png`：数据流图。
- `ER图1.png` 至 `ER图4.png`：局部或全局 ER 图。
- `图片插入latex.md`：每张图对应的 LaTeX `figure` 环境。

图片保留透明背景，适合直接插入论文。若 LaTeX 渲染时图片浮动到错误章节，可以在导言区加入：

```latex
\usepackage{float}
\usepackage{placeins}
```

并在图片环境中使用 `[H]`，在小节末尾使用 `\FloatBarrier` 控制浮动范围。

## 版本管理说明

`.env`、`.next/`、`node_modules/`、虚拟环境和缓存文件均已通过 `.gitignore` 排除。仓库只保存源码、数据库脚本、课程文档和论文图表材料。
