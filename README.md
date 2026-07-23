<div align="center">

<img src="resources/icon.png" alt="NebuShell" width="96" height="96" />

# NebuShell

<p>
  <strong>Creator / Owner: jiayizhen</strong><br />
  <strong>Companies: MrToken &amp; Nebulaedata</strong>
</p>

<p>
  <img alt="Creator: jiayizhen" src="https://img.shields.io/badge/Creator-jiayizhen-6ee7ff?style=for-the-badge" />
  <img alt="Company: MrToken" src="https://img.shields.io/badge/Company-MrToken-f5a524?style=for-the-badge" />
  <img alt="Company: Nebulaedata" src="https://img.shields.io/badge/Company-Nebulaedata-4ade80?style=for-the-badge" />
</p>

**An AI‑agent‑powered SSH client / 由 AI 智能体驱动的运维终端**

_A modern SSH client with a built‑in AI ops agent that can run, diagnose, and operate your servers — with your confirmation._

<sub>Powered by MrToken &amp; Nebulaedata · Created by jiayizhen</sub>

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

- 🖥️ **Multi‑tab terminals & flexible split view** — xterm.js terminals with a fit addon, web links, and per‑theme styling. Split any pane **right or down** from the tab‑strip buttons, keep splitting the split‑out panes **recursively** into any grid, **drag tabs** between panes (drop on an edge to make a new split, on the center to merge), **drag a tab out of the window** to tear it off into its own window (the live session moves with it), and drag the dividers to resize.
- 🤖 **Built‑in AI ops agent** — an OpenAI‑compatible agent that can `run_command`, `transfer_file`, `read_command_output`, `ask_user`, and `present_plan`. It proposes a plan, asks for confirmation, then executes across one or many terminals — **and on your local machine** (PowerShell on Windows, `/bin/sh` on macOS/Linux), with the same approval flow. It can also **move files** between your machine, your hosts, and your containers — the confirm card tells you the file count and total size before you approve. **Send it images** too — paste a screenshot, pick a file, or drag one into the composer.
- 🔐 **Encrypted vault** — hosts, passwords, and SSH keys are protected behind a master password; the keychain never leaves your machine. **Trust this device** to skip the password on future launches.
- 📁 **SFTP file browser** — dual‑pane remote/local file management with drag‑and‑drop transfers and a live transfer queue. **Create files and folders** from the toolbar or by **right‑clicking blank space** in the listing.
- 🐳 **Docker container management** — a per‑host container panel (live `docker ps`, start/stop/restart, logs, sudo auto‑detect), one‑click **container terminals** via `docker exec` PTY, and a **container file browser** built on `docker cp` tar streaming — browse, edit‑and‑save, and drag files between your PC and any running container.
- 📝 **Built‑in editor** — a Monaco (VS Code) editor for quickly editing remote and local files, with syntax highlighting. **Ctrl+S** saves a remote file straight back to the server (and snapshots a history version).
- 🖼️ **Image preview** — open remote images directly in a tab.
- 🗂️ **Host management** — organize connections into groups, **search by name or address**, **right‑click a host** to connect / duplicate / edit, edit host details **inline** with a save button, and **rename & reorder groups** from a group manager (the order flows through to the list). Duplicate sessions, reconnect, and jump between them from the tab bar.
- ⌨️ **Command history & command palette** — every command you type is saved locally per server (tagged **User** / **Agent**) and shared across that host's tabs; a history panel splits **Local** vs the server's own `~/.bash_history`. Triple‑tap **Ctrl** to open a tabbed palette that searches history and runs quick actions — picking a command drops it into the prompt **without executing**.
- 📜 **History docs** — keep track of past sessions and documents.
- 📊 **System monitor** — per‑core CPU with a live sparkline, a memory donut, network up/down rates, per‑mount disk usage with read/write I/O, and a process manager you can search and kill from.
- 🎨 **Light / dark themes** — a clean, modern UI that adapts to your OS.

### What's New

**Recent updates (July 2026)**

