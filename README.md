<div align="center">

<img src="resources/icon.png" alt="NebuShell" width="96" height="96" />

# NebuShell

**An AI‑agent‑powered SSH client / 由 AI 智能体驱动的运维终端**

_A Termius‑style SSH client with a built‑in AI ops agent that can run, diagnose, and operate your servers — with your confirmation._

<sub>Powered by Mrtoken</sub>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/SoySauceJYZ/NebuShell?style=flat&logo=github)](https://github.com/SoySauceJYZ/NebuShell/stargazers)
[![Release](https://img.shields.io/github/v/release/SoySauceJYZ/NebuShell?include_prereleases&sort=semver)](https://github.com/SoySauceJYZ/NebuShell/releases)
[![Electron](https://img.shields.io/badge/Electron-2b2e3b?logo=electron&logoColor=9feaf9)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-20232a?logo=react&logoColor=61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-646cff?logo=vite&logoColor=white)](https://electron-vite.org/)

[English](#english) · [中文](#中文) · [Download](https://github.com/SoySauceJYZ/NebuShell/releases) · [GitHub](https://github.com/SoySauceJYZ/NebuShell)

</div>

---

<a id="english"></a>

## English

### Overview

**NebuShell** is a cross‑platform desktop SSH client with a first‑class AI ops agent baked in. Connect to your servers, open multiple terminals, browse and edit remote files over SFTP, and let the built‑in agent run commands, read their output, and carry out operations for you — always behind an explicit plan‑and‑confirm workflow, so nothing runs on your machines without your say‑so.

Everything is stored locally and secured by a master‑password vault. No cloud account required.

### Features

- 🖥️ **Multi‑tab terminals** — xterm.js terminals with a fit addon, web links, and per‑theme styling. Split the layout to watch several sessions side by side.
- 🤖 **Built‑in AI ops agent** — an OpenAI‑compatible agent that can `run_command`, `read_command_output`, `ask_user`, and `present_plan`. It proposes a plan, asks for confirmation, then executes across one or many terminals.
- 🔐 **Encrypted vault** — hosts, passwords, and SSH keys are protected behind a master password; the keychain never leaves your machine.
- 📁 **SFTP file browser** — dual‑pane remote/local file management with drag‑and‑drop transfers and a live transfer queue.
- 📝 **Built‑in editor** — a Monaco (VS Code) editor for quickly editing remote and local files, with syntax highlighting.
- 🖼️ **Image preview** — open remote images directly in a tab.
- 🗂️ **Host management** — organize connections, duplicate sessions, reconnect, and jump between them from the tab bar.
- 📜 **History docs** — keep track of past sessions and documents.
- 📊 **System monitor** — glance at load, memory, and other host vitals.
- 🎨 **Light / dark themes** — a clean, modern UI that adapts to your OS.

### Screenshots

> 📸 Add a screenshot to `docs/screenshot.png` and it will show here.
> A ready-made landing page lives at [`docs/index.html`](docs/index.html) — open it in a browser or publish it via GitHub Pages.

### Tech Stack

| Layer      | Tech |
| ---------- | ---- |
| Shell      | [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/) |
| UI         | [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + Tailwind CSS |
| Terminal   | [@xterm/xterm](https://xtermjs.org/) |
| Editor     | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| SSH / SFTP | [ssh2](https://github.com/mscdex/ssh2) |
| State      | [Zustand](https://github.com/pmndrs/zustand) |

### Getting Started

**Prerequisites:** [Node.js](https://nodejs.org/) 18+ and npm.

```bash
# Clone the repo
git clone https://github.com/SoySauceJYZ/NebuShell.git
cd NebuShell

# Install dependencies
npm install

# Start in development mode
npm run dev
```

> Prefer a prebuilt binary? Grab the latest from the
> [Releases page](https://github.com/SoySauceJYZ/NebuShell/releases).

### Build

```bash
# Windows  →  dist/NebuShell-<version>-setup.exe
npm run build:win

# macOS    →  dist/NebuShell-<version>.dmg   (must be built on macOS)
npm run build:mac

# Linux    →  dist/NebuShell-<version>.AppImage (+ snap / deb)
npm run build:linux

# Unpacked directory (quick smoke test, no installer)
npm run build:unpack
```

### Configuring the AI Agent

The agent talks to any **OpenAI‑compatible** endpoint. Open the agent settings in‑app and provide:

- **Base URL** — e.g. `https://api.openai.com/v1` or your own gateway
- **API Key**
- **Model** — e.g. `gpt-4o`, `claude-...` via a compatible proxy, or a local model

The agent will refuse to run until all three are set.

### Project Structure

```
src/
├── main/           # Electron main process
│   ├── ssh/        # SSH connection manager
│   ├── sftp/       # SFTP manager
│   ├── vault/      # Encrypted credential vault
│   ├── llm/        # LLM client (OpenAI-compatible)
│   └── ipc/        # IPC handlers
├── preload/        # Preload bridge
└── renderer/       # React UI (terminals, SFTP, editor, agent panel)
```

### Credits

- **Developer:** jiayizhen
- **From:** Mrtoken
- **Built with:** Claude & Codex
- **AI compute:** provided by Mrtoken

### License

Released under the [MIT License](LICENSE). © 2026 Mrtoken.

---

<a id="中文"></a>

## 中文

### 简介

**NebuShell** 是一款跨平台桌面 SSH 客户端,内置了一流的 AI 运维智能体。你可以连接服务器、打开多个终端、通过 SFTP 浏览与编辑远程文件,并让内置智能体替你执行命令、读取输出、完成运维操作——所有操作都遵循「先出计划、确认后执行」的流程,没有你的同意,不会在你的机器上跑任何命令。

所有数据都保存在本地,并由主密码保险库加密,无需注册云账号。

### 功能特性

- 🖥️ **多标签终端** —— 基于 xterm.js,支持自适应、网页链接识别和主题化;可分屏并排查看多个会话。
- 🤖 **内置 AI 运维智能体** —— 兼容 OpenAI 接口,支持 `run_command`(执行命令)、`read_command_output`(读取输出)、`ask_user`(向你提问)、`present_plan`(给出计划)。先出方案、征得确认,再在一个或多个终端上执行。
- 🔐 **加密保险库** —— 主机、密码和 SSH 密钥都由主密码保护,密钥库永不离开本机。
- 📁 **SFTP 文件浏览器** —— 远程/本地双栏文件管理,支持拖拽传输和实时传输队列。
- 📝 **内置编辑器** —— 集成 Monaco(VS Code 同款)编辑器,快速编辑远程与本地文件,支持语法高亮。
- 🖼️ **图片预览** —— 直接在标签页中打开远程图片。
- 🗂️ **主机管理** —— 整理连接、复制会话、一键重连,并可在标签栏之间快速切换。
- 📜 **历史文档** —— 记录过往会话与文档。
- 📊 **系统监控** —— 一眼查看负载、内存等主机指标。
- 🎨 **明暗主题** —— 简洁现代的界面,随系统自动切换。

### 界面预览

> 📸 把截图放到 `docs/screenshot.png` 即可在此显示。
> 项目自带一个介绍页 [`docs/index.html`](docs/index.html) —— 用浏览器打开,或通过 GitHub Pages 发布即可。

### 技术栈

| 层级      | 技术 |
| --------- | ---- |
| 外壳      | [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/) |
| 界面      | [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + Tailwind CSS |
| 终端      | [@xterm/xterm](https://xtermjs.org/) |
| 编辑器    | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| SSH/SFTP  | [ssh2](https://github.com/mscdex/ssh2) |
| 状态管理  | [Zustand](https://github.com/pmndrs/zustand) |

### 快速开始

**环境要求:** [Node.js](https://nodejs.org/) 18+ 及 npm。

```bash
# 克隆仓库
git clone https://github.com/SoySauceJYZ/NebuShell.git
cd NebuShell

# 安装依赖
npm install

# 开发模式启动
npm run dev
```

> 想直接用安装包?到
> [Releases 页面](https://github.com/SoySauceJYZ/NebuShell/releases) 下载最新版本。

### 打包构建

```bash
# Windows  →  dist/NebuShell-<版本号>-setup.exe
npm run build:win

# macOS    →  dist/NebuShell-<版本号>.dmg   (需在 macOS 上打包)
npm run build:mac

# Linux    →  dist/NebuShell-<版本号>.AppImage(以及 snap / deb)
npm run build:linux

# 仅解压目录(快速验证,不生成安装包)
npm run build:unpack
```

### 配置 AI 智能体

智能体支持任意 **兼容 OpenAI** 的接口。在应用内打开智能体设置,填写:

- **Base URL** —— 例如 `https://api.openai.com/v1` 或你自建的网关
- **API Key**
- **模型** —— 例如 `gpt-4o`、通过兼容代理的 `claude-...`,或本地模型

三项未配置齐全前,智能体不会执行任何操作。

### 目录结构

```
src/
├── main/           # Electron 主进程
│   ├── ssh/        # SSH 连接管理
│   ├── sftp/       # SFTP 管理
│   ├── vault/      # 加密凭据保险库
│   ├── llm/        # LLM 客户端(兼容 OpenAI)
│   └── ipc/        # IPC 处理
├── preload/        # 预加载桥接
└── renderer/       # React 界面(终端、SFTP、编辑器、智能体面板)
```

### 致谢

- **开发者:** jiayizhen
- **来源:** Mrtoken
- **构建开发:** 由 Claude 与 Codex 构建开发
- **AI 算力:** 由 Mrtoken 提供

### 开源协议

基于 [MIT 协议](LICENSE) 发布。© 2026 Mrtoken。

---

<div align="center">
<sub>开发者 jiayizhen · 来源 Mrtoken · 由 Claude 与 Codex 构建开发 · AI 算力由 Mrtoken 提供</sub>
<br />
<sub>Made with ❤️ · Powered by <strong>Mrtoken</strong></sub>
</div>
