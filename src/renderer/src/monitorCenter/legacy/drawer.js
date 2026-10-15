import { get, fmtUptime } from './api.js';
import { lineChart, PAL } from './charts.js';
import { $id, listen, visible } from './dom.js';

let mask, drawer, bodyEl, titleEl, subEl, currentId = null, refreshTimer = null;
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const val = (v, suffix='') => finite(v) ? `${v}${suffix}` : 'N/A';
const statusText = { online:'在线',degraded:'采集降级',auth_failed:'认证失败',unreachable:'不可达',unsupported:'不支持',pending:'等待采集' };
const esc = value => String(value ?? 'N/A').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function initDrawer() {
  mask=$id('drawer-mask'); drawer=$id('drawer'); bodyEl=$id('drawer-body'); titleEl=$id('drawer-title'); subEl=$id('drawer-sub');
  mask.addEventListener('click',closeDrawer); $id('drawer-close').addEventListener('click',closeDrawer); listen(document,'keydown',e=>{if(e.key==='Escape')closeDrawer();});
}
export async function openDeviceDrawer(id) { currentId=id; mask.classList.add('open'); drawer.classList.add('open'); bodyEl.innerHTML='<div style="color:var(--dim);padding:30px;text-align:center">PROBE LINKING…</div>'; await renderDetail(); clearInterval(refreshTimer); refreshTimer=setInterval(renderDetail,4000); }
export function closeDrawer(){if(!mask)return;mask.classList.remove('open');drawer.classList.remove('open');currentId=null;clearInterval(refreshTimer);}

async function renderDetail(){ if(!currentId||!visible())return; let d; try{d=await get(`/api/devices/${currentId}`);}catch(_){return;} if(!currentId)return; titleEl.textContent=d.name; subEl.textContent=`${d.role} · ${d.ip} · ${d.os||'N/A'} · 在线 ${finite(d.uptimeSec)?fmtUptime(d.uptimeSec):'N/A'}`; bodyEl.innerHTML=detailHtml(d); drawDetailCharts(d); }

function detailHtml(d){
  const hw=d.hardware||{}, cpu=hw.cpu||{}, mem=hw.mem||{}, disks=d.disks||[], gpus=d.gpus||[], H=d.hist||{};
  const memPct=finite(d.mem?.used)&&finite(d.mem?.total)&&Number(d.mem.total)>0?d.mem.used/d.mem.total*100:null;
  const healthText={normal:'正常',warn:'警告',critical:'严重',unknown:'未知'};
  const gpuRows=gpus.length?gpus.map(g=>`<div class="gpu-row"><div><div class="gi">G${esc(g.index)}</div></div><div>${esc(g.model)} · 状态 ${esc(healthText[g.health]||'未知')} · P-State ${esc(g.pstate)} · 核心 ${val(g.util,'%')} · 显存利用率 ${val(g.memoryUtil,'%')} · ${g.unified?'统一内存':`显存 ${val(g.vramUsed)}/${val(g.vramTotal)}GB`} · 温度 ${val(g.temp,'°C')} · 功耗 ${val(g.power,'W')} · 风扇 ${val(g.fan,'%')}</div></div>`).join(''):'<div class="na-block">未检测到 NVIDIA GPU</div>';
  return `<div class="dr-sec"><div class="panel-t">采集状态 <span class="tail">AGENTLESS COLLECTION</span></div><div class="hw-grid">
    <div class="hw-item"><div class="k">状态</div><div class="v">${esc(statusText[d.collectionStatus]||d.collectionStatus)}</div></div><div class="hw-item"><div class="k">协议</div><div class="v">${esc(d.protocol)}</div></div>
    <div class="hw-item"><div class="k">最后采集</div><div class="v">${d.lastSeenAt?new Date(d.lastSeenAt).toLocaleString():'N/A'}</div></div><div class="hw-item"><div class="k">最近错误</div><div class="v">${esc(d.lastError||'无')}</div></div></div></div>
    <div class="dr-sec"><div class="panel-t">硬件配置 <span class="tail">HARDWARE MANIFEST</span></div><div class="hw-grid">
    <div class="hw-item"><div class="k">处理器 CPU</div><div class="v">${esc(cpu.model)} <small>${val(cpu.cores,'C')}/${val(cpu.threads,'T')}</small></div></div><div class="hw-item"><div class="k">内存 MEMORY</div><div class="v">${val(mem.total,' GB')}</div></div>
    <div class="hw-item"><div class="k">内核 KERNEL</div><div class="v">${esc(d.kernel)}</div></div><div class="hw-item"><div class="k">端口探测</div><div class="v">SSH:${d.sshPort||22} ${d.ports?.ssh?'OPEN':'CLOSED'} · 5985 ${d.ports?.winrmHttp?'OPEN':'CLOSED'} · 5986 ${d.ports?.winrmHttps?'OPEN':'CLOSED'}</div></div></div></div>
    <div class="dr-sec"><div class="panel-t">资源实况 <span class="tail">RECENT ${Math.max(H.cpu?.length||0,H.mem?.length||0)} SAMPLES</span></div><div class="split-2 mb12">
    <div class="panel"><div class="panel-t" style="font-size:11px">CPU ${val(d.cpu?.util,'%')}</div><div class="chart-box"><canvas class="chart" id="ch-cpu"></canvas></div></div><div class="panel"><div class="panel-t" style="font-size:11px">MEM ${val(finite(memPct)?memPct.toFixed(1):null,'%')}</div><div class="chart-box"><canvas class="chart" id="ch-mem"></canvas></div></div></div>
    <div class="split-2"><div class="panel"><div class="panel-t" style="font-size:11px">NET RX ${val(d.net?.rx)} / TX ${val(d.net?.tx)} MB/s</div><div class="chart-box"><canvas class="chart" id="ch-net"></canvas></div></div>
    <div class="panel"><div class="panel-t" style="font-size:11px">存储挂载</div>${disks.length?disks.map(x=>`<div class="meter" style="margin-bottom:8px"><div class="m-lb"><span>${esc(x.mount)}</span><span class="v">${val(x.usedPct,'%')} · ${val(finite(x.total)?(x.total/1024).toFixed(2):null,'TB')}</span></div><div class="bar ${finite(x.usedPct)&&x.usedPct>85?'r':'c'}"><i style="width:${finite(x.usedPct)?x.usedPct:0}%"></i></div></div>`).join(''):'<div class="na-block">磁盘数据不可用</div>'}</div></div></div>
    <div class="dr-sec"><div class="panel-t">加速单元 <span class="tail">GPU MATRIX</span></div>${gpuRows}</div>`;
}
function drawDetailCharts(d){const H=d.hist||{},q=id=>$id(id);if(q('ch-cpu')&&(H.cpu||[]).length)lineChart(q('ch-cpu'),[H.cpu],{max:100,min:0,threshold:90});if(q('ch-mem')&&(H.mem||[]).length)lineChart(q('ch-mem'),[H.mem],{max:100,min:0,colors:[PAL.cyan]});if(q('ch-net')&&((H.rx||[]).length||(H.tx||[]).length))lineChart(q('ch-net'),[H.rx||[],H.tx||[]],{min:0,colors:[PAL.cyan,PAL.amber]});}
