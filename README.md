# MangaReplacer 使用说明

这是一个基于 Next.js 的漫画角色替换工具。你可以上传漫画截图或分镜图，给角色库添加参考图，然后让系统尽量在保留原画构图、姿势和画风的前提下完成角色替换。

当前版本支持两种主要工作模式：

- `Global Targets`
  适合“整张图的主角统一替换成某个目标角色”。
- `Mapped Subjects`
  适合“同一张漫画里有多个不同人物，并且每个人要分别替换成不同目标角色”。

## 1. 环境要求

- Node.js 18 或更高版本
- npm
- 可访问替换接口所依赖的 Gemini 网关服务

推荐在 Windows PowerShell 中运行下面的命令。

## 2. 安装依赖

```powershell
cd "C:\Users\yujj\Documents\New project"
npm.cmd install
```

## 3. 配置环境变量

在项目根目录创建 `.env.local`：

```env
GEMINI_GATEWAY_TOKEN=your_token_here
GATEWAY_TIMEOUT_MS=70000
REPLACE_DEBUG=0
```

变量说明：

- `GEMINI_GATEWAY_TOKEN`
  替换接口使用的网关令牌，建议显式配置。
- `GATEWAY_TIMEOUT_MS`
  单次请求超时时间，单位毫秒，默认 `70000`。
- `REPLACE_DEBUG`
  是否输出调试日志，`1` 为开启，默认 `0`。

## 4. 启动项目

### 开发模式

```powershell
cd "C:\Users\yujj\Documents\New project"
npm.cmd run dev
```

默认访问：

```text
http://localhost:3000
```

如果 `3000` 端口已经被旧实例占用，可以改用其他端口：

```powershell
cd "C:\Users\yujj\Documents\New project"
$env:PORT="3005"
npm.cmd run dev
```

然后访问：

```text
http://localhost:3005
```

### 生产模式

先构建：

```powershell
cd "C:\Users\yujj\Documents\New project"
npm.cmd run build
```

由于当前项目使用了 `standalone` 输出，生产运行更推荐直接启动 standalone 服务：

```powershell
cd "C:\Users\yujj\Documents\New project"
$env:PORT="3005"
$env:HOSTNAME="127.0.0.1"
node .next/standalone/server.js
```

### 桌面版调试与打包

本项目包含 Electron 配置。

调试桌面版：

```powershell
cd "C:\Users\yujj\Documents\New project"
npm.cmd run desktop:dev
```

打包便携版 EXE：

```powershell
cd "C:\Users\yujj\Documents\New project"
npm.cmd run build:exe
```

打包结果会输出到 `dist/` 目录。

## 5. 界面说明

主界面分为两部分：

- 左侧 `Character Library`
  用于维护目标角色参考图。
- 右侧 `Replacement Workbench`
  用于上传源图、绘制 ROI、切换模式、执行替换和导出结果。

### Character Library

这里可以：

- 添加角色名称
- 上传角色参考图
- 删除角色
- 在 `Global Targets` 模式下做单选或多选

角色库数据保存在当前浏览器的 `localStorage` 中，不会自动同步到服务器。

注意：

- 角色图在写入本地存储前会自动压缩
- 如果浏览器本地存储空间不足，最旧的角色可能不会被持久化
- 清空浏览器缓存或更换浏览器后，角色库不会自动保留

## 6. 使用流程

### 6.1 Global Targets 模式

适用场景：

- 一张图只需要替换一个主要人物
- 多张图要批量替换成同一个角色
- 多张图要分别生成多个目标角色版本

操作步骤：

1. 在左侧角色库中添加一个或多个目标角色。
2. 选择 `Single` 或 `Multi`。
3. 在右侧保持 `Global Targets` 模式。
4. 上传一张或多张源图。
5. 选中队列中的某张图。
6. 在源图上拖拽绘制 ROI，标记希望替换的人物区域。
7. 可选填写该源图的补充提示词。
8. 点击 `Execute Batch Replace`。
9. 处理完成后点击 `下载 ZIP` 导出结果。

补充说明：

- `Single` 模式下，当前批次使用一个目标角色。
- `Multi` 模式下，会为当前批次里的每张源图分别生成多个目标角色版本。

### 6.2 Mapped Subjects 模式

适用场景：

- 同一张漫画里有两个人或更多人
- 每个人要替换成不同的目标角色
- 需要对每个人分别指定不同 ROI 和不同备注

操作步骤：

