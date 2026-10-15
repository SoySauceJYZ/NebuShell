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
- 📁 **SFTP file browser** — dual‑pane remote/local file management with drag‑and‑drop transfers, a live transfer queue and a lazy‑loaded directory tree. **Multi‑select** with Ctrl/Shift/Ctrl+A and act on the whole selection at once — download, delete (`rm -rf`, so a non‑empty directory is no problem), or type every path into the terminal. **Create files and folders** from the toolbar or by right‑clicking blank space, **open a file in the Monaco editor** and save it straight back, and when the panel is docked beside a terminal the two move together in **both directions** — **send that terminal into the directory you are browsing**, or **pull the panel to wherever the terminal currently is** (which is also where it starts from when you first open it).
- 🐳 **Docker container management** — a per‑host panel with sections for **containers, images, volumes, networks and cleanup**. Containers are **grouped by compose project** (start/restart/stop a whole project), show health, **CPU & memory**, and **clickable published ports**; each one offers start/stop/restart/pause/kill/delete, **logs** (following in their own tab, or a snapshot in the editor with line count, timestamps and auto‑refresh), a **container terminal** you can enter as any user, workdir or shell, its **mount points** (one click opens the data on the host in SFTP), and a **file browser** built on `docker cp` tar streaming that works **even when the container is stopped**. Volumes can be **backed up and restored**, images/volumes/networks deleted, and `docker system df` plus one‑click prunes reclaim disk. Docker access (plain or passwordless `sudo`) is auto‑detected, and failures come back as plain‑language messages.
- 📝 **Built‑in editor** — a Monaco (VS Code) editor for quickly editing remote and local files, with syntax highlighting. **Ctrl+S** saves a remote file straight back to the server (and snapshots a history version).
- 🖼️ **Image preview** — open remote images directly in a tab.
- 🖥️ **Remote desktop control** — a Sunlogin‑style remote desktop right in the left sidebar. On the machine you want to control, run NebuShell and click **启动被控端 (Start agent)** — it shows that machine's LAN address and a random access code; on the controller, enter the **IP + code** for a live screen with **full mouse & keyboard control**. Video streams **peer‑to‑peer over WebRTC** on your LAN (no relay server, no cloud), input is injected natively on the remote, and it ships with **multi‑monitor switching**, **two‑way text clipboard sync**, **file push** straight into the remote machine's Downloads (with a progress bar), and a **remote command line** (a real PowerShell / cmd terminal running on the controlled machine). First step: LAN direct‑connect, **Windows** controlled‑side.
- 📡 **Monitoring center (GRID-WATCH)** — a new **监控中心** tab: an agentless, wasteland-styled big-screen dashboard for **the servers you already saved** — CPU / memory / disk / network / NVIDIA GPUs, Docker containers and vLLM / SGLang / Ollama metrics — with a **fullscreen mode** and an **application topology** that you **discover manually, host by host**: it tells **bare-process / systemd / Docker** deployments apart, reads **nginx** `proxy_pass` rules, follows live TCP connections and container env vars, and draws how gateways, apps, model servers and databases connect. Data stays local (no database server needed), and collection only runs while the tab is open.
- 🌐 **Proxy manager** — keep a list of **HTTP / HTTPS / SOCKS5** proxies (with optional username & password, stored in the encrypted vault), add them one at a time or **bulk‑paste** a whole list, and **check** each one's **exit IP, region, ISP and latency** — either **from this computer** or **from any of your hosts** (the same proxy can be fast here and dead there). When the AI agent hits a download or connection failure on a server (GitHub, Docker Hub, PyPI, npm…), it can **ask you to pick a proxy or pick one automatically** — and the proxy's credentials are **never sent to the model**.
- 🔌 **Built‑in MCP server** — turn it on in Settings and **Claude Code, Cursor or any MCP‑capable agent** can use the servers you've saved in NebuShell: run commands, list / read / write files and look at Docker containers and logs. Bearer‑token auth, one‑click copy of the `claude mcp add` command or JSON config, and an **audit log** of every call.
- 🌍 **Web edition for headless Linux servers** — no desktop on the box? Run NebuShell's backend there as a plain Node service (**Docker image** or **tar.gz + systemd**) and use the full app **from any browser**: hosts, terminals, SFTP, Docker, the AI agent, proxies and the MCP server all work as on desktop. The vault master password is the login, "local" means **the server itself** (switch it off with `--no-local`), and files move between **your own computer** and the server or your hosts through browser **upload / download**. See [docs/web/README.md](docs/web/README.md).
- 🗂️ **Host management** — organize connections into groups, **search by name or address**, **right‑click a host** to connect / duplicate / edit, edit host details **inline** with a save button, and **rename & reorder groups** from a group manager (the order flows through to the list). Duplicate sessions, reconnect, and jump between them from the tab bar.
- ⌨️ **Command history & command palette** — every command you type is saved locally per server (tagged **User** / **Agent**) and shared across that host's tabs; a history panel splits **Local** vs the server's own `~/.bash_history`. Triple‑tap **Ctrl** to open a tabbed palette that searches history and runs quick actions — picking a command drops it into the prompt **without executing**.
- 📜 **History docs** — keep track of past sessions and documents.
- 📊 **System monitor** — per‑core CPU with a live sparkline, a memory donut, network up/down rates, per‑mount disk usage with read/write I/O, and a process manager you can search and kill from.
- 🔄 **Update check** — Settings checks **GitHub Releases** for a newer version and hands you the installer for your platform; it can also check quietly at startup and flag the result on the sidebar.
- 🎨 **Light / dark themes** — a clean, modern UI that adapts to your OS.

### What's New

**Recent updates (July–October 2026)**

- 🌍 **Web edition: NebuShell on a headless Linux server, in your browser** _(2026‑10‑10)_ — the Linux build used to be desktop‑only (AppImage / snap / deb), so a server without a desktop couldn't run it. Now the same backend runs there as a plain **Node.js service** and the same UI is served to **any browser** — hosts, terminals, SFTP, the Docker panel, the AI agent (streaming included), proxies and the MCP server all behave as on desktop. Deploy it as a **Docker image** (`docker/web/Dockerfile`, runs as an unprivileged user, data in the `/data` volume, built‑in healthcheck) or as a **tar.gz with a systemd unit** (`npm run build:web && npm run package:web`; the server is a single self‑contained file with no `node_modules` and no native modules, so one tarball serves x64 and arm64 — it only needs Node.js 22). It listens on `127.0.0.1:8080` by default and speaks plain HTTP: put **Nginx or Caddy with HTTPS** in front (examples in [docs/web/README.md](docs/web/README.md)). **Signing in** uses the vault master password: the session is an `HttpOnly` + `SameSite=Strict` cookie held only in memory, wrong passwords are throttled per IP with exponential back‑off, the WebSocket handshake checks both the cookie and the `Origin`, and **locking** the vault in any browser sends **every** browser back to the unlock screen. **"Local" means the server itself** — the local file pane browses the server's filesystem and the agent's local commands run there as the service user (turn both off with `--no-local`). Files on **your own computer** travel through the browser: **upload** and files **dropped onto a pane** are staged on the server and then go through the usual transfer queue with its progress; **"download to…"** hands the result to the browser's downloads, folders arriving as `.tar.gz`. If the network blips, the page **reconnects by itself** and each terminal **redraws from the server's scrollback**, so output produced while you were offline isn't lost; sessions of a page that is really gone are closed after 60 seconds. Not available on the web: **remote desktop** and tearing tabs off into windows; native dialogs become in‑page ones. The desktop app is unchanged — both editions share the same code, the web build just swaps the `electron` module for a WebSocket bridge.
- 🔒 **LLM API keys stay in the main process** _(2026‑10‑10)_ — the vault data handed to the UI no longer includes the AI providers' **API keys** (the UI only ever needed "is a key set"), so on desktop they stay in the main process and on the web edition they **never reach the browser**.

