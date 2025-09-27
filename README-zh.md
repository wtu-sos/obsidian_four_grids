# Obsidian 插件（纯 JS 模式）— Four Grids

这是一个与 obsidian-sample 风格一致的最简纯 JavaScript 插件骨架工程。

## 简介
- 插件入口：`main.js`（CommonJS 格式，直接被 Obsidian 读取）
- 插件清单：`manifest.json`
- 可选版本映射：`versions.json`
- 可选样式：`styles.css`（若存在将自动加载）
- 无需 Node、npm、打包流程，拷贝即可使用。

## 安装与启用
1. 打开你的库（Vault）目录下的 `.obsidian/plugins/` 文件夹。
2. 将本项目文件夹复制到其中，例如：
   ```
   .obsidian/plugins/ob-four-grids/
     ├─ manifest.json
     ├─ main.js
     ├─ versions.json   (可选)
     └─ styles.css      (可选)
   ```
3. 进入 Obsidian 设置 → 社区插件 → 启用 `Four Grids` 插件。

## 功能（示例）
- 命令面板：
  - “示例命令：显示提示” → 弹出 `Notice` 提示。
- Ribbon（左侧图标）：
  - 点击显示提示。
- 状态栏：
  - 显示 `ob-four-grids ready` 文本。
- 设置面板：
  - 一个文本设置项（示例）。

## 目录结构说明
- `main.js`：插件主文件，导出类继承 Obsidian 的 `Plugin`。
- `manifest.json`：插件元信息（`id`、`name`、`version`、`minAppVersion`、`main` 等）。
- `versions.json`：维护版本到最低兼容 Obsidian 版本的映射（可选）。
- `styles.css`：插件样式（可选）。

## 与 obsidian-sample 的差异
- 保持“纯 JS 模式”，无需打包。
- API 使用与结构对齐 sample：使用 `require('obsidian')`，包含命令、Ribbon、状态栏、设置面板等最小示例。

## 开发建议
- 若后续需要更复杂的工程（TypeScript/打包/类型提示），可迁移到 TS + esbuild 模式；但在“纯 JS 模式”中不需要任何构建步骤。
- 你可以直接修改 `main.js` 来添加命令、视图、事件监听、文件操作等。

## 许可证
- 推荐使用 MIT 许可证。
- 可在本工程根目录添加 `LICENSE` 文件（我可以为你自动生成）。

## 参考
- Obsidian 官方示例：`obsidian-sample` 项目结构与最小插件写法
- 社区中文教程：https://forum-zh.obsidian.md/t/topic/37149