1. 先在左侧角色库中添加所有目标角色参考图。
2. 在右侧点击 `Mapped Subjects`。
3. 上传源图并从队列中选中一张图。
4. 在 `Subject Mappings` 区域点击 `Add Subject`，为图中的每个人添加一个 slot。
5. 给每个 slot 设置：
   - `Subject label`
   - 目标角色
   - 可选备注
6. 点击某个 slot 的 `Edit ROI` 或 `Active ROI`。
7. 回到源图区域，在图上拖拽框出该人物对应的 ROI。
8. 对所有人物重复以上步骤，直到每个 slot 都有目标角色和 ROI。
9. 点击执行按钮生成结果。
10. 处理完成后点击 `下载 ZIP` 导出结果。

这个模式下的核心逻辑是：

- 一张源图只生成一张最终合成结果
- 每个 subject slot 对应一个人物
- 每个人物都可以绑定不同目标角色
- 每个人物都可以有不同的备注说明

## 7. ROI 使用建议

为了提升替换稳定性，建议：

- 框住完整人物，而不是只框头部
- 不要把无关人物一起框进去
- 尽量避免把大面积背景或对话框也包含进去
- 两个人物靠得很近时，尽量分别框清楚
- 如果人物有特殊姿势或道具，可以在备注里说明“保留姿势”“保留伞”“保留坐姿”等

## 8. 提示词建议

每张源图都可以填写补充提示词。建议把它当作“补充约束”使用，而不是重写整张画面。

适合写的内容：

- 保留左侧人物坐姿
- 保留右侧人物举手动作
- 保留制服轮廓
- 保留桌面和杯子
- 保持原表情强度

不建议写得过于发散，例如：

- 把整个场景改成另一个时代
- 大幅改变镜头构图
- 重做背景

## 9. 当前版本限制

- `Mapped Subjects` 模式下，当前一次只处理“当前选中的那一张源图”，不是对整个队列批量执行。
- 单次多人映射请求最多支持 `4` 个 subject mapping。
- 当前前端实际请求的是 `1` 个候选结果，不会一次返回多张候选图供挑选。
- 角色库只保存在本地浏览器，不做云端同步。

## 10. 常见问题

### 页面里看不到 `Mapped Subjects`

通常是因为你打开的是旧的开发实例。

处理方式：

1. 回到旧终端，按 `Ctrl + C` 停掉旧服务。
2. 在当前项目目录重新执行：

```powershell
cd "C:\Users\yujj\Documents\New project"
npm.cmd run dev
```

3. 重新打开页面。

如果仍然不确定，可以换一个新端口：

```powershell
cd "C:\Users\yujj\Documents\New project"
$env:PORT="3005"
npm.cmd run dev
```

### 请求报错或超时

请检查：

- `.env.local` 中的 `GEMINI_GATEWAY_TOKEN` 是否正确
- 本机网络是否能访问对应网关
- `GATEWAY_TIMEOUT_MS` 是否需要调大

### 替换结果不稳定

可尝试：

- 缩小或重画 ROI
- 给每个人物补充更明确的备注
- 选择更清晰的目标角色参考图
- 避免一张图中人物 ROI 大面积重叠

### 角色库突然消失

角色库保存在浏览器本地存储中。以下情况都可能导致数据丢失：

- 清空浏览器缓存
- 更换浏览器
- 打开了无痕模式
- 本地存储空间不足导致旧角色未持久化

## 11. 常用命令

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run build
npm.cmd run desktop:dev
npm.cmd run build:exe
```

## 12. 关键文件

- `app/page.tsx`
  页面主逻辑，负责队列、模式切换、请求发起和结果管理。
- `components/ReplacerWorkbench.tsx`
  工作台 UI，包括 `Global Targets` 和 `Mapped Subjects` 两种模式。
- `components/CharacterLibrary.tsx`
  角色库 UI。
- `hooks/useCharacterStore.ts`
  本地角色库存储逻辑。
- `app/api/replace/route.ts`
  替换接口代理与多人映射请求处理逻辑。

## 13. 推荐的首次试用方式

如果你第一次使用，建议按下面顺序验证：

1. 先添加 2 个目标角色
2. 上传 1 张有 2 个人物的漫画图
3. 切换到 `Mapped Subjects`
4. 添加 2 个 subject slot
5. 给两个人分别指定不同目标角色
6. 分别框出两个人的 ROI
7. 点击执行替换
8. 检查最终结果是否符合预期

如果这一步能跑通，再继续尝试批量模式或桌面版打包。
