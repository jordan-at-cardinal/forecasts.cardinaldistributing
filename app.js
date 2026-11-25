'use strict';
const $=id=>document.getElementById(id);
const fmt=new Intl.NumberFormat('en-US',{maximumFractionDigits:1});
const num=n=>n==null?'—':fmt.format(Math.max(0,Number(n)||0));
const round=n=>Number.isInteger(Number(n))?fmt.format(Number(n)):num(n);
const htmlesc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortDate=s=>s?new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—';
const longDate=s=>s?new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
const state={overview:null,supplier:null,data:null,selectedProduct:null,detail:null,requestSerial:0,productSerial:0,initialized:false,currentView:'forecast',slowResponse:null,slowSerial:0};
let toastTimer=null;
const bridge=()=>window.pywebview?.api||window.__cardinalMockApi;
const opts=()=>({status:$('status-filter').value,safety:Number($('safety').value||15)});
function toast(message,error=false){const el=$('toast');el.textContent=message;el.classList.toggle('error',!!error);el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,4600)}
function setBusy(busy){for(const id of ['refresh','nav-inventory','nav-sales','export','save-lead'])$(id).disabled=busy;}
async function invoke(name,...args){const api=bridge();if(!api||typeof api[name]!=='function')throw new Error('Cloud connection unavailable. Sign in or check the setup.');return api[name](...args)}
async function refresh(preferred,force=false){setBusy(true);$('footer-status').textContent='Refreshing forecasts…';try{const data=await invoke('get_overview',force);state.overview=data;renderSuppliers();fillSlowSuppliers();$('today-label').textContent=longDate(data.today);$('horizon-label').textContent=`Current week of ${shortDate(data.week_start)} + 4 full weeks through ${longDate(data.horizon_end)}`;const report=data.last_sales_import?`Sales updated ${new Date(data.last_sales_import).toLocaleDateString('en-US')}`:'No sales report yet';$('report-updated').textContent=report;const next=(data.suppliers.some(s=>s.name===(preferred||state.supplier)))?(preferred||state.supplier):(data.suppliers[0]?.name||null);if(next)await chooseSupplier(next);else renderEmpty();$('footer-status').textContent=data.legacy_sales_count?`${data.legacy_sales_count} legacy sales rows need reimport using Units Sold`:`${data.suppliers.length} suppliers · Physical cases / individual kegs · Cloud synced`;if(data.legacy_sales_count)toast('Reimport your sales Excel report to replace older case-equivalent records.',true);if(state.currentView==='slow')loadSlow()}catch(err){toast('Unable to load data: '+err.message,true);$('footer-status').textContent=err.message}finally{setBusy(false)}}
function resizeSupplierPane(){if(!state.overview)return;const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d');ctx.font='600 11px Segoe UI, Arial';const textPx=Math.max(118,...state.overview.suppliers.map(s=>ctx.measureText(s.name).width+17));const total=textPx+75+48+72+32;const workspace=$('dashboard-columns').clientWidth;const cap=Math.max(305,Math.min(418,Math.round(workspace*.285)));$('dashboard-columns').style.setProperty('--supplier-width',`${Math.ceil(Math.min(Math.max(322,total),cap))}px`)}
function renderSuppliers(){const list=$('supplier-list');list.innerHTML='';const data=state.overview?.suppliers||[];if(!data.length){list.innerHTML='<div class="loading-text">No eligible inventory yet. Import an inventory CSV, then the sales Excel report.</div>';return}const frag=document.createDocumentFragment();for(const s of data){const btn=document.createElement('button');btn.type='button';btn.className='supplier-row'+(s.name===state.supplier?' active':'');btn.title=`${s.name} · ${s.risk} risk · red demand ${num(s.red_share)}%`;const date=s.order_by?`${s.tentative?'Plan ':''}${shortDate(s.order_by)}`:'—';btn.innerHTML=`<span class="supplier-name" title="${htmlesc(s.name)}">${htmlesc(s.name)}</span><span class="num">${s.sold12==null?'—':num(s.sold12)}</span><span class="risk-cell" title="${htmlesc(s.risk)}"><i class="risk-dot ${htmlesc(s.risk_band)}"></i></span><span class="order-date">${htmlesc(date)}</span>`;btn.addEventListener('click',()=>chooseSupplier(s.name));frag.append(btn)}list.append(frag);resizeSupplierPane()}
async function chooseSupplier(name){state.supplier=name;state.selectedProduct=null;state.detail=null;renderSuppliers();const serial=++state.requestSerial;$('product-body').innerHTML='<tr><td colspan="15" class="empty-cell">Calculating supplier forecasts…</td></tr>';$('product-search').value='';try{const data=await invoke('get_supplier',name,opts().status,opts().safety);if(serial!==state.requestSerial)return;state.data=data;renderSupplierData();if(data.products.length)await selectProduct(data.products[0].id);else clearChart()}catch(err){if(serial!==state.requestSerial)return;toast(`Supplier ${name}: ${err.message}`,true);state.data=null;renderEmpty()}}
function renderSupplierData(){const data=state.data;if(!data)return;const s=data.supplier;$('stat-supplier').textContent=s.name;$('stat-skus').textContent=`${data.products.length} forecasted products`;$('stat-demand').textContent=num(data.total_demand);$('stat-order').textContent=fmt.format(data.total_orders);$('stat-risk').innerHTML=`<span class="pill ${htmlesc(s.risk_band)}">${htmlesc(s.risk)}</span>`;$('stat-risk-detail').textContent=`${s.low} low · ${s.high} excess · ${num(s.red_share)}% red demand`;$('lead-days').value=s.lead_days==null?'':String(s.lead_days);renderProducts();const timing=s.timing;let msg;if(!timing.trigger)msg='No consolidated 40%-of-case trigger identified within the four-week horizon. Review individual critical products.';else if(timing.configured)msg=`Recommended order by ${longDate(timing.order_by)} · ${timing.count} active items / ${num(timing.share)}% of supplier demand approaching the 21-day target.${timing.late?' Lead-time window may already have passed.':''}`;else msg=`Planning trigger ${longDate(timing.trigger)} · ${timing.count} active items / ${num(timing.share)}% of supplier demand. Enter supplier lead days for an order-by date.`;if(timing.urgent)msg+=` ${timing.urgent} critical SKU(s) require individual review.`;if(timing.unknown_etas)msg+=` ${timing.unknown_etas} inbound ETA(s) not verified.`;$('order-insight').textContent=msg}
function renderProducts(){const body=$('product-body');const query=$('product-search').value.trim().toLowerCase();const visible=(state.data?.products||[]).filter(p=>`${p.name} ${p.id}`.toLowerCase().includes(query));$('product-count').textContent=`${visible.length} products`;if(!visible.length){body.innerHTML='<tr><td colspan="15" class="empty-cell">No eligible products match the selected filters.</td></tr>';return}const frag=document.createDocumentFragment();for(const p of visible){const tr=document.createElement('tr');tr.className=p.id===state.selectedProduct?'active':'';tr.dataset.pid=p.id;tr.title=`${p.name} · ${p.status} · ${p.id}`;const pill=`<span class="pill ${htmlesc(p.health_band)}">${htmlesc(p.health)}</span>`;tr.innerHTML=`<td class="name-column" title="${htmlesc(p.name)}">${htmlesc(p.name)}</td><td>${num(p.available)}</td><td>${num(p.incoming)}</td><td class="num-strong">${num(p.order)}</td><td>${htmlesc(p.status==='SPECIAL ORDER'?'Special order':p.status==='SEASONAL'?'Seasonal':'Active')}</td><td>${p.doh===null?'—':num(p.doh)}</td><td>${pill}</td><td>${num(p.sold12)}</td>${p.weeks.map(n=>`<td>${num(n)}</td>`).join('')}<td class="num-strong">${num(p.month)}</td><td class="num-strong">${num(p.forecast)}</td>`;tr.addEventListener('click',()=>selectProduct(p.id));frag.append(tr)}body.replaceChildren(frag);$('product-foot').textContent=`Sorted by cases and individual kegs sold over the last 12 weeks · ${state.data.report_through?'Sales through '+longDate(state.data.report_through):'No sales coverage date'}`}
async function selectProduct(productId){if(!state.data)return;state.selectedProduct=productId;for(const tr of $('product-body').rows)tr.classList.toggle('active',tr.dataset.pid===productId);const serial=++state.productSerial;const p=state.data.products.find(x=>x.id===productId);$('trend-product').textContent=p?.name||'Loading…';$('trend-meta').textContent='Calculating individual forecast…';try{const detail=await invoke('get_product',state.supplier,productId,opts().status,opts().safety);if(serial!==state.productSerial)return;state.detail=detail;$('trend-meta').textContent=`${detail.status} · ${detail.days_on_hand==null?'Unknown':num(detail.days_on_hand)} days on hand (target 21) · ${detail.health} · Available ${num(detail.available)} · Incoming ${num(detail.incoming)}`;$('product-quantities').textContent=`Suggested order: ${num(detail.order)} · Demand: ${num(detail.forecast)}`;$('trend-footnote').textContent=`Current-week actual sold: ${num(detail.this_week_actual)} · All quantities are physical cases or kegs`;renderChart();renderInventory()}catch(err){if(serial!==state.productSerial)return;state.detail=null;$('trend-meta').textContent='Chart unavailable: '+err.message;clearChart()}}
function clearChart(){state.detail=null;$('trend-product').textContent='Select a product';$('trend-meta').textContent='Compare historical sales with the current forecast.';$('trend-svg').replaceChildren();$('trend-footnote').textContent='Select a product in the table to see its model.';$('product-quantities').textContent='';clearInventory()}
function renderEmpty(){state.data=null;state.supplier=null;state.selectedProduct=null;$('stat-supplier').textContent='—';$('stat-skus').textContent='Import inventory to begin';$('stat-demand').textContent='—';$('stat-order').textContent='—';$('stat-risk').textContent='—';$('stat-risk-detail').textContent='Target: 21 selling days';$('product-body').innerHTML='<tr><td colspan="15" class="empty-cell">Import an inventory CSV and a weekly sales XLSX to begin forecasting.</td></tr>';$('product-count').textContent='0 products';$('order-insight').textContent='Select a supplier to see its ordering window.';clearChart()}
const chartColors={prior2:'#8b98b0',prior:'#d98f3e',current:'#367cbb',forecast:'#188764'};
const labels={prior2:'Two years ago',prior:'Last year',current:'Current actual',forecast:'Projected'};
function renderChart(){const svg=$('trend-svg');svg.replaceChildren();const d=state.detail;if(!d)return;const W=980,H=255,left=53,right=11,top=14,bottom=39,plotW=W-left-right,plotH=H-top-bottom;const count=d.dates.length;const spacing=plotW/count;const enabled=[...document.querySelectorAll('input[data-series]:checked')].map(x=>x.dataset.series);const nums=enabled.flatMap(key=>(d.series[key]||[]).filter(x=>x!==null));const ceiling=Math.max(1,...nums)*1.12;const y=v=>top+plotH-(v/ceiling)*plotH;const ns='http://www.w3.org/2000/svg';const el=(tag,attrs,text)=>{const node=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs||{}))node.setAttribute(k,String(v));if(text!==undefined)node.textContent=text;svg.appendChild(node);return node};for(let j=0;j<=4;j++){const n=ceiling*j/4;const yy=y(n);el('line',{x1:left,y1:yy,x2:W-right,y2:yy,stroke:'#e5eaf1','stroke-width':1});el('text',{x:left-8,y:yy+4,'text-anchor':'end',fill:'#718095','font-size':11},num(n))}el('text',{x:9,y:13,fill:'#718095','font-size':11},'Units');for(let i=0;i<count;i++){if(i%2===0||i===count-1)el('text',{x:left+i*spacing+spacing/2,y:H-14,'text-anchor':'middle',fill:'#6d7c90','font-size':10},shortDate(d.dates[i]))}const currentWeek=state.overview?.week_start;const currentIdx=d.dates.indexOf(currentWeek);if(currentIdx>=0){const x=left+currentIdx*spacing;el('line',{x1:x,y1:top,x2:x,y2:H-bottom,stroke:'#aab5c2','stroke-dasharray':'3 5'});el('text',{x:x+5,y:top+9,fill:'#6f8197','font-size':10},'Now')}
  for(const key of enabled){const vals=d.series[key]||[];let path='';let previous=null;for(let i=0;i<vals.length;i++){const v=vals[i];if(v===null){previous=null;continue}const x=left+i*spacing,xend=x+spacing,yy=y(v);if(previous!==null)path+=` L${x.toFixed(1)} ${y(previous).toFixed(1)} L${x.toFixed(1)} ${yy.toFixed(1)}`;else path+=` M${x.toFixed(1)} ${yy.toFixed(1)}`;path+=` L${xend.toFixed(1)} ${yy.toFixed(1)}`;previous=v}if(path)el('path',{d:path,fill:'none',stroke:chartColors[key],'stroke-width':key==='forecast'?3:2.2,'stroke-linejoin':'round','stroke-linecap':'round',...(key==='forecast'?{'stroke-dasharray':'8 5'}:{})})}
  for(let i=0;i<count;i++){const rect=el('rect',{x:left+i*spacing,y:top,width:spacing,height:plotH,fill:'transparent','data-week':i});rect.addEventListener('pointermove',ev=>showChartTip(ev,i));rect.addEventListener('pointerleave',()=>{$('chart-tooltip').hidden=true})}
  const missing=['prior2','prior','current'].filter(key=>!d.series[key].some(v=>v!==null)).map(key=>key==='prior2'?'Two years ago (2024 data not imported)':labels[key]);if(missing.length)$('trend-footnote').textContent=`Current-week actual sold: ${num(d.this_week_actual)} · History unavailable: ${missing.join(', ')}`;
}
function showChartTip(event,i){const d=state.detail;if(!d)return;const tip=$('chart-tooltip');const lines=[`<b>Week of ${htmlesc(longDate(d.dates[i]))}</b>`];for(const key of ['prior2','prior','current','forecast']){const enabled=document.querySelector(`input[data-series="${key}"]`);if(enabled?.checked&&d.series[key][i]!==null)lines.push(`<span style="color:${chartColors[key]}">●</span> ${labels[key]}: ${num(d.series[key][i])}`)}if(lines.length===1)lines.push('Outside reported sales history');tip.innerHTML=lines.join('<br>');tip.hidden=false;const bounds=$('chart-container').getBoundingClientRect();const x=Math.min(bounds.width-175,Math.max(5,event.clientX-bounds.left+15));const y=Math.min(bounds.height-100,Math.max(5,event.clientY-bounds.top-55));tip.style.left=x+'px';tip.style.top=y+'px'}

