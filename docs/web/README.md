# NebuShell Web 版(无桌面 Linux 服务器部署)

Web 版把 NebuShell 的后端作为普通 Node 服务跑在服务器上,界面通过浏览器访问。
主机管理、SSH 终端、SFTP、Docker 面板、AI 智能体、代理管理、MCP 服务都和桌面版一致;
**远程桌面**需要真实屏幕,只在桌面版提供。

- **单用户**:保险库主密码就是登录密码。服务进程内同一时间只有一个保险库;在任一浏览器里
  「锁定」会让所有已登录的浏览器回到解锁页。
- **「本地」= 服务器本机**:文件页的本地面板浏览的是服务器的文件系统,智能体的本机命令也在服务器上
  执行(以服务进程的用户身份)。可用 `--no-local` 关闭。
- **你电脑上的文件**:「上传」按钮和拖入浏览器的文件会先传到服务器暂存,再走原来的传输队列;
  「下载到…」会通过浏览器下载(目录打包为 `.tar.gz`)。
- 服务本身只说 **HTTP**,请放在 **HTTPS 反向代理**后面(浏览器剪贴板 API 也需要 HTTPS)。

## 方式一:Docker

```bash
docker build -f docker/web/Dockerfile -t nebushell-web .
docker run -d --name nebushell --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v nebushell-data:/data \
  -e NEBUSHELL_TRUST_PROXY=1 \
  nebushell-web
```

数据(保险库、设置、聊天与命令历史、MCP 审计日志)都在 `/data` 卷里。升级 = 重新构建/拉取镜像后重建容器,
卷保持不变。容器里「服务器本机」指的是容器本身。

## 方式二:tar.gz + systemd

需要 Node.js ≥ 22。

```bash
npm run build:web && npm run package:web          # 产出 dist-web/NebuShell-web-<版本>-linux.tar.gz
sudo tar -xzf NebuShell-web-*-linux.tar.gz -C /opt   # 解压到 /opt/nebushell-web
sudo useradd --system --home-dir /var/lib/nebushell --shell /usr/sbin/nologin nebushell
sudo cp /opt/nebushell-web/nebushell-web.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now nebushell-web
journalctl -u nebushell-web -f
```

手动运行:`sh /opt/nebushell-web/nebushell-web --port 8080 --data-dir ~/.nebushell-web`

## 参数

| 参数 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `--host` | `NEBUSHELL_HOST` | `127.0.0.1` | 监听地址 |
| `--port` | `NEBUSHELL_PORT` | `8080` | 监听端口 |
| `--data-dir` | `NEBUSHELL_DATA_DIR` | `~/.nebushell-web` | 数据目录(建议权限 700) |
| `--static-dir` | `NEBUSHELL_STATIC_DIR` | `../client` | 前端文件目录 |
| `--trust-proxy` | `NEBUSHELL_TRUST_PROXY=1` | 关 | 信任反代的 `X-Forwarded-For/-Proto/-Host` |
| `--no-local` | `NEBUSHELL_NO_LOCAL=1` | 关 | 关闭服务器本机文件面板与本机命令执行 |

## 反向代理

WebSocket 路径是 `/ws`,反代必须转发 Upgrade 头,并保留 `Host`(服务端用它校验 `Origin`)。

**Caddy**(自动申请证书):

```
nebushell.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

**Nginx**:

```nginx
server {
    listen 443 ssl http2;
    server_name nebushell.example.com;
    ssl_certificate     /etc/ssl/nebushell/fullchain.pem;
    ssl_certificate_key /etc/ssl/nebushell/privkey.pem;

    client_max_body_size 0;          # 浏览器上传大文件
    proxy_request_buffering off;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1d;       # 长连接终端
    }
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

## 安全说明

- 务必走 HTTPS,并只把 8080 绑定在 `127.0.0.1`(或内网)。服务以 `0.0.0.0` 监听时会在日志里提醒。
- 登录会话:`HttpOnly` + `SameSite=Strict` Cookie,7 天有效,只保存在内存里——服务重启后保险库重新上锁,
  所有人需重新登录。连续输错密码会按 IP 指数退避(最长 15 分钟)。
- WebSocket 握手校验 Cookie 与 `Origin`,防跨站劫持。
- 和桌面版一样,解锁后浏览器会拿到保险库里的主机凭据(用于发起连接),请只在可信设备上登录。
- 「服务器本机」功能等同于给登录者一个服务器上的 shell(以服务用户身份)。不需要时用 `--no-local` 关闭,
  并用专门的低权限用户运行服务(Docker 镜像与 systemd 单元默认如此)。
- 内置 MCP 服务(设置页开启)在 Web 版同样可用,审计日志位于数据目录下的 `mcp-audit.log`。

## 已知限制

- 不支持远程桌面(控制端与被控端)。
- 不支持把标签页拖出成独立窗口;想并排看可以开多个浏览器标签页(每个页面独立的会话)。
- 浏览器里 Ctrl+W 会关闭标签页且无法拦截;有终端打开时会先弹出离开确认。
- 拖入浏览器的「文件夹」无法读取,请打包后上传;下载目录会自动打包为 `.tar.gz`。
- 刷新页面会结束该页打开的 SSH 会话(60 秒宽限期,用于网络闪断自动重连)。

## 开发

```bash
npm run dev:web:server        # 监听构建 out/web/server
node --watch out/web/server/index.js --port 18080 --data-dir .web-data
npm run dev:web:client        # http://localhost:15174,/api 与 /ws 代理到 18080
```
