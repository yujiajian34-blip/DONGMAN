# 🎨 DONGMAN - 漫画角色替换助手

> 基于 Next.js 与 Gemini AI 的智能漫画面板角色替换工具

[![Next.js](https://img.shields.io/badge/Next.js-15.5-black?style=flat&logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-blue?style=flat&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.2-38B2AC?style=flat&logo=tailwind-css)](https://tailwindcss.com)

## ✨ 核心功能

- 🖼️ **批量图像处理**：支持一次性上传多张漫画面板进行角色替换
- 🎭 **角色库管理**：本地保存并管理目标角色参考图，支持增删改查
- 🎯 **ROI 区域选择**：手动绘制感兴趣区域，实现精准角色定位替换
- 🤖 **AI 智能驱动**：集成 Gemini 3.1 Flash Image Preview，生成高质量替换结果
- 📦 **一键打包导出**：处理完成后自动打包为 ZIP 文件，支持批量下载
- 🗜️ **智能压缩存储**：自动压缩角色图片，优化 localStorage 使用，支持存储 10+ 角色
- 🌓 **响应式适配**：完美适配桌面端与移动端，随时随地使用

## 🚀 快速开始

### 环境要求
- Node.js 18 或更高版本
- npm 或 pnpm 包管理器
- Gemini Gateway API 访问权限

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/yujiajian34-blip/DONGMAN.git
cd DONGMAN

# 安装依赖
npm install

# 配置环境变量（详见下方配置说明）
# 创建 .env.local 文件并填入您的 API 凭证

# 启动开发服务器
npm run dev
```

### 使用流程

1. 浏览器访问 `http://localhost:3000`
2. **添加目标角色**：在左侧角色库面板上传参考图像
3. **上传源图像**：将待处理的漫画面板添加到工作台队列
4. **配置 ROI**（可选）：在源图像上绘制区域，精确定位替换范围
5. **执行替换**：点击「执行批量替换」按钮开始 AI 处理
6. **预览结果**：查看生成的候选结果，选择最佳方案
7. **导出成品**：点击「下载 ZIP」批量导出所有处理完成的图像

## 📁 项目结构

```
DONGMAN/
├── app/
│   ├── api/replace/route.ts    # Gemini API 网关代理路由
│   ├── page.tsx                # 主应用页面组件
│   ├── layout.tsx              # 根布局组件
│   └── globals.css             # 全局样式文件
├── components/
│   ├── CharacterLibrary.tsx    # 角色库管理组件
│   └── ReplacerWorkbench.tsx   # 图像处理工作台组件
├── hooks/
│   └── useCharacterStore.ts    # 本地存储状态管理 Hook
├── utils/
│   └── compressImage.ts        # 图片压缩工具函数
├── package.json                # 项目依赖配置
├── tsconfig.json              # TypeScript 编译配置
└── README.md                  # 项目说明文档（本文件）
```

## ⚙️ 配置说明

### 环境变量

在项目根目录创建 `.env.local` 文件，配置以下变量：

```env
# Gemini 网关配置
GEMINI_GATEWAY_TOKEN=您的网关访问令牌
GATEWAY_TIMEOUT_MS=70000

# 可选：启用调试日志
REPLACE_DEBUG=1
```

> ⚠️ **安全提示**：`.env.local` 文件已加入 `.gitignore`，请勿将其提交到版本仓库。生产环境请通过安全的配置管理方式注入环境变量。

### API 网关说明

本项目通过 `/api/replace` 路由代理请求至 Gemini AI 网关。使用前请确保：
- 已配置有效的网关端点 URL（见 `app/api/replace/route.ts`）
- 已通过 `GEMINI_GATEWAY_TOKEN` 环境变量提供认证凭证
- 网络环境可正常访问网关服务

## 🛠️ 开发指南

### 可用脚本

| 命令 | 功能说明 |
|------|----------|
| `npm run dev` | 启动开发服务器，监听 `localhost:3000` |
| `npm run build` | 构建生产环境版本 |
| `npm run start` | 启动生产服务器 |
| `npm run typecheck` | 执行 TypeScript 类型检查 |

### 代码规范

- 启用 TypeScript 严格模式，确保类型安全
- 遵循 Next.js 默认 ESLint 规则
- 推荐使用 Prettier 进行代码格式化

## 🔍 技术实现详解

### 图像处理流程

1. **上传阶段**：用户选择漫画面板，客户端转换为 base64 编码
2. **预处理**：可选 ROI 区域绘制 + 自定义提示词输入
3. **API 请求**：向 `/api/replace` 发送 POST 请求，携带源图 + 目标角色图
4. **网关代理**：服务端转发请求至 Gemini 网关，含重试与超时保护
5. **结果评分**：客户端基于像素分析计算候选结果质量分数
6. **结果展示**：自动展示最优结果，支持手动切换备选方案
7. **批量导出**：通过 JSZip 生成 ZIP 文件，触发浏览器下载

### 存储优化方案

- 角色图片在存入 localStorage 前自动压缩（最大宽度 512px，JPEG 70% 质量）
- 有效避免 "quota exceeded" 错误，单角色存储体积减少约 70%
- 压缩工具实现：`utils/compressImage.ts`，使用 Canvas API 客户端处理

### 错误处理机制

- 网关调用超时保护（可通过 `GATEWAY_TIMEOUT_MS` 配置）
- 客户端重试逻辑：网络波动时自动重试 1 次
- 用户友好提示：错误信息转化为可操作建议，避免技术术语

## 🤝 贡献指南

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature-name`
3. 提交更改：`git commit -m 'feat: add your feature'`
4. 推送分支：`git push origin feature/your-feature-name`
5. 提交 Pull Request 并描述变更内容

## 📄 开源许可

本项目为私有项目，版权归仓库所有者所有。如需商用或二次开发，请联系作者获取授权。

## 🙏 致谢

- [Next.js](https://nextjs.org) - React 全栈框架
- [Tailwind CSS](https://tailwindcss.com) - 原子化 CSS 框架
- [lucide-react](https://lucide.dev) - 精美 SVG 图标库
- [JSZip](https://stuk.github.io/jszip/) - 客户端 ZIP 生成库
- [file-saver](https://github.com/eligrey/FileSaver.js) - 文件保存工具

---

> **注意**：本应用依赖 Gemini AI 网关服务，部署前请确保已获取有效 API 凭证并配置网络访问权限。

🔗 **代码仓库**：https://github.com/yujiajian34-blip/DONGMAN  
📧 **联系作者**：通过 GitHub Issues 或仓库主页获取联系方式