- 🌐 **Proxy manager, and an agent that reaches for a proxy when the network fails it** _(2026‑10‑07)_ — a new **代理 (Proxies)** tab in the left sidebar. Add **HTTP / HTTPS / SOCKS5** proxies one at a time (paste a link like `socks5://user:pass@1.2.3.4:1080` and the fields fill themselves in), or **bulk‑import** a whole list — `scheme://user:pass@ip:port`, `ip:port`, `ip:port:user:pass`, `user:pass@ip:port`, with `#name` at the end of a line; unrecognised lines are pointed out by line number and duplicates are skipped. Proxies live in the **encrypted vault** alongside your hosts. **Checking** shows each proxy's **exit IP, country / region / city, ISP and latency** (green / amber / red), and the **检测位置 (Check from)** picker decides **where** the check runs: **this computer**, or **any saved host** — because a proxy that is fast from your desk can be unreachable from a server in another data centre, so results are kept separately per location. Local checks open the HTTP `CONNECT` / SOCKS5 tunnel directly (no extra dependencies); checks from a host run `curl` over SSH, with the proxy address and password passed through **stdin into a temporary file**, so they never show up in the server's process list (a host without `curl` is reported as such). Sort by latency, search by name / IP / region, and **clean out** the ones that failed. The real point is the **agent**: when a command on a server fails to reach GitHub, Docker Hub, PyPI, npm and the like (timeouts, connection resets, TLS failures, crawling downloads), it calls the new **`use_proxy`** tool, which picks the proxy that **works from that machine and can actually reach that site**, lowest latency first (re‑checking when the results are older than 10 minutes). A three‑way switch decides what happens next: **关闭 (Off)**, **询问 (Ask)** — a card shows the site, the reason and the candidates, and you choose one or decline — or **自动 (Auto)**. The agent then writes **`{{proxy}}`** in its command (`curl -x {{proxy}} …`, `git -c http.proxy={{proxy}} clone …`, `https_proxy={{proxy}} …`), which is swapped for the real address **only at the moment it runs**, and the password is masked as `***` in the output the model sees — so **proxy credentials never reach the model provider**. The proxy applies to that one command only; the agent is told not to write it into global config without your say‑so, and calling `use_proxy` again tries a different one.
- 🔌 **Built‑in MCP server: let other agents use your saved servers** _(2026‑10‑07)_ — **设置 (Settings)** gains an **MCP 服务** card. Switch it on and NebuShell serves the **Model Context Protocol** over Streamable HTTP at `http://<address>:46300/mcp` (another port is picked automatically if that one is taken), so **Claude Code, Cursor and any other MCP‑capable agent** can work with the servers already in your vault — no copying passwords or keys anywhere. Tools: `list_hosts` (never includes passwords or keys), `exec_command` (non‑interactive, optional `cwd`, timeout up to 30 min), `list_directory`, `read_file`, `write_file`, `docker_ps` and `docker_logs` (plain `docker` or `sudo -n docker`, tried automatically). Hosts can be referred to by id or name. Connections are pooled per host, separate from your terminal tabs, and closed after 10 idle minutes — nothing is ever typed into a shell you can see. Access requires a randomly generated **Bearer token** (compared in constant time; regenerate it any time), the card lists every LAN address to connect to and copies a ready‑made **`claude mcp add` command** or **JSON config** in one click, and **every call is written to an audit log** you can open from the card. The vault has to be unlocked for it to work. Note that it listens on all interfaces and commands run through it are **not** confirmed in NebuShell — keep the token private.
- 🎯 **@ a target straight from the agent's input box** _(2026‑09‑22)_ — with several terminals attached, saying *which* machine you mean was prose the model had to infer. Type **`@`** in the agent's input box and the session's current targets drop in — SSH terminals, container terminals and **本机 (this computer)** — filtered as you type by **name or host**, with **↑↓** to move, **Enter / Tab** to insert, **Esc** to dismiss, and clicking works too. What gets inserted is the target's name **verbatim**, which is exactly the value the model passes as `target` to `run_command` / `transfer_file`, and a new system-prompt rule tells it to honour it — so `@` is an instruction rather than a hint, and naming two targets in one message gets the work split between them. Only an `@` at the start of a line or after a space counts as a reference, so `root@server` and an email address in your text are left alone; once the words after it have drifted into ordinary prose nothing matches any more and the menu closes itself. Terminal titles **containing spaces** still match (the filter doesn't give up at the first space), names are deduplicated exactly as the **目标 (Targets)** menu does it (`title #2`), and while the menu is open **Enter picks rather than sends**.
- 🧭 **Jump the file panel to the terminal's directory** _(2026‑09‑15)_ — the **SFTP** panel docked beside a terminal already had a button that sends **its** directory to the terminal; the opposite direction now sits right next to it. One click and the panel navigates to **wherever that terminal's command line currently is**, using the same `/proc` lookup the panel does when it first opens — so nothing is typed into your shell and the scrollback is left untouched (verified by diffing it around a probe). It follows a `cd` inside a nested shell too, and when it genuinely can't tell (no `/proc`, or the terminal is sitting inside a foreground program) it says so rather than doing nothing.
- 🗂️ **Select several files at once, and a delete that actually deletes** _(2026‑09‑15)_ — the file panels gain **multi-select**: click to select, **Ctrl/Cmd-click** to add one, **Shift-click** for a range, **Ctrl/Cmd+A** for everything, **Esc** to clear and **Delete** to delete, with a **已选 N 项 (N selected)** bar at the bottom. Right-clicking inside the selection acts on **all of it** — download N items, type N paths into the terminal, delete N items — while entries that only make sense for one thing (rename, open in the editor) hide themselves when more than one is selected. And deleting a directory over SFTP **no longer fails when it isn't empty**: it used to call `rmdir`, which refuses a non-empty directory (the confirmation even said "the directory must be empty"), so the only way out was the terminal. Deletion now runs **`rm -rf` on the SFTP session's own SSH connection** — one command for the whole tree, and one round trip for a whole multi-selection (measured: a 420-node tree in **11ms**). Accounts restricted to SFTP only (`ForceCommand internal-sftp`) have no shell, and the subtle part is that their exec request **succeeds and then never returns** — so the connection is probed once with a 3s-capped `echo` before anything is run, and when there is no shell the delete falls back to **recursing over the SFTP protocol** (same result, just slower: the same tree took 774ms). Paths with spaces or quotes are escaped, `/` is refused outright, and a permission failure is reported rather than silently swallowed. SFTP, container files and local files all behave the same way.
- 💾 **Back up and restore a volume** _(2026‑09‑11)_ — the volume list's menu gains **备份… (Back up)** and **还原到此卷… (Restore here)**, plus a **从备份还原… (Restore from a backup)** entry for the section itself. Backups land in a directory on the host (`~/docker-volume-backups` by default) and can then be pulled to your machine, or opened in the SFTP browser. Two packing routes are chosen automatically: **tar the volume directory directly** when you are root or have passwordless sudo (fastest, needs no image), otherwise a **throwaway container** — preferring the image of the container that uses the volume, since that one is certainly present locally and almost certainly has `tar`. Either way the archive is streamed through your own shell, so the file belongs to **you** rather than to root. `--numeric-owner` is always attempted (falling back a rung at a time when busybox's tar rejects a flag): without it a mysql volume's uid 999 comes back as root and the database won't start — the classic "backup fine, restore broken". Before running, the dialog shows the volume's size, the free space at the target, which containers use it, and offers to **stop them for the backup and start them again afterwards** (a hot copy of a database volume is only crash-consistent) — and the restart happens even if the backup fails, so a failure can never leave your service down. Restoring defaults to a **new volume** (`<name>-restore-<time>`), leaving the original untouched; overwriting an existing one is the deliberate second option, with "clear first" and a warning when containers are still using it. Each archive gets a sidecar `.json` (volume, host, time, size, tar flags, containers), so the restore picker shows what a file actually is instead of a wall of filenames, and the archive is `gzip -t`'d before anything is unpacked.
- 🐳 **Images, volumes, networks and cleanup** _(2026‑09‑11)_ — the container panel grows a row of sections: **容器 / 镜像 / 卷 / 网络 / 清理**. Images list repository, tag, size and age (dangling ones are marked) and can be deleted; volumes show their driver and host mount point, open that directory in the SFTP browser in one click, or get deleted; networks show driver and scope, with docker's built-in `bridge/host/none` protected from deletion. **清理 (Cleanup)** puts `docker system df` in front of you — what each category takes and how much of it is reclaimable — next to one-click prunes for **stopped containers, dangling images, all unused images, unused volumes, unused networks and the build cache**, each behind a confirmation that spells out what it removes, and each reporting the space it actually reclaimed. These sections do **not** poll: they load when opened and on refresh, because they rarely change on their own.
- 🧩 **Containers grouped by compose project** _(2026‑09‑11)_ — containers started by docker compose are now **grouped under their project** (read from the `com.docker.compose.*` labels), each group collapsible, showing `running/total` at a glance and offering **启动 / 重启 / 停止 全部 (start / restart / stop all)** in one action — docker takes every container id in a single command. Cards inside a group show the **service** name instead of the mangled `project-service-1`. The per-container actions are complete now, too: alongside start/stop/restart there are **pause, unpause, kill, delete** (force-delete when it is still running), **mount points**, **inspect** in a read-only editor tab, and copying the container id — with confirmation on the destructive ones. Health from `HEALTHCHECK` shows as its own badge.
- 📂 **Browse files in a stopped container** _(2026‑09‑11)_ — the file browser used to be greyed out unless the container was running, because listing went through `docker exec ... ls`. But `docker cp` works on stopped containers, so listing now **falls back to reading the tar stream's headers** whenever exec is unavailable — a stopped container, or a distroless image with no `ls` at all. That is exactly the situation you are in when a container won't start and you want to look at its config. Name, size, mtime and permissions all come from the tar headers; files can be opened and downloaded as usual, while creating/renaming/deleting is honestly reported as unavailable. Since `docker cp` streams the whole subtree, the read stops at **20k entries / 64MB / 15s** and the panel says so, suggesting you type a more specific path.
- 📊 **CPU and memory per container, clickable ports, jump to a volume** _(2026‑09‑11)_ — running containers show **CPU and memory** from `docker stats` (collected at half the list's cadence, skipped when nothing is running or when there are more than 40 running containers, and switchable from the panel header). Published ports became **buttons**: click `8080→80` and the host's address opens in your browser. And the mount points a container has — bind mounts and volumes alike — are one menu away, each with **在宿主机文件浏览器打开 (open on the host)**, so the data behind a volume is one click from the SFTP browser rather than an `inspect` and a manual path hunt.
- 📜 **Container logs: follow in their own tab, pick the lines** _(2026‑09‑11)_ — the follow button used to type `docker logs -f` into **the terminal you were working in** and leave you to Ctrl-C it. It now opens its **own tab**, so your terminal stays yours, and closing the tab ends the follow. The editor view of the logs gains a toolbar: **line count (200 / 1000 / 5000 / all)**, a **timestamps** toggle (`-t`), and **auto-refresh**, which re-pulls every 3s and keeps the view pinned to the end.
- 🔑 **Enter a container as root, or anywhere you like** _(2026‑09‑11)_ — the container terminal was hard-wired to `docker exec -it <id> bash||sh`, which is no help when the image runs as an unprivileged user or when you want to land straight in `/app`. The card's menu now offers **以 root 进入 (enter as root)** and **自定义进入… (custom)**, where you can set **user, working directory and shell** — passed through as `-u` / `-w` and an explicit shell. Everything else about the terminal (resize, reconnect, tear-off) is unchanged.
- ⚡ **One poll per host, and errors that say what went wrong** _(2026‑09‑11)_ — two foundations under all of the above. First, `ssh:exec` only ever returned **stdout**, so the panel had to append `2>&1` to every command and guess success from the text (a start/stop was judged by "did the output contain the container id"). A new **`ssh:execFull`** brings back **stderr and the exit code**, so failures are detected properly and the message is the real reason. Second, docker's common failures now map to **actionable Chinese messages** (daemon not running, no permission, port already allocated, no space left, image still in use…), shared by the panel and the container file backend. And the 4s `docker ps` poll is now **one per host rather than one per panel** — panels for the same host share a single poll, it **pauses entirely when no panel is visible** (a background tab used to keep polling forever) and resumes with an immediate refresh, and an unchanged list no longer re-renders the cards.
- 🖥️ **Open the current directory in the terminal** _(2026‑09‑11)_ — the **SFTP** panel docked beside a terminal gains a terminal button in its toolbar (right of **刷新 / Refresh**): one click makes that terminal `cd` into **the directory you are browsing**, Enter included. The right-click menu of any file or folder gains **在终端中打开 (Open in terminal)** as well — a folder is entered directly, a file takes you to the directory holding it. Paths with spaces or shell metacharacters are **quoted automatically**. Next to the existing **输入路径到终端 (Type path into terminal)**, the difference is that this one **runs**, rather than leaving the line for you to complete. Like that item, it only shows up in a panel **docked beside a terminal**.
- 📂 **A terminal's SFTP panel opens where the command line is** _(2026‑09‑11)_ — the SFTP panel beside a terminal always started at `/`, so wherever you had `cd`'d in the shell, you had to click your way back down the tree. The **first** time a session opens that panel, it now starts in the **directory the terminal's command line is in**. Nothing is typed into your shell — no echo, no trace in the scrollback: a second **exec channel on the same SSH connection** looks the shell up through `/proc`. The exec process and the interactive shell are siblings under the same sshd session process, so the sibling **holding a pty** is that terminal's shell, and its `/proc/<pid>/cwd` is the directory; the lookup then walks a few levels further down the same pty, so a directory you `cd`'d to inside `su` or a nested shell is found too. The probe runs **in parallel with the SFTP connection** (no extra wait) and falls back to the old default whenever it can't tell — no `/proc` (non-Linux), no permission, or a 4s timeout. Reopening the panel later still returns to **the last directory you browsed**.
- 🖱️ **Right-click a file to type its path into the terminal** _(2026‑08‑20)_ — the sidebar **SFTP** panel (and the container file panel) gains an **输入路径到终端 (Type path into terminal)** item in the right-click menu of any file or folder. It writes the item's **full path into the terminal beside it, at the current input line, without pressing Enter**, so you can put `tail -f` or `cd` in front and run it yourself. Paths containing spaces or shell metacharacters are **quoted automatically**, and a trailing space is appended the way dropping a file onto a terminal does, so a second path can follow straight after. The item appears only in a panel **docked beside a terminal** — the full-page explorer has no terminal to type into, so it isn't offered there.
- 🔄 **Check GitHub for a new release** _(2026‑08‑20)_ — **Settings** gains a **软件更新 (Software update)** card. It shows the running version, and **检查更新 (Check for updates)** asks the GitHub Releases API for the latest published release: if it is newer you get the version, publish date and release notes, plus one-click download of the **installer matching your platform and architecture** (falling back to the release page when that release has no matching asset). It also checks **quietly a few seconds after startup** — a red dot appears on the sidebar's **设置** entry and clears once you open it — and that startup check can be switched off from the same card. Download links are restricted to GitHub hosts, and a failed startup check stays silent rather than nagging.
- 🗂️ **Drag hosts to reorder them** _(2026‑08‑20)_ — the hosts page now lets you **drag a card to move it**. Hovering over another card shows an insertion line on its left or right half, and dropping commits the whole new order to the vault, so it survives a restart. Dragging is limited to **within a group** (group membership is still changed from the host editor), and it's disabled while the search box has text, where the visible list is only a subset and a drop position would mean nothing.
- 🔎 **Search containers by name** _(2026‑08‑20)_ — the container panel gains a **search box** under its title, filtering the list by container name as you type (case-insensitive substring). It only appears once a host actually has containers, and it's a pure client-side filter — the 4-second `docker ps` polling keeps running underneath and the filter stays applied across refreshes.
- 📄 **Container logs in a read-only editor** _(2026‑08‑20)_ — container cards keep the existing log button (which types `logs -f` into the current terminal to follow live) and add a second one that opens the logs in an **editor tab instead**: `docker logs --tail 1000`, with a **刷新 (Refresh)** button to re-run it, the content **read-only** (Ctrl+S is disabled too, and the save button is hidden), and the view auto-scrolled to the end on load. Handy for reading and copying a log without giving up your terminal.
- 📁 **File panels remember their directory per session** _(2026‑08‑20)_ — closing the sidebar **SFTP** panel disconnects its session, so reopening it used to dump you back at `/`. Each session now remembers the last directory it successfully listed and returns there (falling back to `/` if the directory is gone or no longer readable). **展开为整页 SFTP (Expand)** carries the current directory over too, so the full-page explorer opens where you were rather than at the root.
- 🧩 **Add an already-open file panel to the explorer** _(2026‑08‑20)_ — the explorer's **添加面板 (Add panel)** menu now lists the file panels you already have open — sidebar SFTP panels and container-file panels alike — each showing its host (or `container @ host`) and its current directory. Picking one adds a panel **pointed at the same target and the same directory**. Panels belonging to the page you're on are filtered out. Note it opens a second connection rather than moving the live one: an SFTP / `docker exec` session is owned by the panel holding it and can't be shared.
- 🪟 **The Hosts tab can be closed in a split view** _(2026‑08‑20)_ — Hosts is the home tab and normally has no close button, but once the view is **split** it occupies a whole pane with no way to reclaim it. Each pane's tab strip now offers a close button for it as well; it's still refused when it is the **last** tab (which would leave an empty window), and the sidebar **主机** entry or **+ → 打开新主机** brings it right back.
- 🧱 **Left · terminal · right three-column layout** _(2026‑08‑11)_ — the terminal's side-panel rail gains a **dock-swap button** at the top. Open a panel (**智能体 / SFTP / 监控** …), click the button to **move it to the left side**, then open another from the rail — it lands on the right, giving you a **left · terminal · right** three-column view. With panels on both sides the button **swaps** them instead of dropping one. Each dock **remembers its own width** (drag whichever inner edge faces the terminal; both clamp to 280–900px), and a panel docked on the left still shows as active in the rail — click it again to close it, from whichever side it's on. The same panel can never be docked on both sides at once, since SFTP and container-files share one derived session and two copies would fight over the connection.
- 🚀 **The agent panel no longer bogs down in long conversations** _(2026‑08‑11)_ — with a long chat open, **typing a single character** re-rendered the entire message list, and every streamed token did the same. Two causes compounding: `react-markdown` does **no memoization at all**, so each render re-parsed **every historical message** from scratch (measured: **1.9ms at 1 message, 84ms at 100**), and the composer's draft state lived in the **same component** as the list — one keystroke, one full re-parse (Chinese IME multiplies that by every composition event). Both are fixed: the input box moved into its **own component**, and message rows, tool cards and rendered Markdown are **memoized**, so finished messages are never re-parsed again. Fixed alongside: the context-token estimate no longer rescans the **whole** conversation on every token; tool results are looked up through a **`Map`** instead of a linear scan per card (previously quadratic); off-screen messages skip layout and paint via **`content-visibility`**; and the scroll-follow no longer forces a synchronous layout on every token — it also **stops pinning to the bottom once you scroll up**, so you can read back while the model is still writing.
- 🗂️ **New tabs open next to the current one** _(2026‑08‑11)_ — opening a tab (expanding **SFTP** into the full explorer, opening a file in the editor, launching a terminal from the hosts page) used to append it at the **far end** of the tab strip, so closing it dropped you somewhere unrelated. New tabs now land **immediately to the right of the tab you opened them from** — close it and you are back where you started. Opening several in a row keeps their natural order, and dragging a tab onto another pane still appends as before.
- 🖱️ **Code-block copy buttons no longer all light up at once** _(2026‑08‑11)_ — hovering anywhere in an agent reply revealed the **复制 (Copy)** button on **every** code block in that message, because the block's hover group used Tailwind's unnamed `group` — and `group-hover:` matches through **any** ancestor carrying that class, including the message row itself. Code blocks now use a **named group**, so only the block actually under the cursor shows its button.
- 🖥️ **Remote desktop control** _(2026‑08‑03)_ — a new **远程桌面 (Remote Desktop)** tab in the left sidebar brings Sunlogin‑style screen sharing right into NebuShell. On the machine you want to control, open the tab and click **启动被控端** — it starts a controlled‑host service and shows the machine's **LAN addresses** and a random **6‑digit access code**. On the controller, type that **IP + code** and you get a **live screen with full mouse & keyboard control**. The video streams **peer‑to‑peer over WebRTC** on your LAN (no relay server, no cloud), and input is **injected natively** on the remote. It also does **multi‑monitor switching** (pick the remote display from the session's right‑side menu), **two‑way text clipboard sync**, and **file push** — send a file from the controller straight into the remote machine's **Downloads** with a live progress bar. It also includes a **remote command line** — open a real **PowerShell / cmd** terminal (ConPTY via node‑pty) that runs on the controlled machine, straight from the session's side menu. The controlled side reuses NebuShell itself (no separate installer). First step: **LAN direct‑connect**, **Windows** controlled‑side.
- 🔌 **The agent can reconnect a dropped terminal** _(2026‑08‑03)_ — when an SSH terminal drops (a command comes back with a connection error, or a result is flagged **终端卡死,建议重连**), the agent can now call a new **`reconnect_terminal`** tool to **re-establish that terminal's connection itself** and carry on — no more asking you to click reconnect first. It reuses the tab's own connect flow (you'll see **正在连接...** in the terminal), reports success or failure back to the model, and runs in **every mode including plan mode** (reconnecting is a prerequisite for investigating, not a write operation). The tool only lists **SSH** targets — the local machine isn't a connection.
- 🧩 **Right-side panels are now per-tab** _(2026‑08‑03)_ — with multiple tabs open, switching the right-side panel (**智能体 / 快捷操作 / 历史命令 / 监控 / 容器 / 主题 / SFTP**) in one terminal used to switch it in **every** tab, because the selection was a single shared value. Each terminal now **remembers its own open panel**: open SFTP in one tab and the others are untouched, and the hosts page **查看容器** shortcut pre-opens the container panel only for the **new** tab. (Panel width stays shared as a global size preference.)
- 🚑 **High-frequency output no longer freezes the UI** _(2026‑08‑03)_ — running a command that redraws hundreds of times a second (e.g. `rsync --info=progress2`) could **freeze the interface**, because every tiny output chunk took its own trip through IPC plus a scrollback-buffer concatenation. Output is now **batched per frame (~16ms)**: a burst of chunks collapses into a single broadcast and terminal write, cutting hundreds of messages/sec down to ~60 and keeping the UI smooth. The agent's own command-output capture was likewise changed from repeated full-string concat + sentinel scan to **array accumulation with a bounded tail scan**, removing an O(n²) stall on long high-output commands.
- ⌨️ **New terminals grab focus** _(2026‑07‑24)_ — opening a new terminal (or switching to an existing one) now **focuses it automatically**, so you can start typing right away without clicking first. Focus only follows the **active tab**, so a background terminal finishing its connection never steals focus from what you're doing.
- 📜 **Scrollable dropdowns** _(2026‑07‑24)_ — long select menus (such as the server picker) no longer **overflow the window** — they now cap at the available height and **scroll** instead of being cut off.
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

### Web Edition (headless Linux server)

For a Linux server without a desktop: run the backend as a Node service and open it in a browser. Full deployment notes, flags and reverse‑proxy examples: [docs/web/README.md](docs/web/README.md).

```bash
# Docker
docker build -f docker/web/Dockerfile -t nebushell-web .
docker run -d --name nebushell -p 127.0.0.1:8080:8080 -v nebushell-data:/data nebushell-web

# tar.gz + systemd  →  dist-web/NebuShell-web-<version>-linux.tar.gz (needs Node.js 22 on the server)
npm run build:web && npm run package:web
```

The service listens on `127.0.0.1:8080` over plain HTTP — publish it through an HTTPS reverse proxy (Nginx / Caddy).

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
│   ├── mcp/        # Built-in MCP server (tools, SSH pool, audit log)
│   ├── proxy/      # Proxy checker (local tunnels / remote curl)
│   └── ipc/        # IPC handlers
├── preload/        # Preload bridge
├── renderer/       # React UI (terminals, SFTP, editor, agent panel)
└── web/            # Web edition: Node server + browser bridge (electron shims, WebSocket IPC)
docker/web/         # Web edition Docker image
packaging/web/      # Web edition launcher + systemd unit
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
- 📁 **SFTP 文件浏览器** —— 远程/本地双栏文件管理,支持拖拽传输、实时传输队列与懒加载目录树。支持 **多选**(Ctrl / Shift / Ctrl+A),并对整个选区一次性操作 —— 批量下载、批量删除(`rm -rf`,**非空目录照样删**)、把所有路径一次输入到终端。可从工具栏或**右键空白处**新建**文件 / 文件夹**,双击用 **Monaco 编辑器**打开并直接存回服务器;面板贴着终端时,两边可以**双向对齐** —— 既能**让那个终端 cd 到你正在浏览的目录**,也能**一键把面板跳到终端此刻所在的目录**(首次打开时它本来也是从终端当前目录起步的)。
- 🐳 **Docker 容器管理** —— 每台主机一个面板,分为**容器 / 镜像 / 卷 / 网络 / 清理**五个分区。容器按 **compose 项目分组**(可整组启停重启),显示健康状态、**CPU 与内存**、以及**可点击的端口映射**;每个容器都能启动/停止/重启/暂停/强制终止/删除,查看**日志**(独立标签页实时跟随,或在编辑器里看快照,可选行数、时间戳、自动刷新),打开**容器终端**(可指定用户 / 工作目录 / shell),查看**挂载点**(一键在宿主机 SFTP 里打开那份数据),以及基于 `docker cp` tar 流的**容器文件浏览器** —— **容器已停止也能浏览**。卷可以**备份与还原**,镜像/卷/网络可删除,`docker system df` 加一键 prune 回收磁盘。Docker 权限(直连或免密 `sudo`)自动探测,出错一律给中文可操作提示。
- 📝 **内置编辑器** —— 集成 Monaco(VS Code 同款)编辑器,快速编辑远程与本地文件,支持语法高亮。打开服务器文件后按 **Ctrl+S** 即可直接保存回服务器(并自动存一个历史版本)。
- 🖼️ **图片预览** —— 直接在标签页中打开远程图片。
- 🖥️ **远程桌面控制** —— 左侧边栏内置类似向日葵的远程桌面。在想被控的机器上运行 NebuShell,点「**启动被控端**」即显示该机的局域网地址和一个随机访问码;在控制端输入 **IP + 访问码**,即可看到实时画面并**完全操控其鼠标键盘**。画面在局域网内**经 WebRTC 点对点直传**(无中转服务器、不走云),输入在被控端**原生注入**,并自带**多显示器切换**、**文本剪贴板双向同步**、把文件直接**推送到被控机「下载」目录**(带进度条),以及**远程命令行**(在被控机上打开真实的 PowerShell / cmd 终端)。第一步:局域网直连、被控端仅 **Windows**。
- 📡 **监控中心(GRID-WATCH)** —— 左侧新增「**监控中心**」标签:基于**已配置的服务器**做无 Agent 采集的废土风监控大屏 —— CPU / 内存 / 磁盘 / 网络 / NVIDIA GPU、Docker 容器、vLLM / SGLang / Ollama 推理指标,支持**全屏大屏**;并提供**应用拓扑发现**:**手动**点「发现 / 更新」后**逐台**登录主机,区分**直接部署 / systemd / Docker 部署**,解析 **nginx** 反向代理规则、实时 TCP 连接和容器环境变量,画出网关、应用、模型服务、数据库之间的关系。数据全部存本地(无需数据库服务),只在标签页打开时采集。
- 🌐 **代理管理** —— 维护一批 **HTTP / HTTPS / SOCKS5** 代理(可带账号密码,存放在加密保险库),支持逐个添加或**整段粘贴批量导入**,一键**检测**每个代理的**出口 IP、地区、运营商与延迟** —— 既可**从本机检测**,也可**从任意一台主机检测**(同一个代理在这台机器上快、换台机器可能根本连不上)。AI 智能体在服务器上下载或连接外网失败时(GitHub、Docker Hub、PyPI、npm……),可以**先询问你选哪个代理,或自动挑一个**,而且**代理账号密码不会发送给模型**。
- 🔌 **内置 MCP 服务** —— 在设置里打开后,**Claude Code、Cursor 等支持 MCP 的智能体**就能使用你在 NebuShell 里保存的服务器:执行命令、列目录 / 读写文件、查看 Docker 容器与日志。Bearer 令牌鉴权,一键复制 `claude mcp add` 命令或 JSON 配置,每次调用都记入**审计日志**。
- 🌍 **Web 版(无桌面 Linux 服务器)** —— 服务器没有桌面?把 NebuShell 的后端作为普通 Node 服务跑在上面(**Docker 镜像**或 **tar.gz + systemd**),**用任意浏览器**访问完整功能:主机、终端、SFTP、Docker、AI 智能体、代理和 MCP 服务都与桌面版一致。保险库主密码即登录密码,「本地」指**服务器本机**(可用 `--no-local` 关闭),**你自己电脑上的文件**通过浏览器**上传 / 下载**与服务器或各主机互传。详见 [docs/web/README.md](docs/web/README.md)。
- 🗂️ **主机管理** —— 把连接整理进分组,支持**按名称或地址搜索**、**右键主机**连接 / 复制 / 编辑、带保存按钮的**就地编辑主机详情**,以及在分组管理里**重命名与排序分组**(顺序会同步到列表);并可复制会话、一键重连、在标签栏之间快速切换。
- ⌨️ **命令历史与命令面板** —— 你输入的每条命令都会**按服务器本地持久化**(标记 **User / Agent**),并在该主机的所有标签页间共享;历史面板分「**本地 / 服务器**」两个子标签,服务器标签直接读取机器自身的 `~/.bash_history`。在终端里**连按三次 Ctrl** 可呼出分标签命令面板,搜索历史或执行快捷操作——选中的命令只**填入输入行、不自动执行**。
- 📜 **历史文档** —— 记录过往会话与文档。
- 📊 **系统监控** —— 每核心 CPU 占用与实时折线、内存环形图、网络上下行速率、按挂载点的磁盘用量及读写 IO,以及可搜索、可结束进程的进程管理器。
- 🔄 **更新检查** —— 设置页可查询 **GitHub Releases** 上的最新版本,并直接给出匹配你系统的安装包;也可在启动时静默检查,并在侧边栏提示结果。
- 🎨 **明暗主题** —— 简洁现代的界面,随系统自动切换。

### 更新记录

**近期更新(2026 年 7–10 月)**

- 🌍 **Web 版:在无桌面的 Linux 服务器上运行,用浏览器访问** _(2026‑10‑10)_ —— 以前 Linux 只有桌面客户端(AppImage / snap / deb),没有桌面的服务器跑不起来。现在同一套后端可以作为普通 **Node.js 服务**跑在服务器上,同一套界面交给**任意浏览器** —— 主机、终端、SFTP、Docker 面板、AI 智能体(含流式输出)、代理和 MCP 服务都与桌面版表现一致。部署方式二选一:**Docker 镜像**(`docker/web/Dockerfile`,以非 root 用户运行,数据在 `/data` 卷里,自带健康检查),或 **tar.gz + systemd 单元**(`npm run build:web && npm run package:web`;服务端是一个自包含文件,不需要 `node_modules`、没有原生模块,x64 与 arm64 共用一个包,只要求 Node.js 22)。默认只监听 `127.0.0.1:8080`、只说 HTTP,请在前面放 **带 HTTPS 的 Nginx 或 Caddy**(示例见 [docs/web/README.md](docs/web/README.md))。**登录**用保险库主密码:会话是只存在内存里的 `HttpOnly` + `SameSite=Strict` Cookie,输错密码按 IP 指数退避,WebSocket 握手同时校验 Cookie 与 `Origin`;在任一浏览器里**锁定**保险库,**所有**浏览器都会回到解锁页。**「本地」即服务器本机** —— 本地文件面板浏览的是服务器的文件系统,智能体的本机命令也以服务用户身份在服务器上执行(用 `--no-local` 可一并关闭)。**你自己电脑上的文件**经浏览器中转:「**上传**」和**拖进面板**的文件先暂存到服务器,再走原有的传输队列与进度;「**下载到…**」直接交给浏览器下载,文件夹自动打包为 `.tar.gz`。网络闪断时页面会**自动重连**,终端会**按服务器端的回滚缓冲重画**,掉线期间的输出不会丢;页面真正关闭后,它打开的会话 60 秒后释放。Web 版暂不提供:**远程桌面**、把标签页拖出成独立窗口;系统原生对话框改为页面内弹窗。桌面版不受影响 —— 两个版本共用同一份代码,Web 构建只是把 `electron` 模块换成了 WebSocket 桥接。
- 🔒 **LLM API Key 只留在主进程** _(2026‑10‑10)_ —— 交给界面的保险库数据不再包含 AI 供应商的 **API Key**(界面只需要知道「是否已配置」),桌面版里它只留在主进程,Web 版里**根本不会到达浏览器**。

- 🌐 **代理管理,以及「网络不通时会自己找代理」的智能体** _(2026‑10‑07)_ —— 左侧新增「**代理**」标签。可以逐个添加 **HTTP / HTTPS / SOCKS5** 代理(粘贴一条 `socks5://user:pass@1.2.3.4:1080` 这样的链接,各字段自动填好),也可以**批量导入**整段列表 —— 支持 `协议://用户:密码@IP:端口`、`IP:端口`、`IP:端口:用户:密码`、`用户:密码@IP:端口`,行尾 `#名称` 作为名称;识别不了的行会标出行号,重复的自动跳过。代理与主机一起存放在**加密保险库**里。**检测**会给出每个代理的**出口 IP、国家 / 省份 / 城市、运营商和延迟**(绿 / 黄 / 红三档),而「**检测位置**」决定**在哪儿测**:**本机**,或**任意一台已保存的主机** —— 同一个代理,在你桌上很快,换到另一个机房的服务器上可能根本连不上,所以每个位置的结果分开保存。本机检测直接自建 HTTP `CONNECT` / SOCKS5 隧道(不引入任何新依赖);从主机检测则经 SSH 在远端跑 `curl`,代理地址和密码**经 stdin 写进临时文件**,不会出现在服务器的进程列表里(远端没装 `curl` 会明确提示)。支持按延迟排序、按名称 / IP / 地区搜索,以及一键**清理不可用**的代理。真正的用处在**智能体**:当服务器上的命令访问 GitHub、Docker Hub、PyPI、npm 等站点失败时(超时、连接被重置、TLS 握手失败、下载慢得离谱),它会调用新工具 **`use_proxy`**,挑出**在那台机器上可用、并且确实能访问该站点**的代理,延迟低的优先(检测结果超过 10 分钟会自动重测)。接下来怎么做由一个三档开关决定:**关闭**、**询问** —— 对话里弹出卡片,列出站点、原因和候选代理,由你选一个或拒绝 —— 或**自动**。拿到代理后,智能体在命令里写占位符 **`{{proxy}}`**(`curl -x {{proxy}} …`、`git -c http.proxy={{proxy}} clone …`、`https_proxy={{proxy}} …`),**直到真正执行的那一刻**才替换成真实地址,返回给模型的输出里密码也会被遮成 `***` —— **代理账号密码不会发送给模型供应商**。代理只对当次命令生效;智能体被要求未经你同意不得写入全局配置,再次调用 `use_proxy` 会换一个代理。
- 🔌 **内置 MCP 服务:让其他智能体也能用你保存的服务器** _(2026‑10‑07)_ —— 「**设置**」里新增「**MCP 服务**」卡片。打开后,NebuShell 以 Streamable HTTP 提供 **Model Context Protocol** 服务,地址为 `http://<地址>:46300/mcp`(端口被占用时自动换一个),**Claude Code、Cursor 等任何支持 MCP 的智能体**都能直接使用保险库里已有的服务器 —— 不用再到处复制密码或密钥。提供的工具:`list_hosts`(不含任何密码 / 密钥)、`exec_command`(非交互,可指定 `cwd`,超时最长 30 分钟)、`list_directory`、`read_file`、`write_file`、`docker_ps` 与 `docker_logs`(自动尝试 `docker` 与 `sudo -n docker`)。主机可以用 id 或名称指定。连接按主机复用,与终端标签完全独立,空闲 10 分钟自动断开 —— 不会往你看得见的任何 shell 里写东西。访问需要随机生成的 **Bearer 令牌**(常数时间比对,可随时重新生成),卡片列出所有可连接的局域网地址,并能一键复制现成的 **`claude mcp add` 命令**或 **JSON 配置**;**每一次调用都写入审计日志**,可从卡片直接打开。使用时需先解锁保险库。注意:服务监听所有网卡,经它执行的命令**不会**在 NebuShell 里弹窗确认,请妥善保管令牌。
- 🎯 **智能体输入框可以 @ 引用目标了** _(2026‑09‑22)_ —— 挂着好几个终端时,「到底动哪一台」以前只能写在正文里,靠模型自己领会。现在在智能体输入框里敲 **`@`**,当前会话可用的目标就列出来 —— SSH 终端、容器终端,以及**本机** —— 边打边按**名字或主机**过滤,**↑↓** 选择、**Enter / Tab** 插入、**Esc** 收起,鼠标点选同样可以。插进去的是目标名字的**原文**,而那串名字正是模型调用 `run_command` / `transfer_file` 时 `target` 参数的取值;系统提示词里也补了一条对应规则,所以 `@` 是一条明确指令而不是暗示,一条消息里点两台就会分别下发。只有**行首或空格之后**的 `@` 才算引用,`root@server`、正文里的邮箱地址都不会被误判;过滤词一旦写成了正文,匹配不到任何目标,菜单自己收起来。带空格的终端标题照样能选中(过滤不会遇到空格就放弃),重名的去重规则与「**目标**」菜单完全一致(`标题 #2`),并且菜单开着时**回车用于选中,不会把消息发出去**。
- 🧭 **一键把文件面板跳到终端所在目录** _(2026‑09‑15)_ —— 贴着终端的 **SFTP** 面板原本已有「**在终端中打开当前目录**」(面板 → 终端);现在它旁边多了**反方向**的那颗按钮:点一下,面板直接跳到**那个终端命令行此刻所在的目录**。走的是面板首次打开时同一套 `/proc` 反查 —— 不往你的 shell 里写任何东西,**scrollback 一字不留**(已用探测前后逐字比对验证)。嵌套 shell 里 `cd` 过的目录同样跟得上;真判断不出来时(没有 `/proc`、或终端正卡在某个前台程序里)会明确提示,而不是默默无反应。
- 🗂️ **文件面板支持多选,删除终于真的能删掉** _(2026‑09‑15)_ —— 文件面板现在可以**多选**:单击选中、**Ctrl/Cmd 点击**加选、**Shift 点击**连选、**Ctrl/Cmd+A** 全选、**Esc** 清空、**Delete** 删除,底部显示「**已选 N 项**」。右键落在选区里时,菜单作用于**整个选区** —— 下载 N 项、把 N 条路径输入到终端、删除 N 项;而「重命名」「用编辑器打开」这类只对单个有意义的项,多选时会自动隐藏。另外,SFTP 删目录**不再因为非空而失败**:以前调的是 `rmdir`,非空目录直接拒绝(确认框上甚至还写着「目录必须为空才能删除」),只能回终端自己动手。现在删除是在 **SFTP 会话自己的那条 SSH 连接上跑 `rm -rf`** —— 整棵树一条命令,多选也只要一次往返(实测 420 个节点 **11ms**)。被限制成纯 SFTP 的账户(`ForceCommand internal-sftp`)没有 shell,而麻烦之处在于这种账户的 exec 请求会**「成功」然后永远不返回**,所以下发任何命令前先用一条带 3 秒上限的 `echo` 探一次;探不到 shell 就退回**按 SFTP 协议递归删除**(结果一样,只是慢:同一棵树 774ms)。含空格与引号的路径会转义,`/` 直接拒绝,权限不足会如实报错而不是假装成功。SFTP、容器文件、本机文件三个面板行为一致。
- 💾 **卷可以备份与还原了** _(2026‑09‑11)_ —— 卷列表的菜单里新增「**备份…**」和「**还原到此卷…**」,分区顶部还有一个「**从备份还原…**」。备份落在主机上的目录(默认 `~/docker-volume-backups`),之后可以一键拉到本机,或在 SFTP 里打开。打包方式**自动选**:是 root 或有免密 sudo 就**直接 tar 卷目录**(最快、不依赖镜像),否则起一个**一次性容器**——优先用「正在用这个卷的那个容器」的镜像,它一定在本地,也几乎一定自带 `tar`。两条路都把归档**经你自己的 shell 重定向**成文件,所以产物归**你**所有,不会留下一堆 root 的删不掉的文件。tar 一律先尝试 `--numeric-owner`(busybox 的 tar 不认就逐级降级):少了它,mysql 卷里 uid 999 的文件还原后全变 root,数据库直接起不来 —— 这正是「备份成功、还原失败」最常见的原因。开跑前对话框会显示卷有多大、目标盘还剩多少、哪些容器在用它,并可勾选「**先停止这些容器,备份完自动启动**」(热备数据库卷只能得到崩溃一致快照);**即使备份失败也一定会把容器拉回来**,不会出现「备份没成、服务还停着」。还原默认**建一个新卷**(`原名-restore-时间`),原卷分毫不动;覆盖现有卷是需要你显式选择的第二选项,带「先清空」开关,并在仍有容器占用时明确警告。每个归档旁边写一个 `.json` 边车(卷名、主机、时间、大小、tar 参数、相关容器),所以还原时看到的是「这是哪个卷、什么时候、多大」,而不是一堆文件名;解包前还会先 `gzip -t` 验一遍归档完整性。
- 🐳 **容器面板新增镜像 / 卷 / 网络 / 清理** _(2026‑09‑11)_ —— 面板顶部多了一排分区:**容器 / 镜像 / 卷 / 网络 / 清理**。镜像列出仓库、标签、大小与创建时间(悬空镜像单独标记)并可删除;卷显示驱动与宿主机挂载点,可一键在 SFTP 里打开那个目录,也可删除;网络显示驱动与作用域,docker 内置的 `bridge/host/none` 不允许删除。「**清理**」把 `docker system df` 摆在眼前——每类占了多少、其中多少可回收——旁边是一键 prune:**已停止的容器、悬空镜像、所有未使用镜像、未使用的卷、未使用的网络、构建缓存**,每一项都先弹确认并写清会删掉什么,完成后回显真正回收了多少空间。这几个分区**不参与轮询**:进入时拉一次,之后手动刷新或操作后再拉 —— 它们本来也不会自己变。
- 🧩 **容器按 compose 项目分组** _(2026‑09‑11)_ —— docker compose 起的容器现在**按项目归组**(读 `com.docker.compose.*` 标签),每组可折叠、直接显示 `运行中/总数`,并支持「**启动 / 重启 / 停止 全部**」—— 一条命令带上组里所有容器 id 交给 docker。组内卡片显示**服务名**,而不是 `项目-服务-1` 那串。单个容器的动作也补齐了:除启动/停止/重启外,新增**暂停、恢复、强制终止(kill)、删除**(运行中则强制删除)、**挂载点**、在只读编辑器里 **inspect**、复制容器 ID,破坏性操作一律先确认。镜像声明了 `HEALTHCHECK` 的,健康状态单独成一个徽标。
- 📂 **停止的容器也能浏览文件** _(2026‑09‑11)_ —— 过去容器不在运行,文件按钮就是灰的,因为列目录走的是 `docker exec ... ls`。但 `docker cp` 对停止的容器照样有效,于是 exec 用不了时(容器已停止,或 distroless 镜像里根本没有 `ls`)**自动改从 tar 流的头信息里还原目录**。而「容器起不来,想看看里面的配置」恰恰就是最需要它的时刻。名称、大小、修改时间、权限全部来自 tar 头;文件照常打开与下载,新建/改名/删除则明确告诉你此时不可用。由于 `docker cp` 会把整棵子树都推过来,读取在 **2 万条 / 64MB / 15 秒**任一触顶时收手,面板会说明列表不完整,并建议直接输入更具体的路径。
- 📊 **资源占用、可点端口、一键跳到卷目录** _(2026‑09‑11)_ —— 运行中的容器显示来自 `docker stats` 的 **CPU 与内存**(按列表一半的频率采集,没有运行中的容器、或运行中超过 40 个时自动跳过,也可在面板标题栏一键关掉)。发布出来的端口变成了**按钮**:点 `8080→80` 就用系统浏览器打开主机对应地址。容器的挂载点(绑定挂载与卷)也只隔一个菜单,每条都带「**在宿主机文件浏览器打开**」—— 卷背后的数据从此离 SFTP 只有一次点击,不用再 inspect 完自己找路径。
- 📜 **容器日志:独立标签页跟随、行数可选** _(2026‑09‑11)_ —— 跟随日志过去是把 `docker logs -f` 写进**你正在用的那个终端**,还得自己 Ctrl-C 收场。现在它**另开一个标签页**,你的终端仍然是你的,关掉标签页即停止跟随。编辑器里的日志视图则多了一排控件:**行数(200 / 1000 / 5000 / 全部)**、**时间戳**开关(`-t`)、以及**自动刷新**——每 3 秒重新拉取并保持贴在末尾。
- 🔑 **以 root 或自定义身份进入容器** _(2026‑09‑11)_ —— 容器终端过去写死成 `docker exec -it <id> bash||sh`:镜像以非特权用户运行、或者你想直接落在 `/app`,都没辙。现在卡片菜单里有「**以 root 进入**」和「**自定义进入…**」,可指定**用户、工作目录、shell**(分别对应 `-u` / `-w` 与显式 shell)。终端本身的其它一切(resize、重连、撕出窗口)照旧。
- ⚡ **每台主机只轮询一次,报错也终于说人话** _(2026‑09‑11)_ —— 上面这些的两块地基。其一:`ssh:exec` 只回 **stdout**,所以面板过去每条命令都得拼 `2>&1`,还要从文本里猜成败(启停是靠「输出里有没有容器 id」判断的)。新增的 **`ssh:execFull`** 把 **stderr 与退出码**带了回来,失败能被正确识别,提示也就是真正的原因。其二:docker 的常见报错现在统一映射成**可操作的中文**(守护进程没起、无权限、端口被占、磁盘满、镜像被容器占用……),面板与容器文件后端共用同一份措辞。此外,4 秒一次的 `docker ps` 轮询从「每个面板一份」改成「**每台主机一份**」:同主机的多个面板共用,**没有任何面板可见时整个暂停**(以前切到别的 tab 它还在后台一直跑),重新可见立刻补一轮;列表内容没变时也不再重渲染卡片。
- 🖥️ **在终端中打开当前目录** _(2026‑09‑11)_ —— 贴着终端的 **SFTP** 面板,工具栏(**刷新**右边)新增一个终端图标:点一下让旁边那个终端 `cd` 到**你正在浏览的目录**,并回车执行。文件/文件夹的右键菜单里也多了「**在终端中打开**」——选文件夹就进到该文件夹,选文件则进到它所在的目录。含空格或 shell 特殊字符的路径照样**自动加引号**。和已有的「**输入路径到终端**」相比,区别是这条**直接执行**,而不是把命令行留给你补全。同样只在**贴着终端的面板**里出现。
- 📂 **终端的 SFTP 面板从命令行所在目录打开** _(2026‑09‑11)_ —— 终端旁边的 SFTP 面板一律从 `/` 起步,你在命令行里 `cd` 到哪儿,都得在文件树里再点回去一遍。现在这条会话**第一次**打开该面板时,起始目录就是**终端命令行此刻所在的目录**。探测不往你的 shell 里写任何东西——没有回显,scrollback 里也不留痕迹:在**同一条 SSH 连接上另开一个 exec 通道**,从 `/proc` 反查。exec 进程与交互 shell 是同一个 sshd 会话进程的兄弟,于是那个**占着 pty 的兄弟**就是这个终端的 shell,它的 `/proc/<pid>/cwd` 即当前目录;随后还会沿同一 pty 往下走几层,所以在 `su` 或嵌套 shell 里 `cd` 过的目录同样能找到。探测与 **SFTP 连接并行**发起(不额外多等),判断不出来时一律退回原来的默认目录——没有 `/proc`(非 Linux)、权限不足、或 4 秒超时。之后再开该面板,仍然回到**你上次浏览的目录**。
- 🖱️ **右键把文件路径输入到终端** _(2026‑08‑20)_ —— 侧边栏的 **SFTP** 面板(以及容器文件面板)在文件/文件夹的右键菜单里新增「**输入路径到终端**」。点它就把该项的**完整路径写进旁边那个终端的当前输入行,并且不回车**——你可以在前面补 `tail -f`、`cd` 之类再自己执行。含空格或 shell 特殊字符的路径会**自动加引号**;末尾留一个空格,和往终端里拖文件的习惯一致,方便接着拼第二个路径。这条只在**贴着终端的面板**里出现:整页文件浏览器没有配套终端,菜单里也就不会有它。
- 🔄 **检查 GitHub 上的最新发布包** _(2026‑08‑20)_ —— **设置**页新增「**软件更新**」卡片:显示当前运行的版本,点「**检查更新**」向 GitHub Releases 查询最新发布版本。有更新时列出版本号、发布日期和更新说明,并可一键下载**与你的系统 / 架构匹配的安装包**(该发布没有匹配产物时退回发布页自行挑选)。启动后几秒还会**静默检查一次**——有新版本时左侧边栏「**设置**」上出现一个小红点,进设置页即消——这次自动检查可以在同一张卡片里关掉。下载链接只允许 GitHub 域名;启动时的检查失败保持静默,不会打扰你。
- 🗂️ **主机页支持拖动排序** _(2026‑08‑20)_ —— 主机卡片现在可以**直接拖着挪位置**。拖到另一张卡片上时,按鼠标落在它的左半还是右半,显示一条插入线提示落点;松手即把整份新顺序写回密码库,重启后依然保持。拖动限制在**同一分组内**(改分组归属仍在编辑主机里做);搜索框里有内容时禁用拖动——那时看到的只是子集,拖出来的位置没有意义。
- 🔎 **容器支持按名称搜索** _(2026‑08‑20)_ —— 容器面板标题下新增**搜索框**,按容器名实时过滤(大小写不敏感的子串匹配)。只在该主机确实有容器时才出现;它是纯前端过滤,底层 4 秒一次的 `docker ps` 轮询照常进行,刷新后过滤依然生效。
- 📄 **容器日志可在只读编辑器里看** _(2026‑08‑20)_ —— 容器卡片保留原有的日志按钮(在当前终端里执行 `logs -f` 实时跟随),并新增一个按钮改为**在编辑器标签页里打开**:执行 `docker logs --tail 1000`,带一个「**刷新**」按钮重新拉取,内容**只读**(Ctrl+S 一并禁用、保存按钮隐藏),加载完成自动滚到末尾。适合安静地翻阅和复制日志,而不用占着终端。
- 📁 **文件面板按会话记住目录** _(2026‑08‑20)_ —— 关掉侧边栏的 **SFTP** 面板会断开该会话,再打开原本只会回到 `/`。现在每条会话都记住它最后成功列出的目录,重开时直接回到那里(目录已删除或不可读时退回 `/`)。「**展开为整页 SFTP**」也会把当前目录带过去,整页视图接着你刚才的位置继续浏览,而不是从根目录开始。
- 🧩 **「添加面板」可加入已打开的文件面板** _(2026‑08‑20)_ —— 文件浏览器的「**添加面板**」菜单现在会列出你已经打开的文件面板——侧边栏的 SFTP 面板和容器文件面板都算——每条显示所在主机(容器则是「容器名 @ 主机」)和它当前所在目录。选中即在本页加一个**指向同一目标、同一目录**的面板;本页自己的面板会被排除。需要说明的是它是**另开一条连接**而非把原面板搬过来:一条 SFTP / `docker exec` 会话由持有它的面板独占,无法共用。
- 🪟 **分栏后 Hosts 标签可以关闭** _(2026‑08‑20)_ —— Hosts 是首页标签,平时不带关闭按钮;但一旦**分栏**,它就占着一整个 pane 而没法收回。现在分栏后每个 pane 的标签条也给它关闭按钮;它是**最后一个**标签时仍然拦下(否则会关成空窗口),而左侧边栏的「**主机**」或「**+ → 打开新主机**」随时能把它开回来。
- 🧱 **面板支持左中右三栏** _(2026‑08‑11)_ —— 终端侧边图标栏顶部新增「**换边**」按钮。先打开一个面板(**智能体 / SFTP / 监控**…),点它把该面板**挪到左侧**,再从图标栏开第二个——新的落在右侧,于是得到「**左 · 终端 · 右**」三栏。两侧都有面板时按钮变成**互换**,不会把任何一个弄丢。两个停靠位**各记各自宽度**(拖各自靠终端那一边,均限制在 280–900px);停在左侧的面板在图标栏里同样是高亮的,再点一次就关掉——不论它停在哪一侧。同一个面板**不会同时停在两侧**,因为 SFTP 与容器文件共用一条派生会话,开两份会争抢同一个连接。
- 🚀 **智能体面板长会话不再卡顿** _(2026‑08‑11)_ —— 对话一长,**光是敲一个字**就会把整个消息列表重渲染一遍,流式输出的每个 token 同样如此。两个原因叠加:`react-markdown` **完全没有记忆化**,每渲染一次就把**全部历史消息**从头解析一遍(实测:1 条 1.9ms、100 条 84ms);而输入框的草稿状态又和消息列表**同住一个组件**——按一次键,全量重解析一次(中文输入法下一个汉字还要乘以若干次 composition 事件)。两条路径都已修复:输入区拆成**独立组件**,消息行、工具卡片与 Markdown 全部**memo 化**,已完成的消息从此一次都不会被重新解析。同时修掉的还有:上下文用量估算不再随每个 token 扫一遍**整个**会话;工具结果改用 **`Map`** 查表,不再每张卡片线性扫全表(原本是平方级);视口外的消息经 **`content-visibility`** 跳过布局与绘制;滚动跟随不再每个 token 强制同步一次布局——并且**上滚之后不再被强制拽回底部**,模型还在输出时也能回看前文。
- 🗂️ **新标签页紧跟当前标签打开** _(2026‑08‑11)_ —— 打开新标签(把 **SFTP** 展开成整页文件浏览器、在编辑器里打开文件、从主机页新建终端)原本一律**追加到标签条最末尾**,关掉之后就落到了不相干的地方。现在新标签**紧挨着你从中打开它的那个标签**——关掉它就回到原处。连开多个仍保持自然顺序;把标签拖到别的面板仍按原来的规则追加。
- 🖱️ **代码块「复制」不再整片亮起** _(2026‑08‑11)_ —— 鼠标停在智能体回复的任意位置,该条消息里**每一个**代码块的「**复制**」按钮都会一起亮,因为代码块用的是 Tailwind 的匿名 `group`,而 `group-hover:` 会**穿透匹配任意一层**带该类的祖先——包括消息行本身。代码块改用**具名 group**,现在只有光标真正停在上面的那一个才显示按钮。
- 🖥️ **远程桌面控制** _(2026‑08‑03)_ —— 左侧新增「**远程桌面**」标签,把类似向日葵的远程控制直接做进 NebuShell。在想被控的机器上打开该标签点「**启动被控端**」,即进入被控模式并显示本机**局域网地址**和一个随机 **6 位访问码**;在控制端输入该 **IP + 访问码**,即可看到**实时画面并完全操控其鼠标键盘**。画面在局域网内**经 WebRTC 点对点直传**(无中转服务器、不走云),输入在被控端**原生注入**。还支持**多显示器切换**(在会话右侧菜单里选远程显示器)、**文本剪贴板双向同步**、以及**文件推送**——从控制端把文件直接发到被控机的「**下载**」目录,带实时进度条。还内置**远程命令行**——在会话侧边菜单直接打开一个运行在被控机上的真实 **PowerShell / cmd** 终端(基于 node‑pty 的 ConPTY,支持方向键、Tab 补全、颜色)。被控端直接复用 NebuShell 自身(无需另装程序)。第一步:**局域网直连**、被控端仅 **Windows**。
- 🔌 **智能体可重连断线终端** _(2026‑08‑03)_ —— 当某个 SSH 终端掉线(命令返回连接错误,或结果被标为「**终端卡死,建议重连**」)时,智能体现在可以调用新增的 **`reconnect_terminal`** 工具**自己把该终端重新连上**再继续,不用再让你先点重连。它复用标签页原本的连接流程(终端里会显示「**正在连接...**」),把成功或失败回报给模型,并在**包括计划模式在内的所有模式下**都可执行(重连是继续调查的前提,不是写操作)。工具只列出 **SSH** 目标——本机不是网络连接。
- 🧩 **右侧面板按标签页独立** _(2026‑08‑03)_ —— 开着多个标签页时,在一个终端里切换右侧面板(**智能体 / 快捷操作 / 历史命令 / 监控 / 容器 / 主题 / SFTP**)原本会**连带切换所有标签**,因为选中项是一个全局共享值。现在每个终端**各记各自打开的面板**:在一个标签开 SFTP,其它标签不受影响;主机页「**查看容器**」也只为**新开的那个标签**预展开容器面板。(面板宽度仍作为全局尺寸偏好共享。)
- 🚑 **高频输出不再卡死界面** _(2026‑08‑03)_ —— 运行每秒刷新数百次的命令(如 `rsync --info=progress2`)可能**把界面卡死**,因为每个细碎输出块都要单独走一趟 IPC 加一次回放缓冲拼接。现在输出**按帧(约 16ms)合批**:一波数据块合并成一次广播和一次终端写入,把每秒数百条消息压到约 60 条,界面保持流畅。智能体自身的命令输出采集也从反复整段拼接 + 查找哨兵改为**数组累积 + 只扫尾部**,消除长时间高输出命令下的 O(n²) 卡顿。
- ⌨️ **新终端自动聚焦** _(2026‑07‑24)_ —— 打开新终端(或切换到某个已有终端)时会**自动聚焦**,可以直接输入命令,不用再先点一下。只有**当前活动标签页**才会被聚焦,后台终端连接完成不会抢走你正在操作处的焦点。
- 📜 **下拉框可滚动** _(2026‑07‑24)_ —— 选项很多的下拉菜单(如服务器选择)不再**顶穿窗口**——现在会按可用高度封顶并出现**滚动条**,不会被截断。
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

### Web 版(无桌面 Linux 服务器)

服务器没有桌面时:把后端作为 Node 服务运行,用浏览器访问。完整的部署说明、参数和反向代理示例见 [docs/web/README.md](docs/web/README.md)。

```bash
# Docker
docker build -f docker/web/Dockerfile -t nebushell-web .
docker run -d --name nebushell -p 127.0.0.1:8080:8080 -v nebushell-data:/data nebushell-web

# tar.gz + systemd  →  dist-web/NebuShell-web-<版本号>-linux.tar.gz(服务器需 Node.js 22)
npm run build:web && npm run package:web
```

服务默认以 HTTP 监听 `127.0.0.1:8080`,请通过 HTTPS 反向代理(Nginx / Caddy)对外提供。

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
│   ├── mcp/        # 内置 MCP 服务(工具、SSH 连接池、审计日志)
│   ├── proxy/      # 代理检测(本机隧道 / 远端 curl)
│   └── ipc/        # IPC 处理
├── preload/        # 预加载桥接
├── renderer/       # React 界面(终端、SFTP、编辑器、智能体面板)
└── web/            # Web 版:Node 服务端 + 浏览器桥接(electron 替身、WebSocket IPC)
docker/web/         # Web 版 Docker 镜像
packaging/web/      # Web 版启动脚本与 systemd 单元
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