function clearInventory(){
  $('inventory-svg').replaceChildren();
  $('inventory-headline').textContent='Select a product';
  $('inventory-note').textContent='Choose a product to see forecast sales and incoming shipments.';
  $('inventory-unconfirmed').textContent='';
  $('inventory-tooltip').hidden=true;
}
function renderInventory(){
  const svg=$('inventory-svg');svg.replaceChildren();const d=state.detail?.inventory_projection;
  if(!d||!d.dates?.length){clearInventory();return}
  const W=980,H=245,left=59,right=13,top=18,bottom=36,pw=W-left-right,ph=H-top-bottom;
  const vals=[...d.with_inbound,...d.without_inbound];
  const ymax=Math.max(1,...vals.map(x=>Math.max(0,x)))*1.16;
  const step=pw/Math.max(1,d.dates.length-1);
  const yy=v=>top+ph*(1-Math.max(0,v)/ymax),xx=i=>left+step*i;
  const ns='http://www.w3.org/2000/svg';
  const node=(tag,attrs,text,parent=svg)=>{const el=document.createElementNS(ns,tag);Object.entries(attrs||{}).forEach(([k,v])=>el.setAttribute(k,String(v)));if(text!==undefined)el.textContent=text;parent.appendChild(el);return el};
  for(let j=0;j<=4;j++){
    const val=ymax*j/4,y=yy(val);
    node('line',{x1:left,y1:y,x2:W-right,y2:y,stroke:'#e8edf3','stroke-width':1});
    node('text',{x:left-8,y:y+4,'text-anchor':'end',fill:'#718095','font-size':11},num(val));
  }
  node('text',{x:9,y:13,fill:'#718095','font-size':11},'Units');
  const zeroY=yy(0);
  node('line',{x1:left,y1:zeroY,x2:W-right,y2:zeroY,stroke:'#c86565','stroke-dasharray':'4 5','stroke-width':1.4});
  const every=Math.max(1,Math.ceil(d.dates.length/7));
  for(let i=0;i<d.dates.length;i++){
    if(i%every===0||i===d.dates.length-1)node('text',{x:xx(i),y:H-12,'text-anchor':'middle',fill:'#6d7c90','font-size':10},shortDate(d.dates[i]));
  }
  for(const receipt of d.scheduled_receipts||[]){
    const i=d.dates.indexOf(receipt.date);if(i<0)continue;
    node('line',{x1:xx(i),y1:top,x2:xx(i),y2:zeroY,stroke:'#a58b56','stroke-dasharray':'4 4','stroke-width':1.5});
    const g=node('g',{});
    node('rect',{x:Math.max(left,Math.min(W-117,xx(i)-55)),y:top+1,width:112,height:17,rx:4,fill:'#fff4db'},undefined,g);
    node('text',{x:Math.max(left,Math.min(W-117,xx(i)-55))+56,y:top+13,'text-anchor':'middle',fill:'#7d5b22','font-size':10},`+${num(receipt.quantity)} on ${shortDate(receipt.date)}`,g);
  }
  const line=(arr,color,dashed=false)=>{
    const path=arr.map((v,i)=>`${i?'L':'M'}${xx(i).toFixed(2)},${yy(v).toFixed(2)}`).join(' ');
    node('path',{d:path,fill:'none',stroke:color,'stroke-width':dashed?2:3,'stroke-linecap':'round','stroke-linejoin':'round',...(dashed?{'stroke-dasharray':'6 5'}:{})});
  };
  line(d.without_inbound,'#be6070',true);
  line(d.with_inbound,'#15815e');
  const tip=$('inventory-tooltip'),wrapper=$('inventory-chart-container');
  for(let i=0;i<d.dates.length;i++){
    const r=node('rect',{x:Math.max(left,xx(i)-step/2),y:top,width:Math.max(4,step),height:ph,fill:'transparent'});
    r.addEventListener('pointermove',ev=>{
      const arrival=(d.daily_receipts[i]||0)>0?`<br><b>Arriving: +${num(d.daily_receipts[i])}</b>`:'';
      tip.innerHTML=`<b>${htmlesc(longDate(d.dates[i]))}</b><br>Projected on hand: ${num(d.with_inbound[i])}<br>No inbound: ${num(d.without_inbound[i])}<br>Forecast sold: ${num(d.daily_sales[i])}${arrival}`;
      tip.hidden=false;const b=wrapper.getBoundingClientRect();
      tip.style.left=Math.max(4,Math.min(b.width-200,ev.clientX-b.left+10))+'px';
      tip.style.top=Math.max(4,Math.min(b.height-115,ev.clientY-b.top-85))+'px';
    });
    r.addEventListener('pointerleave',()=>{tip.hidden=true});
  }
  $('inventory-headline').textContent=`${num(d.starting_available)} available → ${num(d.end_balance)} projected`;
  const arrivals=(d.scheduled_receipts||[]).map(r=>`${num(r.quantity)} ${shortDate(r.date)}`).join(', ');
  const stale=d.snapshot_age_days>2?` · Snapshot ${d.snapshot_age_days} days old` : '';
  $('inventory-note').textContent=`Green: with dated shipment · Red dashed: without inbound · Forecast shortfall: ${num(d.projected_shortfall)} units${stale}${arrivals?' · Dated inbound: '+arrivals:''}`;
  $('inventory-unconfirmed').textContent=d.unconfirmed_inbound>0?`${num(d.unconfirmed_inbound)} on-order units not credited (unknown ETA / quantity or outside horizon)`:'No undated inbound';
}
function setView(view){
  state.currentView=view==='slow'?'slow':'forecast';
  $('forecast-view').hidden=state.currentView!=='forecast';
  $('slow-view').hidden=state.currentView!=='slow';
  $('nav-forecast').classList.toggle('selected',state.currentView==='forecast');
  $('nav-slow').classList.toggle('selected',state.currentView==='slow');
  $('page-title').textContent=state.currentView==='slow'?'Slow-moving products':'Forecast dashboard';
  if(state.currentView==='slow'){
    $('horizon-label').textContent='Lowest-selling inventory · 12 complete weeks';
    loadSlow();
  } else if(state.overview){
    $('horizon-label').textContent=`Current week of ${shortDate(state.overview.week_start)} + 4 full weeks through ${longDate(state.overview.horizon_end)}`;
    resizeSupplierPane();
  }
}
async function loadSlow(){
  const serial=++state.slowSerial;
  $('slow-body').innerHTML='<tr><td colspan="9" class="empty-cell">Finding the slowest-moving products…</td></tr>';
  try{
    const res=await invoke('get_slow_movers',$('slow-supplier').value,$('slow-status').value,$('slow-mode').value,$('slow-in-stock').checked);
    if(serial!==state.slowSerial)return;
    state.slowResponse=res;
    $('slow-eligible').textContent=num(res.eligible);
    $('slow-zero').textContent=num(res.all_zero);
    $('slow-under-one').textContent=num(res.all_monthly_one);
    $('slow-excluded').textContent=num(res.excluded_no_coverage);
    $('slow-summary').textContent=`${res.products.length} flagged · ${shortDate(res.window_start)}–${shortDate(res.window_end)}`;
    renderSlowRows();
  } catch(err){
    if(serial!==state.slowSerial)return;
    $('slow-body').innerHTML=`<tr><td colspan="9" class="empty-cell">${htmlesc(err.message)}</td></tr>`;
  }
}
function renderSlowRows(){
  const body=$('slow-body'),data=state.slowResponse;
  if(!data)return;
  const q=$('slow-search').value.trim().toLowerCase();
  const items=(data.products||[]).filter(p=>`${p.name} ${p.supplier} ${p.id}`.toLowerCase().includes(q));
  body.replaceChildren();
  if(!items.length){body.innerHTML='<tr><td class="empty-cell" colspan="9">No matching products. Choose another supplier or slow-moving category.</td></tr>';return}
  const frag=document.createDocumentFragment();
  for(const p of items){
    const tr=document.createElement('tr');
    tr.className=p.idle_days>=90?'slow-critical':'';
    tr.innerHTML=`<td class="slow-product" title="${htmlesc(p.name)}">${htmlesc(p.name)}</td><td>${htmlesc(p.supplier)}</td><td>${htmlesc(p.status)}</td><td>${num(p.sold12)}</td><td>${num(p.monthly)}</td><td>${num(p.available)}</td><td>${htmlesc(longDate(p.last_sale))}</td><td>${p.idle_days==null?'Unknown':num(p.idle_days)}</td><td>${htmlesc(p.category)}</td>`;
    frag.append(tr);
  }
  body.append(frag);
}
function fillSlowSuppliers(){
  const sel=$('slow-supplier'),old=sel.value;sel.innerHTML='<option value="">All suppliers</option>';
  for(const s of state.overview?.suppliers||[]){const o=document.createElement('option');o.value=s.name;o.textContent=s.name;sel.append(o)}
  sel.value=[...sel.options].some(x=>x.value===old)?old:'';
}

