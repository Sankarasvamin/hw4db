# HW4DB AML App

本仓库是数据库课程作业项目，主题为反洗钱侦察系统。项目包含一个 Next.js 前端、Supabase/PostgreSQL 数据库结构、查询接口，以及论文写作用的数据流图和 ER 图材料。

## 主要内容

- `app/`：Next.js 页面和 API 路由。
- `components/`：检索界面和表格展示组件。
- `lib/`：Supabase 查询与服务端访问逻辑。
- `supabase/migrations/`：数据库迁移 SQL。
- `mLaundering.md`：反洗钱系统数据库 DDL 设计文档。
- `数据流图+ER图.png`：原始合并图。
- `数据流图1.png` 至 `数据流图6.png`：裁剪后的数据流图。
- `ER图1.png` 至 `ER图4.png`：裁剪后的 ER 图。
- `图片插入latex.md`：论文中插入上述图片的 LaTeX 代码片段。

## 本地运行

```bash
pnpm install
pnpm dev
```

项目依赖 Supabase 环境变量。请参考 `.env.example` 创建本地 `.env`，不要提交真实密钥。

## 图片说明

裁剪图片保留透明背景，适合直接用于 LaTeX 论文排版。若 LaTeX 浮动体位置影响阅读顺序，可以配合 `float` 与 `placeins` 包使用 `[H]` 和 `\FloatBarrier` 控制图片位置。