- ⚡ **Custom quick commands** _(2026‑07‑23)_ — the terminal's **快捷操作 (Quick actions)** panel now lets you **save your own batches of commands**: give a title, description, and a block of commands, then run the whole batch into the current terminal with one click — a **测试 (Test)** button tries it live while you edit. Pick a **server** in the form and the command becomes **server‑bound** — clicking it **opens a new tab, connects to that host, and runs the batch on connect**. A new **快捷操作** entry in the left sidebar lists every server‑bound command as a one‑click launch card, and everything shows up in the **triple‑Ctrl command palette** too. Commands are persisted locally.
- 🌲 **Directory tree in the file browser** _(2026‑07‑23)_ — every file panel (**SFTP**, **container files**, and **local**) gains a lazy‑loaded **directory tree** down the left side. Click a folder to jump the listing there; the tree auto‑expands and highlights the current path, and **right‑click a node** to create / rename / delete a folder in place. A toolbar toggle shows/hides it — collapsed by default in the narrow embedded panel, expanded in the full‑page explorer. The local tree roots at the current drive.
- 📦 **The agent can transfer files** _(2026‑07‑21)_ — the agent gains a **`transfer_file`** tool that moves files and directories between your machine, your SSH hosts, and your containers — **no more `scp` / `rsync` guesswork**. It reuses the app's own transfer pipeline (SFTP, or `docker cp` tar streaming for containers), so there is **no password prompt to answer and no terminal timeout to hit** — which is exactly why asking the model to improvise an `scp` never worked. Supported routes: **local ↔ SSH host**, **SSH host ↔ SSH host** (streamed A→B inside the app), and **local ↔ container**; unsupported pairs (container ↔ SSH, container ↔ container) don't fail — they return clear guidance to relay via your machine in two steps. Before you approve, the confirm card runs a **dry‑run scan** and tells you exactly what you're agreeing to (**N files · X MB**), then shows a **live progress bar**, and the transfer lands in the same records panel as a drag‑and‑drop. Permissions follow the existing modes: in **替我审批** mode **downloads auto‑run** while **uploads always ask**, and **plan mode blocks both**. Directories go recursively; `dest_path` is a **directory** and the source name is preserved.
- 🛡️ **Agent tool‑dispatch hardening** _(2026‑07‑21)_ — two silent‑failure paths closed. Unknown tool names used to **fall through to the shell branch** and get run as an empty command on a real terminal; they are now rejected explicitly. And transfer endpoints now **resolve strictly** — a target name that doesn't match is an error that lists the valid names, instead of quietly falling back to the first target, which would have written your files to the **wrong machine**.
- 🐳 **Manage Docker containers on your hosts** _(2026‑07‑17)_ — every connected terminal gains a **容器 (Containers)** side panel that live‑polls `docker ps -a`: state badges, image & ports, **start / stop / restart**, and **logs** in one click (opens `docker logs --tail 500` in an editor tab). **Docker access is auto‑detected** — plain `docker` first, then passwordless `sudo -n docker`, with a friendly hint (and re‑detect button) when neither works. Open a **container terminal** straight from the list: a dedicated exec‑PTY session running `docker exec -it` (bash with sh fallback) where resize, reconnect on exit, duplicate/split, and tear‑off all just work. Browse **container files** in the same dual‑pane explorer as SFTP — powered by `docker cp` tar streaming (binary‑safe, no tools required inside the container) plus GNU/busybox‑aware `ls` parsing: edit & **save files back into the container** (with version history), create/rename/delete, **drag & drop between local and container** with live transfer progress. Inside a container terminal, the right‑side file panel now browses the **container's** filesystem, not the host's. Also entry points from the hosts page: right‑click a host → **查看容器**.
- ⚡ **Opening SFTP no longer freezes the app** _(2026‑07‑17)_ — the Windows drive probe used to check A:–Z: with synchronous calls on the main process, so a stale network drive could hang the whole app for 20+ seconds (measured 22.3s → 1.0s worst case). It now probes all drives **in parallel, asynchronously, with a 1s per‑drive timeout** and a short cache. Directory listing also stats entries **in parallel** instead of one‑by‑one (5,100‑entry folder: 435ms → 31ms).
- 💻 **The agent can now operate your local machine** _(2026‑07‑16)_ — the agent panel gains an always‑available **本机 (local machine)** target alongside your SSH terminals — ask it to browse local folders, inspect processes, or run any local command, and mix local + remote steps in one task. On Windows commands run through **PowerShell** with end‑to‑end UTF‑8 handling (Chinese file names and native tools like `ipconfig`/`systeminfo` decode cleanly, no mojibake, no CLIXML noise); on macOS/Linux they run through `/bin/sh`. The system prompt teaches the model the right command set per OS (e.g. `Select-String` instead of `grep` on Windows), and a **PowerShell‑aware risk classifier** keeps the existing permission modes working locally — reads auto‑run, writes still ask first, plan mode still blocks them. Every run is a fresh process with the same 12s‑idle / 180s hard timeout as SSH commands, the whole process tree is killed on timeout, and long output flows into the same `#ref` paged‑retrieval pipeline.
- 🗂️ **Host management, leveled up** _(2026‑07‑15)_ — the hosts page gains a **search box** that filters by **name or address** as you type; **right‑click any host card** for a quick menu (**连接 / 复制 / 编辑**), where **复制** clones a host with all of its connection settings; the **host detail panel is now editable in place** — hit **直接编辑**, change the address / name / group / user / port / auth, and **保存** without opening a dialog; and a new **分组管理** dropdown beside **新建分组** lets you **rename groups and reorder them**, with the order driving how the group sections are arranged in the list.
- 🪟 **Tear tabs off into their own windows** _(2026‑07‑15)_ — drag any content tab (a terminal, SFTP, editor or image tab — including one living inside a split pane) **out of the window** to pop it into a **new window** at the cursor; drop it **onto another window** to merge it there instead (both directions). The session **moves without dropping** — the SSH connection and any running command keep going untouched, and the terminal **keeps its full scrollback**, replayed into the new window. Close the original window and the torn‑off session is unaffected.
- 🖼️ **Send images to the agent** — the agent composer now takes images three ways: **paste** a screenshot straight into the input (`Ctrl+V`), pick files from the new **image button**, or **drag and drop** them onto the box. Thumbnails sit above the input (click to zoom, × to remove), up to 6 per message. Screenshots are **downscaled to 1568px** before sending, so a 4K grab doesn't balloon the request or eat your context window — and the context meter counts the images too. Works with any vision-capable OpenAI-compatible model.
- 🔓 **Trust this device** — the master-password screen gains a **信任此设备** checkbox. Tick it and the next launch unlocks the vault automatically, straight to the main window. The password is sealed with the **OS credential store** (DPAPI on Windows, Keychain on macOS) — never written in plaintext — and the trust record is dropped automatically if it stops working. Turn it back off any time from **Settings**; systems without a credential store disable the option rather than fall back to storing the password in the clear.
- 🗃️ **Create files & folders in SFTP** — the file listing gains a **New file** button next to **New folder**, and **right‑clicking blank space** (including an empty directory) offers **新建文件 / 新建文件夹**. Right‑clicking a file still shows its own menu (open / download / rename / delete), so the two never collide. Both panes (remote and local) check for a name clash first, so creating a file can never blank out an existing one.
- 💾 **Ctrl+S saves to the server** — with a remote file open in the editor, **Ctrl/Cmd+S** now saves it straight back over SFTP and snapshots a history version, exactly like the **保存到服务器** button. Saving is blocked while the file is still loading, so a placeholder can never overwrite your file.
- 🧾 **Breathing room under the prompt** — the terminal now reserves **two blank rows** at the bottom, so the prompt no longer sits flush against the window edge. It is reserved in _rows_, not pixels, so the gap stays correct at any font size and is reapplied on resize, split, and font changes.
- 📋 **Ctrl+Shift+V no longer pastes twice** — the terminal's paste shortcut now calls `preventDefault()`, stopping the browser's native "paste as plain text" from firing on top of our own paste handler. (Ctrl+Shift+C got the same treatment.)
- 🪟 **Draggable, recursive split view** — split panes now keep splitting. Each pane's tab strip (and the top bar) gains **向右分屏 / 向下分屏** buttons that split a pane **right or down** — including the panes you already split, so you can build any grid. **Drag a tab** by mouse from one pane into another: drop on an **edge** to carve out a new split, or on the **center** to merge it into that pane. Splitting a single‑tab terminal pane duplicates the session into the new pane, and the dividers have a wider grab zone for easier resizing. (Dragging is pointer‑based rather than HTML5 drag‑and‑drop, so it works reliably inside the app window.)
- 📜 **Persistent command history** — commands you type are now saved **locally per server** (surviving restarts) and shared across every tab of that host, each tagged **User** or **Agent** — agent‑run commands are captured too, not just what you type. The history panel gains a **Local / Server** split, where the Server tab reads the box's own `~/.bash_history` / `~/.zsh_history`. Click any command to drop it into the input line **without running it**, delete single entries, or clear a server's history.
- ⌨️ **Triple‑Ctrl command palette** — tap **Ctrl three times** in a terminal to pop a tabbed palette: **历史记录 (History)** searches your merged local + server history, **快捷操作 (Quick actions)** fires common actions. **Tab / Shift+Tab** switch tabs, **↑/↓ + Enter** pick, and the chosen command is inserted into the prompt (never auto‑run).
- 🛡️ **Agent terminal anti-jam** — the agent no longer hangs on blocking commands (`tail -f`, `top`, interactive `[Y/n]` prompts). It actively **probes whether the shell is at a prompt**, and when a command jams the terminal it runs a recovery ladder (Ctrl‑C → Ctrl‑C → pager `q` → editor `:q!` → Ctrl‑Z suspend + `kill %1`), reporting a clear **interrupted / stuck** state instead of silently timing out. Completion is judged by an idle+ceiling heartbeat, so long jobs (`apt`, `docker build`) run to the end while truly stuck ones are recovered — and the agent is guided to bound streaming commands (`tail -n`, `top -bn1`, `timeout N …`).
- 📊 **Rich system monitor** — the monitor panel now covers system info (IP / OS / timezone / uptime), **per‑core CPU** with a live sparkline, a **memory donut** (used / cache / free), **network** up/down rates & cumulative traffic, **disk** usage per mount with read/write I/O, and a **process manager** (hotspot list plus a full searchable table with kill / force‑kill). All charts and colors adapt to the active theme.
- ⚡ **Faster SFTP transfers** — local↔remote uploads/downloads now use concurrent `fastPut` / `fastGet`, saturating high-latency links instead of sending one 32 KB chunk per round-trip. Large files move dramatically faster.
- 📈 **Transfer speed & ETA** — the transfer UI shows live throughput (MB/s) and estimated time remaining, not just a percentage.
- 🗂️ **Per-window transfer records** — transfers are grouped by the window that started them into a collapsible dock; finished transfers stay as browsable history until you clear them.
- ⚠️ **Close-tab protection** — closing a tab with an in-progress transfer now asks for confirmation, since closing tears down the SFTP connection.
- 📊 **Progress in the side-panel SFTP view** — the embedded SFTP panel shows transfer progress too, and the toolbar upload button supports multi-select with a progress bar.
- ⚙️ **Configurable transfer concurrency** — a new **Settings** page lets you tune the SFTP concurrency (default 64, range 1–256); the value is persisted.
- 🎨 **Terminal color fix** — the built-in themes now ship full 16-color ANSI palettes, fixing colored (especially white) text that was invisible on the light theme.