async function importFile(kind){setBusy(true);try{const out=await invoke('import_file',kind);if(!out.cancelled){toast(out.message);await refresh(state.supplier)}}catch(err){toast('Import error: '+err.message,true)}finally{setBusy(false)}}
async function saveLead(){if(!state.supplier)return toast('Select a supplier first.',true);setBusy(true);try{await invoke('save_lead',state.supplier,$('lead-days').value);toast('Lead days saved.');await refresh(state.supplier)}catch(err){toast('Lead days: '+err.message,true)}finally{setBusy(false)}}
async function exportSupplier(){if(!state.supplier)return toast('Select a supplier first.',true);try{const out=await invoke('export_supplier',state.supplier,opts().status,opts().safety);if(!out.cancelled)toast(out.message||'Export complete')}catch(err){toast('Export error: '+err.message,true)}}
async function showHistory(){const modal=$('history-modal');modal.hidden=false;$('history-content').innerHTML='Loading import history…';try{const result=await invoke('get_history');const rows=result.audits||[];let html=`<p style="font-size:11px;color:#66768a">Database: ${htmlesc(result.database)}</p>`;if(!rows.length)html+='<p>No imports yet.</p>';else html+='<table><thead><tr><th>When</th><th>Type</th><th>Supplier</th><th>Products</th><th>File</th></tr></thead><tbody>'+rows.map(a=>`<tr><td>${htmlesc(a.loaded_at?.slice(0,16).replace('T',' '))}</td><td>${htmlesc(a.kind)}</td><td>${htmlesc(a.supplier)}</td><td>${num(a.products)}</td><td>${htmlesc(a.filename)}</td></tr>`).join('')+'</tbody></table>';$('history-content').innerHTML=html}catch(err){$('history-content').textContent=err.message}}
function installInfo(){
  const pop=$('help-popover');let active=null;
  function place(btn){
    const r=btn.getBoundingClientRect();
    pop.textContent=btn.dataset.help||'';pop.hidden=false;
    const box=pop.getBoundingClientRect();
    const x=Math.min(window.innerWidth-box.width-12,Math.max(12,r.left));
    const y=r.bottom+box.height+10<window.innerHeight?r.bottom+9:Math.max(12,r.top-box.height-9);
    pop.style.left=x+'px';pop.style.top=y+'px';
  }
  document.addEventListener('pointerover',e=>{const btn=e.target.closest('[data-help]');if(btn){active=btn;place(btn)}});
  document.addEventListener('pointerout',e=>{const btn=e.target.closest('[data-help]');if(btn&&btn===active&&!e.relatedTarget?.closest?.('#help-popover')){pop.hidden=true;active=null}});
  document.addEventListener('click',e=>{const btn=e.target.closest('[data-help]');if(btn){e.preventDefault();e.stopPropagation();if(active===btn&&!pop.hidden){pop.hidden=true;active=null}else{active=btn;place(btn)}}else if(!e.target.closest('#help-popover')){pop.hidden=true;active=null}});
  window.addEventListener('scroll',()=>{pop.hidden=true;active=null},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('history-modal').hidden=true;pop.hidden=true;active=null}});
}
function wire(){if(state.initialized)return;state.initialized=true;$('refresh').addEventListener('click',()=>state.currentView==='slow'?loadSlow():refresh(state.supplier,true));$('nav-forecast').addEventListener('click',()=>setView('forecast'));$('nav-slow').addEventListener('click',()=>setView('slow'));['slow-supplier','slow-status','slow-mode','slow-in-stock'].forEach(id=>$(id).addEventListener('change',loadSlow));$('slow-search').addEventListener('input',renderSlowRows);$('nav-inventory').addEventListener('click',()=>importFile('inventory'));$('nav-sales').addEventListener('click',()=>importFile('sales'));$('nav-history').addEventListener('click',showHistory);$('modal-close').addEventListener('click',()=>{$('history-modal').hidden=true});$('history-modal').addEventListener('click',e=>{if(e.target===$('history-modal'))e.currentTarget.hidden=true});$('save-lead').addEventListener('click',saveLead);$('export').addEventListener('click',exportSupplier);$('status-filter').addEventListener('change',()=>state.supplier&&chooseSupplier(state.supplier));$('safety').addEventListener('change',()=>state.supplier&&chooseSupplier(state.supplier));$('product-search').addEventListener('input',renderProducts);document.querySelectorAll('input[data-series]').forEach(el=>el.addEventListener('change',renderChart));window.addEventListener('resize',resizeSupplierPane);installInfo();refresh()}
window.addEventListener('pywebviewready',wire);
window.addEventListener('DOMContentLoaded',()=>{if(window.__cardinalMockApi)wire();else setTimeout(()=>{if(!state.initialized&&!bridge())$('footer-status').textContent='Sign in to load your synchronized forecast data.'},2000)});
