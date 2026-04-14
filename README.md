# 🎨 DONGMAN - 漫画角色替换助手

> 基于 Next.js 与 Gemini AI 的智能漫画面板角色替换工具，支持批量处理、ROI 精确定位与一键导出。

[![Next.js](https://img.shields.io/badge/Next.js-15.5-black?style=flat&logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-blue?style=flat&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue?style=flat&logo=typescript)](https://www.typescriptlang.org)

## ✨ 核心功能

- 🖼️ **批量处理**：一次性上传多张漫画面板，自动队列执行替换
- 🎭 **角色库管理**：本地保存目标角色参考图，支持增删改查
- 🎯 **ROI 区域选择**：手动绘制替换区域，精准控制效果范围
- 🤖 **AI 智能替换**：集成 Gemini 3.1 Flash Image Preview，保持原画风与构图
- 📦 **一键导出**：处理完成后自动打包为 ZIP，支持批量下载
- 🗜️ **存储优化**：自动压缩角色图片，节省 70% 本地存储空间

## 🚀 快速开始

```bash
# 克隆项目
git clone https://github.com/yujiajian34-blip/DONGMAN.git
cd DONGMAN

# 安装依赖
npm install

# 配置环境变量（创建 .env.local）
echo "GEMINI_GATEWAY_TOKEN=your_token" > .env.local

# 启动开发服务器
npm run dev
```

访问 `http://localhost:3000` 即可使用。

## ⚙️ 关键配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `GEMINI_GATEWAY_TOKEN` | Gemini 网关访问令牌 | 必填 |
| `GATEWAY_TIMEOUT_MS` | API 请求超时时间 | `70000` |
| `REPLACE_DEBUG` | 启用调试日志 | `0` |

> 🔐 `.env.local` 已加入 `.gitignore`，请勿提交敏感信息。

## 📁 项目结构

```
DONGMAN/
├── app/
│   ├── api/replace/route.ts  # AI 网关代理路由
│   ├── page.tsx              # 主应用页面
│   └── layout.tsx            # 根布局
├── components/
│   ├── CharacterLibrary.tsx  # 角色库组件
│   └── ReplacerWorkbench.tsx # 替换工作台
├── hooks/
│   └── useCharacterStore.ts  # 本地状态管理
├── utils/
│   └── compressImage.ts      # 图片压缩工具 ✨
└── package.json              # 项目配置
```

## 🛠️ 开发命令

| 命令 | 功能 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建生产版本 |
| `npm run start` | 启动生产服务器 |
| `npm run typecheck` | TypeScript 类型检查 |

## 🔗 相关链接

- 🌐 在线演示：[待部署]
- 📚 完整文档：仓库 Wiki（规划中）
- 🐛 问题反馈：[GitHub Issues](https://github.com/yujiajian34-blip/DONGMAN/issues)

---

> 💡 **提示**：本应用依赖 Gemini AI 网关服务，使用前请确保已配置有效 API 凭证。

🔗 **仓库地址**：https://github.com/yujiajian34-blip/DONGMAN
