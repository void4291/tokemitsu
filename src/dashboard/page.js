export const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>tokemitsu - usage</title>
<style>
:root{--bg:#f6f5f1;--card:#fff;--ink:#1b1b18;--mute:#6b6a63;--line:#e4e2da;--spent:#c4562b;--saved:#1f7a5a;--without:#8a8a80;--warn:#a06a00}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--card:#1f1f1c;--ink:#efede6;--mute:#9a988f;--line:#33322d;--spent:#e0805a;--saved:#4cc094;--without:#77766d;--warn:#e0b04a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 64px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:20px}
h1{font-size:20px;margin:0}h2{font-size:15px;margin:0 0 10px}
select,button{font:inherit;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
.grid .card{margin:0}
.k{color:var(--mute);font-size:12px;text-transform:uppercase;letter-spacing:.04em}.v{font-size:28px;font-weight:650;margin-top:2px}.s{color:var(--mute);font-size:13px}
.saved{color:var(--saved)}.spent{color:var(--spent)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:right;padding:8px 6px;border-bottom:1px solid var(--line)}th:first-child,td:first-child{text-align:left}th{color:var(--mute);font-weight:500;font-size:12px}
.tag{font-size:11px;border:1px solid var(--line);border-radius:99px;padding:1px 8px;color:var(--mute)}
.ok{color:var(--saved)}.warn{color:var(--warn)}.fail{color:var(--spent)}
.bar{display:flex;height:22px;border-radius:6px;overflow:hidden;background:var(--line)}
.bar>div{height:100%}
.legend{display:flex;gap:16px;font-size:13px;color:var(--mute);margin-top:8px;flex-wrap:wrap}.dot{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
.note{font-size:13px;color:var(--mute)}svg{width:100%;height:auto;display:block}
.scroll{overflow-x:auto}
</style></head><body><main>
<header><h1>tokemitsu <span class="s">usage</span></h1>
<div><label class="s">Window <select id="since"><option value="7d">7 days</option><option value="30d" selected>30 days</option><option value="90d">90 days</option><option value="all">All time</option></select></label>
<button id="refresh">Refresh</button></div></header>
<div id="err" class="card fail" hidden></div>
<section class="grid" id="hero"></section>
<section class="card"><h2>Claude Code tokens per day</h2><div id="chart" class="scroll"></div>
<div class="legend"><span><i class="dot" style="background:var(--without)"></i>Input + cache writes</span><span><i class="dot" style="background:var(--spent)"></i>Output</span></div>
<div class="note">Cache reads are left out of the chart because they dwarf everything else; they are in the cards above.</div></section>
<section class="card"><h2>Tools</h2><div class="scroll"><table id="lanes"></table></div><div id="notes" class="note"></div></section>
<section class="card"><h2>Setup health</h2><div id="health"></div></section>
<section class="card"><h2>Recent delegations</h2><div class="scroll"><table id="events"></table></div></section>
<p class="note" id="assume"></p>
</main>
<script>
const $=(i)=>document.getElementById(i);
const usd=(n)=>'$'+(n||0).toFixed(4);
const int=(n)=>Math.round(n||0).toLocaleString();
const esc=(s)=>String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function load(){
  const since=$('since').value;
  try{
    const [r,h,e]=await Promise.all([fetch('/api/summary?since='+since).then(x=>x.json()),fetch('/api/health').then(x=>x.json()),fetch('/api/events?limit=15').then(x=>x.json())]);
    if(r.error)throw new Error(r.error);
    $('err').hidden=true;render(r,h,e);
  }catch(x){$('err').hidden=false;$('err').textContent='Could not load data: '+x.message;}
}
function laneText(l){
  const m=l.metrics||{};
  if(l.available===false)return 'not available';
  if(l.id==='rtk')return int(m.commands)+' commands; rtk reports '+int(m.savedTokens)+' of '+int(m.rawTokens)+' tokens saved';
  if(l.id==='graph')return int(m.calls)+' calls; '+int(m.resultBytes)+' bytes returned';
  if(l.id==='delegate')return int(m.calls)+' calls ('+m.reads+' read, '+m.writes+' write); worker cost '+usd(m.workerUsd)+' (reported by Claude CLI)';
  return '';
}
function render(r,h,e){
  const t=r.totals,k=t.tokens;
  $('hero').innerHTML=[
    ['Responses',int(t.messages),int(t.sessions)+' sessions'],
    ['Output tokens',int(k.out),'written by the model'],
    ['Input + cache writes',int(k.in+k.cw),'uncached input '+int(k.in)+', cache writes '+int(k.cw)],
    ['Cache reads',int(k.cr),'re-reads of cached context'],
    ['Cheap worker cost',usd(t.workerUsd),'reported by Claude CLI'],
  ].map(([a,v,s])=>'<div class="card"><div class="k">'+a+'</div><div class="v">'+v+'</div><div class="s">'+s+'</div></div>').join('');
  chart(r.daily);
  $('lanes').innerHTML='<tr><th>Tool</th><th>Basis</th><th>Recorded</th></tr>'+r.lanes.map(l=>
    '<tr><td>'+esc(l.name)+'</td><td><span class="tag">'+(l.available===false?'not available':l.kind)+'</span></td><td>'+esc(laneText(l))+'</td></tr>').join('');
  $('notes').innerHTML=r.lanes.map(l=>'<div>- '+esc(l.name)+': '+esc(l.note||'')+'</div>').join('');
  $('health').innerHTML=h.checks.map(c=>'<div><span class="'+(c.status==='ok'?'ok':c.status==='fail'?'fail':'warn')+'">'+({ok:'OK',warn:'WARN',fail:'FAIL',skip:'OFF'}[c.status])+'</span> '+esc(c.label)+' <span class="s">'+esc(c.detail||'')+(c.fix?' - fix: <code>'+esc(c.fix)+'</code>':'')+'</span></div>').join('');
  $('events').innerHTML='<tr><th>When</th><th>Action</th><th>Target</th><th>Worker tokens (in/out)</th><th>Worker $</th><th>Latency</th></tr>'+
    (e.events.length?e.events.map(v=>'<tr><td>'+esc(v.ts.slice(0,16).replace('T',' '))+'</td><td>'+esc(v.tool)+'</td><td>'+esc(v.meta?.file||v.meta?.out||'')+'</td><td>'+int(v.worker?.in)+' / '+int(v.worker?.out)+'</td><td>'+usd(v.worker?.costUsd)+'</td><td>'+(v.latencyMs?(v.latencyMs/1000).toFixed(1)+'s':'')+'</td></tr>').join(''):'<tr><td colspan="6" class="s">No delegations yet. Enable with: tokemitsu delegate enable</td></tr>');
  $('assume').textContent=r.notes.join(' ');
}
function chart(days){
  if(!days.length){$('chart').innerHTML='<div class="s">No data in this window.</div>';return;}
  const W=Math.max(640,days.length*28),H=220,L=56,B=24,T=8,R=8,iw=W-L-R,ih=H-T-B;
  const max=Math.max(...days.map(d=>d.in+d.cw+d.out),1);
  const bw=Math.min(22,iw/days.length*0.7),step=iw/days.length;
  let s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Claude Code tokens per day">';
  for(let i=0;i<=4;i++){const y=T+ih-ih*i/4;s+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y+'" y2="'+y+'" stroke="var(--line)"/><text x="'+(L-6)+'" y="'+(y+4)+'" text-anchor="end" font-size="11" fill="var(--mute)">'+int(max*i/4)+'</text>';}
  days.forEach((d,i)=>{const x=L+step*i+(step-bw)/2,a=d.in+d.cw,h1=ih*a/max,h2=ih*d.out/max;
    s+='<rect x="'+x+'" y="'+(T+ih-h1)+'" width="'+bw+'" height="'+h1+'" fill="var(--without)"><title>'+d.day+' input + cache writes: '+int(a)+'</title></rect>';
    s+='<rect x="'+x+'" y="'+(T+ih-h1-h2)+'" width="'+bw+'" height="'+h2+'" fill="var(--spent)"><title>'+d.day+' output: '+int(d.out)+'</title></rect>';
    if(days.length<=14||i%Math.ceil(days.length/10)===0)s+='<text x="'+(x+bw/2)+'" y="'+(H-6)+'" text-anchor="middle" font-size="10" fill="var(--mute)">'+d.day.slice(5)+'</text>';});
  $('chart').innerHTML=s+'</svg>';
}
$('since').onchange=load;$('refresh').onclick=load;load();setInterval(load,30000);
</script></body></html>`;
