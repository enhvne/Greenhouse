'use strict';
const liveMode=window.GREENHOUSE_RUNTIME?.live===true;
let settingsDirty=false;
const $ = id => document.getElementById(id);
const renderedHTML = new WeakMap();
function updateHTML(element, html) {
 if (renderedHTML.get(element) === html) return;
 element.innerHTML = html;
 renderedHTML.set(element, html);
}
const icons = {
 leaf:'<path d="M20 4C9 2 3 7 5 14c2 6 12 5 15-10ZM5 20c3-5 6-8 11-11"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',sliders:'<path d="M5 3v6m0 4v8M12 3v10m0 4v4m7-18v3m0 4v11M2 9h6m1 8h6m1-11h6"/>',chart:'<path d="M3 3v18h18M6 16l5-6 4 3 6-7"/>',bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="m10 3-1 3-3 1-3-1-1 4 3 2v2l-2 2 2 4 3-1 2 1 1 2 4-1 1-3 2-1 3 1 1-4-3-2v-2l2-2-2-4-3 1-2-1-1-2Z"/>',wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0m-4 4h.01"/>',temp:'<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Zm3-5v8"/><circle cx="12" cy="17" r="1"/>',water:'<path d="M12 3c-2 4-7 8-7 12a7 7 0 0 0 14 0c0-4-5-8-7-12Z"/>',soil:'<path d="M3 20h18M12 20v-8m0 3C5 15 4 11 4 7c5 0 8 2 8 6m0 1c0-6 4-9 8-9 0 6-2 9-8 9Z"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19"/>',tank:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 13c3-3 5 3 8 0s5 3 8 0"/>',fan:'<circle cx="12" cy="12" r="2"/><path d="M10 12c-6 0-8-5-4-7 3-1 5 2 5 5m3 1c3-5 8-4 8 0-1 3-4 4-7 2m-3 1c3 5 0 9-3 7-3-2-2-6 1-8"/>',check:'<path d="m5 12 4 4L19 6"/>'};
const icon = name => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon)});
const metrics = {
 temp:['Температур','°C','temp','#fff0df','#985618'],
 humidity:['Агаарын чийг','%','water','#e7f2fb','#28658b'],
 soil:['Хөрсний чийг','%','soil','#e8f2e4','#397450'],
 light:['Гэрлийн түвшин','lux','sun','#fff5da','#8b6416'],
 water:['Усны түвшин','%','tank','#e4f1ee','#296d61']
};
const devices = {
 pump:['Усалгааны насос','water','Хөрс тохируулсан хэмжээнээс хуурай болоход 10 секунд усална. Дараагийн усалгаанаас өмнө 60 секунд амарна.'],
 fan:['Агааржуулалтын сэнс','fan','Тохируулсан хэмд хүрэхэд сэнс асна. Температур 2 °C-ээр буухад унтарна.'],
 lamp:['Ургалтын гэрэл','sun','Ногоонуудын гэрэлтэй байх цагийг хуваариар нь тааруулна.']
};
const key='greenhouse-demo-v1';
const number=(value,digits=0)=>value===null?'—':Number(value).toLocaleString('mn-MN',{maximumFractionDigits:digits,minimumFractionDigits:digits});
const clockTime=t=>new Date(t).toLocaleTimeString('mn-MN',{hour:'2-digit',minute:'2-digit'});
const dateTime=t=>new Date(t).toLocaleString('mn-MN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const h=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base={temp:24.6,humidity:67,soil:43,light:620,water:78};
function initial(){
 const now=Date.now();
 const history=Array.from({length:169},(_,i)=>({
  at:now-(168-i)*3600000,
  temp:24+Math.sin(i*.38)*3.1, humidity:65+Math.cos(i*.38)*8,
  soil:43+Math.sin(i*.42)*7, light:Math.max(40,480+Math.sin(i*.26)*450), water:79+Math.cos(i*.16)*9
 }));
 history[168]={at:now,...base};
 return {settings:{hot:29,dry:35,waterMin:20,lightStart:'06:00',lightEnd:'19:00'}, values:{...base},history,
 devices:{pump:{mode:'manual',on:false,stopAt:0,readyAt:0},fan:{mode:'auto',on:false},lamp:{mode:'manual',on:true}},
 events:[{at:now,kind:'info',message:'Greenhouse-д тавтай морил! Демо хүлэмжээ туршаад үзээрэй 🌱',read:false}]};
}
let state=initial();
try{const saved=liveMode?null:JSON.parse(localStorage.getItem(key));if(saved?.settings&&saved.values&&saved.devices?.pump&&Array.isArray(saved.events)&&saved.history?.length)state=saved}catch{}
if(liveMode){state.values=Object.fromEntries(Object.keys(base).map(k=>[k,null]));state.history=[];state.events=[];for(const d of Object.values(state.devices)){d.on=null;d.mode='manual'}}
function save(){if(liveMode)return;try{localStorage.setItem(key,JSON.stringify(state))}catch{}}
function event(message,kind='info'){state.events.unshift({at:Date.now(),kind,message,read:false});state.events=state.events.slice(0,60)}
let toastTimer;
function toast(message){$('toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').textContent='',3500)}
function setOn(id,on,now){
 const d=state.devices[id];
 if(d.on===on)return false;
 d.on=on;
 if(id==='pump'){d.stopAt=on?now+10000:0;if(!on)d.readyAt=now+60000}
 event(devices[id][0]+(on?' аслаа.':' унтарлаа.'));
 return true;
}
function applyRules(now=Date.now()){
 if(liveMode)return false;
 const d=state.devices,s=state.settings,v=state.values;
 let changed=false;
 if(d.pump.on&&(now>=d.pump.stopAt||v.water<s.waterMin))changed=setOn('pump',false,now)||changed;
 if(d.pump.mode==='auto'&&!d.pump.on&&now>=d.pump.readyAt&&v.water>=s.waterMin&&v.soil<s.dry)changed=setOn('pump',true,now)||changed;
 if(d.fan.mode==='auto'){
  if(v.temp>=s.hot)changed=setOn('fan',true,now)||changed;
  else if(v.temp<=s.hot-2)changed=setOn('fan',false,now)||changed;
 }
 if(d.lamp.mode==='auto'){
  const date=new Date(now);
  const time=String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0');
  const active=s.lightStart<s.lightEnd?time>=s.lightStart&&time<s.lightEnd:time>=s.lightStart||time<s.lightEnd;
  changed=setOn('lamp',active,now)||changed;
 }
 return changed;
}
function command(id,action){
 if(liveMode){void sendLiveCommand(id,action);return}
 const d=state.devices[id],now=Date.now();
 if(action==='manual'||action==='auto'){
  if(d.mode===action)return;
  d.mode=action;
  event(devices[id][0]+(action==='auto'?' автомат горимд шилжлээ.':' гар горимд шилжлээ.'));
 }else{
  if(d.mode!=='manual')return;
  if(id==='pump'&&action==='on'&&!d.on){
   if(state.values.water<state.settings.waterMin){event('Саванд ус бага байна. Насос асаагүй тул эхлээд усаа нэмээрэй.','warn');save();render();toast('Ус бага байна. Савандаа ус нэмээрэй.');return}
   if(now<d.readyAt){toast('Дахин услах хүртэл '+Math.ceil((d.readyAt-now)/1000)+' секунд хүлээнэ үү.');return}
  }
  setOn(id,action==='on',now);
 }
 applyRules(now);save();render();toast('Боллоо, төлөв нь шинэчлэгдлээ ✓');
}
const scenarios={
 normal:['Хэвийн өдөр',base],hot:['Халуун өдөр',{temp:36}],dry:['Хөрс хуурайшвал',{soil:22}],low:['Ус бага',{water:8}],dark:['Гэрэл багасвал',{light:80}]
};
function checkAlerts(){
 const v=state.values,s=state.settings;
 if(v.temp>=s.hot)event('Температур тохируулсан хэмд хүрлээ. Сэнсний төлөвийг шалгаарай.','warn');
 if(v.soil<s.dry)event('Хөрсний чийг багаслаа. Усалгаагаа шалгаарай.','warn');
 if(v.water<s.waterMin)event('Ус бага байна. Усаа нэмтэл насос асахгүй.','warn');
}
function scenario(id){
 if(liveMode)return;
 state.values={...base,...scenarios[id][1]};
 state.history.push({at:Date.now(),...state.values});
 state.history=state.history.slice(-420);
 checkAlerts();applyRules();save();render();toast(scenarios[id][0]+' — демо дээр туршиж байна.');
}
function badge(on){if(on===null)return '<span class="pill off">Хүлээж байна</span>';return '<span class="pill '+(on?'on':'off')+'"><i></i>'+(on?'Асаалттай':'Унтраалттай')+'</span>'}
function renderDevices(){
 updateHTML($('quick-devices'), Object.entries(devices).map(([id,[name,symbol]])=>'<div class="quick-row"><span class="device-icon">'+icon(symbol)+'</span><div style="flex:1"><strong>'+name+'</strong><small>'+(state.devices[id].mode==='auto'?'Автомат':'Гар')+' горим</small></div>'+badge(state.devices[id].on)+'</div>').join(''));
 $('devices').innerHTML=Object.entries(devices).map(([id,[name,symbol,help]])=>{
  const d=state.devices[id], auto=d.mode==='auto';
  const mode=(value,label)=>'<button type="button" data-device="'+id+'" data-action="'+value+'" aria-pressed="'+(d.mode===value)+'">'+label+'</button>';
  const act=(value,label,disabled)=>'<button type="button" data-device="'+id+'" data-action="'+value+'" '+(disabled?'disabled':'')+'>'+label+'</button>';
  return '<article class="card device" data-on="'+d.on+'"><div class="device-top"><span class="device-icon">'+icon(symbol)+'</span><h2>'+name+'</h2></div>'+badge(d.on)+'<p>'+help+'</p><div class="actions">'+mode('manual','Гар')+mode('auto','Автомат')+'</div><div class="actions">'+act('on','Асаах',auto||d.on)+act('off','Унтраах',auto||!d.on)+'</div>'+'<small class="mode-help">'+(auto?'Одоо автоматаар ажиллана. Өөрөө удирдмаар байвал «Гар»-ыг сонгоорой.':'Удирдлага чиний гарт. Асаах, унтраах товчоо сонгоорой.')+'</small>'+(id==='pump'?'<small class="subtle" id="pump-timer"></small>':'')+'</article>';
 }).join('');
}
function drawChart(el,rows,id){
 if(!rows.length){updateHTML(el,'Энэ хугацаанд хэмжилт хараахан алга. Өөр хугацаа сонгоод үзээрэй.');return}
 rows=rows.filter(r=>r[id]!==null);
 if(!rows.length){updateHTML(el,'Мэдрэгчээс хэмжилт хараахан ирээгүй байна.');return}
 const nums=rows.map(r=>r[id]);
 const min=Math.floor(Math.min(...nums)-1), max=Math.ceil(Math.max(...nums)+1);
 const plot={left:46,top:17,width:520,height:146};
 const first=rows[0].at, last=rows.at(-1).at;
 const x=i=>plot.left+(last===first?0:(rows[i].at-first)/(last-first))*plot.width;
 const y=v=>plot.top+(max-v)/(max-min)*plot.height;
 const pts=nums.map((v,i)=>x(i).toFixed(1)+','+y(v).toFixed(1));
 const grid=Array.from({length:5},(_,i)=>{const yy=plot.top+i*plot.height/4;return '<path d="M46 '+yy+'h520" stroke="#e6eee6"/><text class="chart-label" x="40" y="'+(yy+4)+'" text-anchor="end">'+Math.round(max-i*(max-min)/4)+'</text>'}).join('');
 const ticks=[0,Math.floor((rows.length-1)/2),rows.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>'<text class="chart-label" x="'+x(i)+'" y="188" text-anchor="'+(i===0?'start':i===rows.length-1?'end':'middle')+'">'+h(rows.length>30?dateTime(rows[i].at):clockTime(rows[i].at))+'</text>').join('');
 const [label,unit]=metrics[id];
 updateHTML(el, '<p class="subtle">'+label+' · '+unit+'</p><svg class="chart-svg" viewBox="0 0 580 198" role="img" aria-label="'+label+' хугацаагаар өөрчлөгдсөн график">'+grid+'<polygon fill="#e4f2e2" points="'+x(0)+',163 '+pts.join(' ')+' '+x(rows.length-1)+',163"/><polyline fill="none" stroke="#2b7752" stroke-width="2.5" stroke-linejoin="round" points="'+pts.join(' ')+'"/><circle cx="'+x(rows.length-1)+'" cy="'+y(nums.at(-1))+'" r="4.5" fill="#2b7752"/>'+ticks+'</svg>');
}
function historyRows(){return state.history.filter(r=>r.at>=Date.now()-Number($('range').value)*3600000-5000)}
function renderHistory(){
 const rows=historyRows();
 drawChart($('history-chart'),rows,$('metric-select').value);
 updateHTML($('readings'), rows.slice(-12).reverse().map(r=>'<tr><td>'+h(dateTime(r.at))+'</td>'+Object.entries(metrics).map(([id,[,unit]])=>'<td>'+number(r[id],id==='temp'?1:0)+' '+unit+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="6">Хэмжилт алга</td></tr>');
}
function render(){
 const focused=document.activeElement;
 const focusedDevice=focused?.dataset?.device;
 const focusedAction=focused?.dataset?.action;
 const focusedRead=focused?.dataset?.read;
 updateHTML($('metrics'), Object.entries(metrics).map(([id,[label,unit,symbol,tint,tone]])=>'<article class="metric"><span class="metric-icon" style="--tint:'+tint+';--tone:'+tone+'">'+icon(symbol)+'</span><small>'+label+'</small><div class="value">'+number(state.values[id],id==='temp'?1:0)+'<em>'+unit+'</em></div><button type="button" class="metric-history" data-metric="'+id+'" aria-label="'+label+' — түүх харах">↗</button></article>').join(''));
 $('updated').textContent='Сүүлийн хэмжилт · '+(state.history.length?clockTime(state.history.at(-1).at):'Хүлээж байна');
 drawChart($('overview-chart'),state.history.slice(-24),'temp');
 renderDevices();renderHistory();
 const unread=state.events.filter(e=>!e.read).length;
 $('nav-count').textContent=unread||'';
 $('read-all').disabled=!unread;
 updateHTML($('events'), state.events.map((e,i)=>'<div class="event '+(e.kind==='warn'?'warn':'')+'"><span class="device-icon">'+icon(e.kind==='warn'?'bell':'check')+'</span><div><strong>'+h(e.message)+'</strong><small>'+h(dateTime(e.at))+' · '+(e.read?'Уншсан':e.kind==='warn'?'Анхааруулга':'Үйлдэл')+'</small></div>'+(e.read?'':'<button data-read="'+i+'" type="button">Уншсан</button>')+'</div>').join('')||'<p>Одоохондоо шинэ мэдээ алга 🌿</p>');
 updateClock();
 if(liveMode && typeof liveControls==='function')liveControls();
 if(focusedDevice){
  const candidate=document.querySelector('[data-device="'+focusedDevice+'"][data-action="'+focusedAction+'"]');
  const fallback=document.querySelector('[data-device="'+focusedDevice+'"]:not(:disabled)');
  (candidate&&!candidate.disabled?candidate:fallback)?.focus({preventScroll:true});
 }else if(focusedRead!==undefined){$('events').tabIndex=-1;$('events').focus({preventScroll:true});}
}
const titles={overview:'Хүлэмж минь',control:'Удирдлага',history:'Хэмжилтийн түүх',alerts:'Мэдэгдэл',settings:'Тохиргоо'};
function navigate(){
 const id=location.hash.slice(1), view=Object.hasOwn(titles,id)?id:'overview';
 for(const section of document.querySelectorAll('.view'))section.hidden=section.id!==view;
 for(const link of document.querySelectorAll('[data-view]'))link.dataset.view===view?link.setAttribute('aria-current','page'):link.removeAttribute('aria-current');
 $('breadcrumb').textContent=titles[view];
 window.scrollTo(0,0);
}
function updateClock(){
 if(liveMode){$('clock').textContent=dateTime(Date.now());const timer=$('pump-timer');if(timer)timer.textContent='Услах хугацаа, хамгаалалтыг төхөөрөмж өөрөө хянана.';return}
 $('clock').textContent=dateTime(Date.now());
 const pump=$('pump-timer'),d=state.devices.pump,now=Date.now();
 if(pump)pump.textContent=d.on?'Унтрах хүртэл '+Math.max(0,Math.ceil((d.stopAt-now)/1000))+' сек':now<d.readyAt?'Дахин услах хүртэл '+Math.ceil((d.readyAt-now)/1000)+' сек':'';
}
function fillSettings(){for(const [name,value] of Object.entries(state.settings))$('settings-form').elements.namedItem(name).value=value}
updateHTML($('metric-select'), Object.entries(metrics).map(([id,[label]])=>'<option value="'+id+'">'+label+'</option>').join(''));
updateHTML($('scenarios'), Object.entries(scenarios).map(([id,[label]])=>'<button type="button" data-scenario="'+id+'">'+label+'</button>').join(''));
document.addEventListener('click',e=>{
 const button=e.target.closest('button');
 if(!button)return;
 if(button.dataset.metric){$('metric-select').value=button.dataset.metric;renderHistory();location.hash='history';}
 if(button.dataset.device)command(button.dataset.device,button.dataset.action);
 if(button.dataset.scenario)scenario(button.dataset.scenario);
 if(button.dataset.read!==undefined){state.events[Number(button.dataset.read)].read=true;save();render()}
});
$('read-all').addEventListener('click',()=>{for(const e of state.events)e.read=true;save();render()});
$('range').addEventListener('change',renderHistory);$('metric-select').addEventListener('change',renderHistory);
$('export').addEventListener('click',()=>{
 const rows=historyRows();
 if(!rows.length){toast('Одоохондоо татах хэмжилт алга.');return}
 const csv=['Timestamp,Temperature_C,Humidity_pct,Soil_pct,Light_lux,Water_pct',...rows.map(r=>[new Date(r.at).toISOString(),...Object.keys(metrics).map(id=>r[id]===null?'':r[id].toFixed(2))].join(','))].join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='greenhouse-demo.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('settings-form').addEventListener('submit',e=>{
 e.preventDefault();
 const values=Object.fromEntries(new FormData(e.target));
 if(values.lightStart===values.lightEnd){toast('Асах, унтрах цаг ижил байна. Аль нэгийг нь өөрчлөөрэй.');return}
 if(liveMode){void saveLiveSettings({...values,hot:Number(values.hot),dry:Number(values.dry),waterMin:Number(values.waterMin)});return}
 settingsDirty=false;
 $('settings-status').textContent='Хадгалчихлаа ✓';
 state.settings={...values,hot:Number(values.hot),dry:Number(values.dry),waterMin:Number(values.waterMin)};
 event('Автомат горимын шинэ тохиргоог хадгаллаа.');checkAlerts();applyRules();save();render();toast('Боллоо, тохиргоог хадгаллаа ✓');
});
$('reset').addEventListener('click',()=>{
 if(liveMode)return;
 if(!window.confirm('Демог эхнээс нь эхлүүлэх үү? Одоогийн демо тохиргоо, хэмжилт, үйлдлийн түүх анхны төлөвт орно.'))return;
 state=initial();$('settings-status').textContent='';save();fillSettings();render();toast('Шинэ эхлэл! Демог эхнээс нь бэлдлээ 🌱');
});
$('settings-form').addEventListener('input',()=>{settingsDirty=true;$('settings-status').textContent='Өөрчлөлтөө хадгалахаа мартав аа.'});
window.addEventListener('hashchange',navigate);
fillSettings();if(applyRules())save();render();navigate();
let displayPending=false;
setInterval(()=>{
 if(applyRules()){save();displayPending=true}
 if(document.hidden)return;
 if(displayPending){render();displayPending=false}else updateClock();
},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){applyRules();save();render();displayPending=false}});
