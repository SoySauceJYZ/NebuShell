// 拓扑发现在每台主机上执行的一段 POSIX sh(经 stdin 传给 `sh -s`)。
// 只读:列出监听端口、已建立连接、进程、cgroup、systemd、docker、nginx 配置和 GPU 进程。
// 能免密 sudo 时自动用 sudo 拿进程归属(ss -p 需要)与 nginx -T。
// 每段以 `__D_NAME__[后缀]` 单独一行开头,由 parse.ts 拆分。

export const DISCOVERY_SCRIPT = String.raw`
export PATH="$PATH:/usr/sbin:/sbin:/usr/local/sbin:/usr/local/bin"
export LC_ALL=C
S=""
if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then S="sudo -n"; fi
echo "__D_ID__"
hostname 2>/dev/null
id -u
[ -n "$S" ] && echo sudo || echo nosudo
uname -s 2>/dev/null
echo "__D_IPS__"
(ip -o addr show 2>/dev/null || ifconfig 2>/dev/null) | head -400

if command -v ss >/dev/null 2>&1; then
  LISTEN=$($S ss -H -tlnp 2>/dev/null || $S ss -tlnp 2>/dev/null | tail -n +2)
  ESTAB=$($S ss -H -tnp state established 2>/dev/null | head -4000)
  FMT=ss
else
  LISTEN=$($S netstat -tlnp 2>/dev/null | grep -i listen)
  ESTAB=$($S netstat -tnp 2>/dev/null | grep ESTABLISHED | head -4000)
  FMT=netstat
fi
echo "__D_LISTEN__$FMT"
printf '%s\n' "$LISTEN"
echo "__D_ESTAB__$FMT"
printf '%s\n' "$ESTAB"

echo "__D_PS__"
ps -eo pid=,ppid=,user=,comm=,args= 2>/dev/null | cut -c1-700 | head -4000

GPUAPPS=""
if command -v nvidia-smi >/dev/null 2>&1; then
  GPUAPPS=$(nvidia-smi --query-compute-apps=pid,used_memory,gpu_uuid --format=csv,noheader,nounits 2>/dev/null)
  echo "__D_GPUS__"
  nvidia-smi --query-gpu=index,uuid,name,memory.total --format=csv,noheader,nounits 2>/dev/null
  echo "__D_GPUAPPS__"
  printf '%s\n' "$GPUAPPS"
fi

PIDS=$( { printf '%s\n%s\n' "$LISTEN" "$ESTAB" | grep -o 'pid=[0-9]*' | cut -d= -f2; printf '%s\n' "$LISTEN" "$ESTAB" | grep -o ' [0-9][0-9]*/' | tr -d ' /'; printf '%s\n' "$GPUAPPS" | cut -d, -f1 | tr -d ' '; } | grep -E '^[0-9]+$' | sort -un | head -600 )
echo "__D_CGROUP__"
for p in $PIDS; do
  if [ -r /proc/$p/cgroup ]; then printf '%s %s\n' "$p" "$(tr '\n' '|' < /proc/$p/cgroup 2>/dev/null | cut -c1-600)"; fi
done

echo "__D_SYSTEMD__"
systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null | head -600

D=""
if command -v docker >/dev/null 2>&1; then
  if docker ps -q >/dev/null 2>&1; then D="docker"; elif [ -n "$S" ] && $S docker ps -q >/dev/null 2>&1; then D="$S docker"; fi
fi
if [ -n "$D" ]; then
  echo "__D_DOCKER__"
  IDS=$($D ps -q 2>/dev/null | head -200)
  if [ -n "$IDS" ]; then
    $D inspect --format '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"pid":{{json .State.Pid}},"status":{{json .State.Status}},"env":{{json .Config.Env}},"cmd":{{json .Config.Cmd}},"entrypoint":{{json .Config.Entrypoint}},"ports":{{json .NetworkSettings.Ports}},"exposed":{{json .Config.ExposedPorts}},"networks":{{json .NetworkSettings.Networks}},"netmode":{{json .HostConfig.NetworkMode}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}' $IDS 2>/dev/null
    for c in $IDS; do
      P=$($D inspect --format '{{.State.Pid}} {{.HostConfig.NetworkMode}}' "$c" 2>/dev/null)
      CP=$(echo "$P" | cut -d' ' -f1)
      CM=$(echo "$P" | cut -d' ' -f2)
      if [ "$CM" != "host" ] && [ -n "$CP" ] && [ "$CP" != "0" ]; then
        echo "__D_CTCP__$c"
        $S cat /proc/$CP/net/tcp /proc/$CP/net/tcp6 2>/dev/null | head -3000
      fi
    done
    for c in $($D ps --format '{{.ID}} {{.Image}}' 2>/dev/null | awk 'tolower($2) ~ /nginx|openresty|tengine/ {print $1}'); do
      echo "__D_NGINXC__$c"
      $D exec "$c" nginx -T 2>/dev/null | head -c 1500000
    done
  fi
fi

if command -v nginx >/dev/null 2>&1 || command -v openresty >/dev/null 2>&1; then
  echo "__D_NGINX__"
  NG=nginx
  command -v nginx >/dev/null 2>&1 || NG=openresty
  NGT=$($S $NG -T 2>/dev/null | head -c 2000000)
  if [ -n "$NGT" ]; then
    printf '%s\n' "$NGT"
  else
    for f in /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* /usr/local/nginx/conf/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf; do
      [ -r "$f" ] && { echo "# configuration file $f:"; head -c 300000 "$f"; echo; }
    done
  fi
fi
echo "__D_END__"
`