### Screenshots

![NebuShell AI agent plan and confirm workflow](docs/screenshot-Agent-Plan-3.png)

A ready-made landing page lives at [`docs/index.html`](docs/index.html) — open it in a browser or publish it via GitHub Pages.

| Vault setup                                                               | Add a host                                                               | Host management                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| <img src="docs/screenshot.png" alt="NebuShell vault setup" width="360" /> | <img src="docs/screenshot-ssh1.png" alt="Create SSH host" width="360" /> | <img src="docs/screenshot-ssh2.png" alt="Host list and details" width="360" /> |

| SSH terminal                                                                    | Agent workspace                                                                          | Agent mode control                                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| <img src="docs/screenshot-ssh3.png" alt="Connected SSH terminal" width="360" /> | <img src="docs/screenshot-Agent-2.png" alt="Terminal with AI agent panel" width="360" /> | <img src="docs/screenshot-Agent-Plan.png" alt="AI agent approval mode selector" width="360" /> |

| Plan and confirm                                                                                | System checks                                                                           | Execution plan                                                                                     |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| <img src="docs/screenshot-Agent-Plan-1.png" alt="AI agent asks for confirmation" width="360" /> | <img src="docs/screenshot-Agent-Plan-2.png" alt="AI agent system checks" width="360" /> | <img src="docs/screenshot-Agent-Plan-3.png" alt="AI agent generated execution plan" width="360" /> |

| Model provider                                                                      | SFTP browser                                                                               | Multi-pane SFTP                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| <img src="docs/screenshot-model-1.png" alt="Model provider settings" width="360" /> | <img src="docs/screenshot-sftp.png" alt="SFTP file browser beside terminal" width="360" /> | <img src="docs/screenshot-split-sftp.png" alt="Local and remote SFTP panes" width="360" /> |

| Remote editor                                                                                     |
| ------------------------------------------------------------------------------------------------- |
| <img src="docs/screenshot-split-sftp1.png" alt="Remote file editor and SFTP panes" width="720" /> |

### Tech Stack

| Layer      | Tech                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ |
| Shell      | [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)      |
| UI         | [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + Tailwind CSS |
| Terminal   | [@xterm/xterm](https://xtermjs.org/)                                                       |
| Editor     | [Monaco Editor](https://microsoft.github.io/monaco-editor/)                                |
| SSH / SFTP | [ssh2](https://github.com/mscdex/ssh2)                                                     |
| State      | [Zustand](https://github.com/pmndrs/zustand)                                               |

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

- **Creator / Owner:** jiayizhen
- **Companies:** MrToken & Nebulaedata
- **Built with:** Claude & Codex
- **AI compute:** provided by MrToken & Nebulaedata

### License

Released under the [MIT License](LICENSE). © 2026 jiayizhen / MrToken & Nebulaedata.

---

<a id="中文"></a>

## 中文

### 简介

**NebuShell** 是一款跨平台桌面 SSH 客户端,内置了一流的 AI 运维智能体。你可以连接服务器、打开多个终端、通过 SFTP 浏览与编辑远程文件,并让内置智能体替你执行命令、读取输出、完成运维操作——所有操作都遵循「先出计划、确认后执行」的流程,没有你的同意,不会在你的机器上跑任何命令。

所有数据都保存在本地,并由主密码保险库加密,无需注册云账号。

### 功能特性

- 🖥️ **多标签终端与灵活分屏** —— 基于 xterm.js,支持自适应、网页链接识别和主题化。可在标签条上点击**向右/向下分屏**,并对分出来的屏**递归继续分屏**组成任意网格;支持**拖动标签页**在各屏之间移动(拖到边缘新建分屏,拖到中间合并到该屏),还能**把标签页拖出窗口**撕成独立窗口(会话原样跟着搬走),分隔条可拖动调整大小。
- 🤖 **内置 AI 运维智能体** —— 兼容 OpenAI 接口,支持 `run_command`(执行命令)、`transfer_file`(传输文件)、`read_command_output`(读取输出)、`ask_user`(向你提问)、`present_plan`(给出计划)。先出方案、征得确认,再在一个或多个终端上执行——**也能操作你的本机**(Windows 用 PowerShell,macOS/Linux 用 `/bin/sh`),审批流程完全一致。还能在**本机、主机与容器之间搬运文件**——确认卡片会先告诉你要传多少个文件、多大。还可以**给它发图片**——截图直接粘贴、选择文件,或拖进输入框。
- 🔐 **加密保险库** —— 主机、密码和 SSH 密钥都由主密码保护,密钥库永不离开本机。可勾选「**信任此设备**」,下次打开免输主密码。
- 📁 **SFTP 文件浏览器** —— 远程/本地双栏文件管理,支持拖拽传输和实时传输队列。可从工具栏或**右键空白处**新建**文件 / 文件夹**。
- 🐳 **Docker 容器管理** —— 每台主机的容器面板(实时 `docker ps`、启停重启、日志、sudo 自动探测);一键打开 `docker exec` **容器终端**;基于 `docker cp` tar 流的**容器文件浏览器**——浏览、编辑保存、在本机与任意运行中容器之间拖拽传文件。
- 📝 **内置编辑器** —— 集成 Monaco(VS Code 同款)编辑器,快速编辑远程与本地文件,支持语法高亮。打开服务器文件后按 **Ctrl+S** 即可直接保存回服务器(并自动存一个历史版本)。
- 🖼️ **图片预览** —— 直接在标签页中打开远程图片。
- 🗂️ **主机管理** —— 把连接整理进分组,支持**按名称或地址搜索**、**右键主机**连接 / 复制 / 编辑、带保存按钮的**就地编辑主机详情**,以及在分组管理里**重命名与排序分组**(顺序会同步到列表);并可复制会话、一键重连、在标签栏之间快速切换。
- ⌨️ **命令历史与命令面板** —— 你输入的每条命令都会**按服务器本地持久化**(标记 **User / Agent**),并在该主机的所有标签页间共享;历史面板分「**本地 / 服务器**」两个子标签,服务器标签直接读取机器自身的 `~/.bash_history`。在终端里**连按三次 Ctrl** 可呼出分标签命令面板,搜索历史或执行快捷操作——选中的命令只**填入输入行、不自动执行**。
- 📜 **历史文档** —— 记录过往会话与文档。
- 📊 **系统监控** —— 每核心 CPU 占用与实时折线、内存环形图、网络上下行速率、按挂载点的磁盘用量及读写 IO,以及可搜索、可结束进程的进程管理器。
- 🎨 **明暗主题** —— 简洁现代的界面,随系统自动切换。

### 更新记录

**近期更新(2026 年 7 月)**

- ⚡ **自定义快捷命令** _(2026‑07‑23)_ —— 终端右侧「**快捷操作**」面板现在可以**保存你自己的一批命令**:填标题、描述和一段命令,点一下就把整批写入**当前终端**执行——编辑时还有「**测试**」按钮当场试跑。在表单里**选一台服务器**,这条命令就变成**绑定服务器**——点击会**新开标签页、连接该主机、连上后自动执行**这批命令。左侧菜单新增「**快捷操作**」入口,把所有绑定服务器的命令做成一键启动卡片,这些命令同样出现在**三击 Ctrl 命令面板**里。命令均本地持久化保存。
- 🌲 **文件浏览器树状目录** _(2026‑07‑23)_ —— 每个文件面板(**SFTP**、**容器文件**、**本地**)左侧新增**懒加载目录树**。点文件夹即把右侧列表定位过去;树会自动展开并高亮当前路径,**右键节点**可就地新建 / 重命名 / 删除文件夹。工具栏有开关控制显隐——终端右侧的窄面板默认收起,整页文件浏览器默认展开。本地树以当前盘符为根。
- 📦 **智能体可以传文件了** _(2026‑07‑21)_ —— 智能体新增 **`transfer_file`** 工具,可在**本机、SSH 主机、容器**之间搬运文件和目录,**不用再拼 `scp` / `rsync`**。底层直接复用应用自身的传输管线(SFTP;容器走 `docker cp` 的 tar 流),因此**没有密码提示要应答,也不会被终端超时打断**——这正是过去让模型自己拼 `scp` 必然失败的原因。支持的路线:**本机 ↔ SSH 主机**、**SSH 主机 ↔ SSH 主机**(在应用内 A→B 流式中转)、**本机 ↔ 容器**;不支持的组合(容器 ↔ SSH、容器 ↔ 容器)不会报错卡死,而是返回清晰引导,让它**分两步经本机中转**。确认卡片在你点之前会先做一次**预扫描**,明确告诉你要传**多少个文件、多大**,传输过程有**实时进度条**,记录也会进和拖拽传输同一个传输面板。权限沿用现有模式:「**替我审批**」下**下载自动执行、上传仍需确认**,**计划模式两个方向都拦截**。目录递归传输;`dest_path` 填的是目标**目录**,源文件名会保留。
- 🛡️ **智能体工具分发加固** _(2026‑07‑21)_ —— 修掉两处会**静默出错**的隐患。其一,**未知工具名原本会掉进 shell 分支**,被解析成空命令真的送到终端上执行,现在显式拒绝并告知模型。其二,**传输端点改为严格解析**——目标名对不上时直接报错并列出可用目标,而不是悄悄回退到第一个目标;后者意味着文件会被**静默写到错误的机器上**。
- 🐳 **Docker 容器管理** _(2026‑07‑17)_ —— 每个已连接终端新增「**容器**」侧边面板,实时轮询 `docker ps -a`:状态徽标、镜像与端口一目了然,**启动 / 停止 / 重启**一键完成,点「**日志**」直接在编辑器标签里打开 `docker logs --tail 500`。**Docker 权限自动探测**——先试 `docker`,再试免密 `sudo -n docker`,都不行给出清晰提示和重新检测按钮。从列表一键打开**容器终端**:独立的 exec‑PTY 会话(bash 优先、sh 回退),窗口缩放、退出重连、复制分屏、撕出窗口全部可用。**容器文件浏览器**复用 SFTP 同款双栏体验——底层走 `docker cp` 的 tar 流(二进制安全,**不依赖容器内任何工具**)加 GNU/busybox 自适应 `ls` 解析:编辑并**保存回容器**(带版本历史)、新建重命名删除、**本地与容器之间直接拖拽传输**并显示实时进度。容器终端右侧的文件面板浏览的就是**容器内部**的文件系统,而不是宿主机。主机页右键也新增「**查看容器**」直达入口。
- ⚡ **打开 SFTP 不再卡死** _(2026‑07‑17)_ —— 原来的 Windows 盘符探测在**主进程上同步**检查 A:–Z:,一块失联的网络映射盘就能把整个应用挂住 20 秒以上(实测最差 22.3 秒 → 现在 1 秒封顶)。现在改为**全盘并行异步探测、每盘 1 秒超时、结果短缓存**,应用永不冻结。目录列表也从逐个串行 stat 改为**并行执行**——5100 项的文件夹从 435ms 降到 31ms。
- 💻 **智能体可以操作本机了** _(2026‑07‑16)_ —— 智能体面板新增始终可用的「**本机**」目标,与 SSH 终端并列——可以让它浏览本地目录、查看进程、执行任意本机命令,还能在一个任务里混搭本机与远程步骤。Windows 上命令由 **PowerShell** 执行,全链路 UTF‑8 处理(中文文件名、`ipconfig`/`systeminfo` 等原生工具输出不乱码、无 CLIXML 杂音);macOS / Linux 上由 `/bin/sh` 执行。系统提示词按操作系统教模型用对命令集(如 Windows 用 `Select-String` 而不是 `grep`),并且新增 **PowerShell 风险识别**,现有权限模式在本机同样生效——只读命令自动执行、写操作仍需确认、计划模式照旧拦截。每次执行都是全新进程,与 SSH 命令一样有 12 秒静默 / 180 秒硬超时,超时会清理整棵进程树,长输出也走同一套 `#ref` 分页检索管线。
- 🗂️ **主机管理增强** _(2026‑07‑15)_ —— 主机页新增**搜索框**,可按**名称或地址**实时过滤主机;**右键任意主机卡片**弹出快捷菜单(**连接 / 复制 / 编辑**),其中「复制」会连同全部连接配置克隆一台主机;**主机详情面板支持就地编辑**——点「**直接编辑**」即可改地址 / 名称 / 分组 / 用户 / 端口 / 认证方式,再点「**保存**」,无需打开弹窗;**新建分组**旁新增「**分组管理**」下拉菜单,可**重命名分组并调整顺序**,顺序会决定主机列表中各分组的排列。
- 🪟 **把标签页撕成独立窗口** _(2026‑07‑15)_ —— 把任意内容标签(终端 / SFTP / 编辑器 / 图片,包括分屏面板里的某个标签)**拖出窗口**,即可在光标处弹出一个**新窗口**装它;若拖到**另一个已有窗口**上,则合并进那个窗口(双向都行)。会话**原样搬移、不断开**——SSH 连接和正在运行的命令都毫发无伤,终端**保留完整历史滚屏**(在新窗口里回放重建)。关掉原窗口也不会影响已经撕出去的会话。
- 🖼️ **给智能体发图片** —— 智能体输入框现在支持三种加图方式:截图**直接粘贴**(`Ctrl+V`)、点新增的「**图片**」按钮选择文件、或把图片**拖进输入框**。缩略图排在输入框上方(点击放大,× 移除),单条消息最多 6 张。图片发送前会**按最长边缩到 1568px**,4K 截图不会把请求体撑爆、也不会吃光上下文——上下文用量表也会把图片算进去。任何支持视觉的 OpenAI 兼容模型都能用。
- 🔓 **信任此设备** —— 主密码界面新增「**信任此设备**」勾选框。勾上之后,下次打开应用会自动解锁保险库,直接进主界面。主密码用**操作系统凭据存储**加密保存(Windows DPAPI / macOS 钥匙串),**绝不明文落盘**;万一记录失效(比如保险库被重建),会自动清掉并退回手输密码,不会卡死。随时可在「**设置**」里关掉。系统若不支持安全存储,该选项会被禁用,而不是退化成明文保存密码。
- 🗃️ **SFTP 新建文件与文件夹** —— 文件列表在「新建文件夹」旁边新增了「**新建文件**」按钮,**右键空白处**(包括空目录)也会弹出「**新建文件 / 新建文件夹**」菜单。右键文件行仍然是原来的菜单(打开 / 下载 / 重命名 / 删除),两者互不冲突。远程和本地两个面板都会**先查重名**,所以新建文件绝不会把同名文件清空。
- 💾 **Ctrl+S 保存到服务器** —— 在编辑器里打开服务器文件后,按 **Ctrl/Cmd+S** 就会通过 SFTP 直接保存回服务器,并存一个历史版本,效果与点「保存到服务器」按钮完全一致。文件还在加载时会阻止保存,避免把占位文本覆盖到你的文件上。
- 🧾 **提示符不再贴底** —— 终端底部现在会保留**两行空白**,命令提示符不再紧贴窗口边缘。留白是按「**行**」而不是像素预留的,所以任何字号下间距都正确,并且在窗口缩放、分屏、改字号时都会重新生效。
- 📋 **修复 Ctrl+Shift+V 重复粘贴** —— 终端的粘贴快捷键现在会调用 `preventDefault()`,阻止浏览器原生的「粘贴为纯文本」在我们自己的粘贴之外再粘一次。Ctrl+Shift+C 也做了同样处理。
- 🪟 **可拖动的递归分屏** —— 分屏后还能继续分屏。每个面板的标签条(以及顶栏)新增了「**向右分屏 / 向下分屏**」按钮,可对**已经分出来的面板**继续分屏,组成任意网格。用鼠标把**标签页**从一个面板**拖**到另一个:拖到**边缘**新建分屏,拖到**中间**合并进该面板。对单标签的终端面板分屏时会**复制会话**到新面板,分隔条也有更宽的拖拽热区便于调整大小。(拖拽改用指针实现而非 HTML5 拖放,在应用窗口内更稳定可靠。)
- 📜 **命令历史持久化** —— 你输入的命令现在会**按服务器本地保存**(重启后仍在),并在该主机的所有标签页间共享,每条标注来源 **User** 或 **Agent**(智能体执行的命令也会被记录,而不只是手输的)。历史面板新增「**本地 / 服务器**」子标签——服务器标签直接读取机器自身的 `~/.bash_history` / `~/.zsh_history`。点击任意命令即可**填入输入行而不执行**,并支持删除单条或清空某台服务器的历史。
- ⌨️ **三击 Ctrl 命令面板** —— 在终端里**连按三次 Ctrl** 弹出分标签面板:「**历史记录**」搜索本地 + 服务器合并的历史,「**快捷操作**」执行常用动作。**Tab / Shift+Tab** 切换标签,**↑/↓ + 回车** 选择,选中的命令会**填入输入行(不自动执行)**。
- 🛡️ **智能体终端防卡死** —— 智能体不再被 `tail -f`、`top`、交互式 `[Y/n]` 等阻塞命令卡住。它会**主动探测 shell 是否停在提示符**;当某条命令把终端卡死时,走恢复阶梯(Ctrl‑C → 再 Ctrl‑C → 分页器 `q` → 编辑器 `:q!` → Ctrl‑Z 挂起并 `kill %1`)夺回提示符,并明确回报「已中断 / 终端卡死」状态,而不是默默超时。完成判定改用「空闲 + 硬上限」心跳,`apt`、`docker build` 等长任务能跑到底,真正卡死的才被恢复;同时引导模型对持续输出型命令做有界化(`tail -n`、`top -bn1`、`timeout N …`)。
- 📊 **系统监控大升级** —— 监控面板现覆盖:系统信息(IP / 系统 / 时区 / 运行时间)、**每核心 CPU** 占用与实时折线、**内存环形图**(已用 / 缓存 / 空闲)、**网络**上下行速率与累计流量、按挂载点的**磁盘**用量及读写 IO,以及**进程管理**(热点列表 + 可搜索全表,支持结束 / 强制结束进程)。所有图表与配色随当前主题自适应。
- ⚡ **SFTP 传输提速** —— 本地↔远端的上传/下载改用并发 `fastPut` / `fastGet`,填满高延迟链路,不再"一次一个 32KB 分块等往返"。大文件传输速度大幅提升。
- 📈 **传输速度与剩余时间** —— 传输界面新增实时速度(MB/s)与预计剩余时间,不再只有百分比。
- 🗂️ **按窗口保存的传输记录** —— 传输按所属窗口归集到可折叠的记录面板;完成后作为历史保留,可随时查看,直到手动清除。
- ⚠️ **关闭页面保护** —— 关闭仍有传输进行中的标签页时会弹出确认(关闭会中断 SFTP 连接)。
- 📊 **侧边栏 SFTP 也显示进度** —— 终端右侧内嵌 SFTP 面板同样显示传输进度,工具栏上传支持多选并带进度条。
- ⚙️ **传输并发数可调** —— 新增「设置」页,可调节 SFTP 并发数(默认 64,范围 1–256),并持久化保存。
- 🎨 **终端配色修复** —— 内置主题补全了 16 色 ANSI 调色板,修复浅色主题下彩色(尤其是白色)文字看不见的问题。

### 界面预览

![NebuShell AI 智能体计划与确认流程](docs/screenshot-Agent-Plan-3.png)

项目自带一个介绍页 [`docs/index.html`](docs/index.html) —— 用浏览器打开,或通过 GitHub Pages 发布即可。

| 主机与终端                                                        | AI 智能体                                                                          | SFTP 与编辑器                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| <img src="docs/screenshot-ssh2.png" alt="主机管理" width="360" /> | <img src="docs/screenshot-Agent-Plan-1.png" alt="AI 智能体确认操作" width="360" /> | <img src="docs/screenshot-split-sftp1.png" alt="SFTP 与远程编辑器" width="360" /> |

### 技术栈

| 层级     | 技术                                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| 外壳     | [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)      |
| 界面     | [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + Tailwind CSS |
| 终端     | [@xterm/xterm](https://xtermjs.org/)                                                       |
| 编辑器   | [Monaco Editor](https://microsoft.github.io/monaco-editor/)                                |
| SSH/SFTP | [ssh2](https://github.com/mscdex/ssh2)                                                     |
| 状态管理 | [Zustand](https://github.com/pmndrs/zustand)                                               |

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

- **开发者 / 所有者:** jiayizhen
- **公司:** MrToken、Nebulaedata
- **构建开发:** 由 Claude 与 Codex 构建开发
- **AI 算力:** 由 MrToken、Nebulaedata 提供

### 开源协议

基于 [MIT 协议](LICENSE) 发布。© 2026 jiayizhen / MrToken、Nebulaedata。

---

<div align="center">
<sub>开发者 / 所有者 jiayizhen · 公司 MrToken、Nebulaedata · 由 Claude 与 Codex 构建开发 · AI 算力由 MrToken、Nebulaedata 提供</sub>
<br />
<sub>Made with ❤️ · Powered by <strong>MrToken</strong> &amp; <strong>Nebulaedata</strong></sub>
</div>
