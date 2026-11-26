/* ---------------- 狀態 ---------------- */
const {round2,parseMoney,uid,monthKeys,futureMonths,hitsMonth,nextDueDate,sigDB,mergeDB,removeItem,restoreTombstones,sanitizeDB}=window.Logic;
const dateOk=s=>/^\d{4}-\d{2}-\d{2}$/.test(s);
const DEFAULT_CATS = {
  income:["薪資","獎金","投資收益","副業","其他收入"],
  expense:["飲食","居住","交通","娛樂","購物","醫療","教育","保險","其他支出"]
};

function blankDB(){return{tx:[],budget:{},assets:[],invest:[],future:[],cats:{income:[...DEFAULT_CATS.income],expense:[...DEFAULT_CATS.expense]}};}
let DB = blankDB(); // 先給空資料，實際內容由 Google Sheet 載入（見底部 boot）

/* ---------------- 儲存與同步 ----------------
   本機優先：每次變動先寫 localStorage（離線可用），
   再防抖動後 POST 到 Apps Script 網頁應用程式，寫進 Google Sheet。 */
const LS_DB="finbook_db_v1", LS_CFG="finbook_cfg_v1", LS_DIRTY="finbook_dirty";
const LS_KEYS="finbook_key_session";
// 後端網址由部署流程產生的 config.js 提供（只有網址；通行碼一律由使用者輸入）
const DEFAULT_URL=(window.APP_CONFIG&&window.APP_CONFIG.API_URL)||"";
// 通行碼可選擇只存在這次瀏覽（sessionStorage），不留在 localStorage
function loadCfg(){
  let c={};
  try{c=JSON.parse(localStorage.getItem(LS_CFG))||{};}catch(e){}
  try{const k=sessionStorage.getItem(LS_KEYS);if(k)c={...c,key:k};}catch(e){}
  if(!c.url&&DEFAULT_URL)c.url=DEFAULT_URL;
  return c;
}
let CFG=loadCfg();
const cloudOn=()=>!!(CFG.url&&CFG.key);
function saveLocal(){try{localStorage.setItem(LS_DB,JSON.stringify(DB));}catch(e){}}
function applyDB(d){
  DB={...blankDB(),...sanitizeDB(d,todayStr())};
  if(!DB.cats||!DB.cats.income||!DB.cats.expense)DB.cats={income:[...DEFAULT_CATS.income],expense:[...DEFAULT_CATS.expense]};
}

let saveTimer=null, saving=false, pending=false;
function save(){
  undoSnap=null;undoFn=null;
  DB.updatedAt=Date.now();
  saveLocal();
  try{localStorage.setItem(LS_DIRTY,"1");}catch(e){}
  clearTimeout(saveTimer);
  if(!cloudOn()){setSync("","已存在本機（未連接雲端）");return;}
  setSync("","儲存中…");
  saveTimer=setTimeout(doSave,800);
}
// 呼叫 Apps Script：用 text/plain 送 JSON，屬於「簡單請求」，不會觸發 CORS 預檢
let SERVER_V2=false;   // 後端是否支援「基準版本」寫入（新版 Code.gs）
let REMOTE_AT;         // 雲端目前已知的 updatedAt；undefined=尚未取得
async function api(body,cfg=CFG){
  const r=await fetch(cfg.url,{method:"POST",redirect:"follow",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({...body,key:cfg.key})});
  let j;
  try{j=await r.json();}catch(e){throw new Error("回應格式錯誤，請確認網址是 /exec 結尾，且存取權設為「所有人」");}
  if(j.v>=2)SERVER_V2=true;
  if(!j.ok&&!j.conflict)throw new Error(j.error||"未知錯誤");
  return j;
}
// 把雲端的變更合併進本機（依 id 聯集，不覆蓋、不遺失）
// 合併後內容已和任何一邊都不同，更新時間戳，其他裝置才能偵測到變動
function adoptMerged(m){applyDB(m);DB.updatedAt=Date.now();saveLocal();fillCats();fillFtCats();renderAll();}
async function doSave(){
  if(!cloudOn())return;
  if(saving){pending=true;return;}
  if(!navigator.onLine){setSync("err","離線中：已存本機，連線後自動同步");return;}
  saving=true;
  try{
    if(SERVER_V2&&REMOTE_AT!==undefined){
      // 新版後端：帶著「我看到的雲端版本」直接上傳，沒人改過就只要 1 次請求；有衝突時後端回傳最新資料，合併後重試
      let done=false;
      for(let i=0;i<4&&!done;i++){
        const sent=DB.updatedAt;
        const j=await api({action:"save",data:DB,baseAt:REMOTE_AT});
        if(j.conflict){
          REMOTE_AT=(j.data&&j.data.updatedAt)||0;
          adoptMerged(mergeDB(DB,sanitizeDB(j.data,todayStr())));
          continue;
        }
        REMOTE_AT=sent;done=true;
      }
      if(!done)throw new Error("conflict");
    }else{
      // 舊版後端：先取雲端最新並合併再上傳
      const g=await api({action:"get"});
      if(g.data&&g.data.tx!==undefined){
        const m=mergeDB(DB,sanitizeDB(g.data,todayStr()));
        if(sigDB(m)!==sigDB(DB))adoptMerged(m);
      }
      const sent=DB.updatedAt;
      await api({action:"save",data:DB});
      REMOTE_AT=sent;
    }
    localStorage.removeItem(LS_DIRTY);
    setSync("on","已同步至雲端");
  }catch(e){
    setSync("err","同步失敗，稍後重試");
    clearTimeout(saveTimer);saveTimer=setTimeout(doSave,8000);
  }finally{
    saving=false;
    if(pending){pending=false;doSave();}
  }
}
// 從雲端拉資料並與本機合併
async function pull(){
  if(!cloudOn()||saving)return;
  setSync("","從雲端載入中…");
  try{
    const remote=(await api({action:"get"})).data;
    REMOTE_AT=(remote&&remote.updatedAt)||0;
    if(!(remote&&remote.tx!==undefined)){await doSave();return;}
    const m=mergeDB(DB,sanitizeDB(remote,todayStr()));
    if(sigDB(m)!==sigDB(DB))adoptMerged(m);
    if(localStorage.getItem(LS_DIRTY)||sigDB(m)!==sigDB(remote))await doSave();
    else setSync("on","已同步至雲端");
  }catch(e){
    setSync("err","雲端連線失敗，暫用本機資料");
  }
}
window.addEventListener("online",()=>{localStorage.getItem(LS_DIRTY)?doSave():pull();});
window.addEventListener("offline",()=>setSync("err","離線中：資料先存本機"));
// 從背景切回 App 時重新拉一次（多裝置同步）
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"&&cloudOn()&&!localStorage.getItem(LS_DIRTY))pull();
});

let curType="income";
const $=id=>document.getElementById(id);
const UI_KEY="finbook_ui_v1";
let UI=(()=>{try{return JSON.parse(localStorage.getItem(UI_KEY))||{};}catch(e){return{};}})();
const fmt=n=>{n=Math.round(n);return (n<0?"−":"")+(UI.cur||"$")+Math.abs(n).toLocaleString("en-US");};
const ym=d=>d.slice(0,7);
// 用「本地時間」產生日期字串；toISOString() 是 UTC，台灣早上 8 點前會變成前一天
const pad2=n=>String(n).padStart(2,"0");
const ymdLocal=d=>`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const todayStr=()=>ymdLocal(new Date());
let thisMonth=todayStr().slice(0,7);

/* ---------------- 無障礙輔助 ---------------- */
// 使用者輸入進 innerHTML 前一律跳脫，避免破版與 XSS
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const reduceMotion=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;

// 非阻斷式通知（螢幕閱讀器會自動朗讀）
let toastTimer;
function toast(msg,isErr,action){
  const t=$("toast");
  t.setAttribute("aria-live",isErr?"assertive":"polite");
  t.className=isErr?"err":"";
  t.textContent="";
  setTimeout(()=>{
    t.textContent=msg;
    if(action){const b=document.createElement("button");b.type="button";b.textContent=action.label;b.onclick=()=>{t.textContent="";action.fn();};t.appendChild(b);}
  },30);
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{t.textContent="";},action?8000:isErr?6000:3500);
}
// 滑鼠停留或鍵盤聚焦在提示上時暫停自動消失（WCAG 2.2.1）
$("toast").addEventListener("focusin",()=>clearTimeout(toastTimer));
$("toast").addEventListener("mouseenter",()=>clearTimeout(toastTimer));

// 刪除改為「可復原」：比每次跳確認框更快，也不怕誤刪（Ctrl/⌘+Z 也可復原）
let undoSnap=null,undoFn=null;
function refreshForms(){fillCats();fillFtCats();if(modalState&&modalState.m.id==="catModal")renderChips();}
function offerUndo(snap,msg){
  const run=()=>{
    if(undoSnap!==snap){toast("無法復原：資料已有其他變更",true);return;}
    undoSnap=null;undoFn=null;
    // 復原後，凡是跟目前不同（含被刪掉的）項目都更新時間戳，才不會被其他裝置較新的版本／墓碑再蓋回去
    const prev={};Logic.KINDS.forEach(k=>{prev[k]=new Map((DB[k]||[]).map(x=>[String(x.id),JSON.stringify(x)]));});
    applyDB(JSON.parse(snap));
    const now=Date.now();
    Logic.KINDS.forEach(k=>DB[k].forEach(x=>{if(prev[k].get(String(x.id))!==JSON.stringify(x))x.u=now;}));
    save();refreshForms();renderAll();toast("已復原");
  };
  undoSnap=snap;undoFn=run;
  if(modalState){const i=modalState.m.querySelector("input");if(i)i.focus();}
  else{const v=document.querySelector(".view.active");if(v)v.focus({preventScroll:true});}
  toast(msg,false,{label:"復原",fn:run});
}
function withUndo(msg,mutate,after){
  const snap=JSON.stringify(DB);
  mutate();save();renderAll();
  if(after)after();
  offerUndo(snap,msg);
}
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&undoFn&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();undoFn();}
});

// 欄位層級錯誤：aria-invalid + aria-describedby + 聚焦
function clearErr(el){
  el.removeAttribute("aria-invalid");
  const m=document.getElementById(el.id+"-err");if(m)m.remove();
  const d=(el.getAttribute("aria-describedby")||"").split(" ").filter(x=>x&&x!==el.id+"-err").join(" ");
  d?el.setAttribute("aria-describedby",d):el.removeAttribute("aria-describedby");
}
function showErr(el,msg,anchor){
  clearErr(el);
  el.setAttribute("aria-invalid","true");
  const m=document.createElement("div");
  m.className="err-msg";m.id=el.id+"-err";m.setAttribute("role","alert");m.textContent=msg;
  (anchor||el).after(m);
  el.setAttribute("aria-describedby",((el.getAttribute("aria-describedby")||"")+" "+m.id).trim());
  el.focus();
  el.addEventListener("input",()=>clearErr(el),{once:true});
}

// 彈窗：焦點移入、Tab 迴圈、Esc 關閉、關閉後焦點還原、背景 inert
let modalState=null;
function openModal(id,focusId){
  refreshHints();
  const m=$(id);
  modalState={m,opener:document.activeElement};
  m.style.display="flex";
  document.querySelector(".wrap").inert=true;
  const f=focusId?$(focusId):m.querySelector("button,input,select");
  if(f)f.focus();
}
function closeModal(id){
  const m=$(id);m.style.display="none";
  document.querySelector(".wrap").inert=false;
  const op=modalState&&modalState.opener;modalState=null;
  if(op&&document.body.contains(op))op.focus();
  else{const v=document.querySelector(".view.active");if(v)v.focus({preventScroll:true});}
}
document.addEventListener("keydown",e=>{
  if(!modalState)return;
  const m=modalState.m;
  if(e.key==="Escape"){e.preventDefault();closeModal(m.id);return;}
  if(e.key!=="Tab")return;
  const items=[...m.querySelectorAll("button,input,select,[tabindex]:not([tabindex='-1'])")].filter(x=>!x.disabled&&x.offsetParent!==null);
  if(!items.length)return;
  const first=items[0],last=items[items.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  else if(!m.contains(document.activeElement)){e.preventDefault();first.focus();}
});

// 收入/支出切換按鈕：以 class 為準同步 aria-pressed
function syncPressed(){document.querySelectorAll(".seg button").forEach(b=>b.setAttribute("aria-pressed",/\bon-(in|out)\b/.test(b.className)?"true":"false"));}
const segObs=new MutationObserver(syncPressed);
document.querySelectorAll(".seg").forEach(g=>segObs.observe(g,{attributes:true,attributeFilter:["class"],subtree:true}));
syncPressed();

// 標籤與輸入框綁定（點標籤可聚焦、螢幕閱讀器可讀出欄位名稱）
function linkLabels(){
  document.querySelectorAll(".field").forEach(f=>{
    const l=f.querySelector("label:not([for])"),c=f.querySelector("input,select");
    if(l&&c&&c.id)l.htmlFor=c.id;
  });
  ["f-amt","txe-amt","ft-name","ft-amt","ft-date","as-name","as-val","iv-name","iv-qty","iv-cost","iv-now"].forEach(i=>{const e=$(i);if(e)e.setAttribute("aria-required","true");});
}
// 手機版表格轉卡片會破壞表格語意，這裡用 ARIA 補回
function fixTables(){
  document.querySelectorAll("table.mobilecard").forEach(t=>{
    t.setAttribute("role","table");
    t.querySelectorAll("thead,tbody").forEach(x=>x.setAttribute("role","rowgroup"));
    t.querySelectorAll("tr").forEach(x=>x.setAttribute("role","row"));
    t.querySelectorAll("th").forEach(x=>{x.setAttribute("role","columnheader");x.setAttribute("scope","col");});
    t.querySelectorAll("td").forEach(x=>x.setAttribute("role","cell"));
  });
}

// 金額欄下方即時顯示千分位格式，減少多打零
const HINT_IDS=["f-amt","txe-amt","ft-amt","as-val"];
function amtHint(id){
  const el=$(id);if(!el)return;
  const h=document.createElement("div");h.className="amt-hint";h.id=id+"-hint";
  el.after(h);
  el.setAttribute("aria-describedby",((el.getAttribute("aria-describedby")||"")+" "+h.id).trim());
  el._hint=()=>{const v=parseFloat(el.value);h.textContent=(el.value!==""&&isFinite(v))?"約 "+(v<0?"−":"")+fmt(Math.abs(v)):"";};
  el.addEventListener("input",el._hint);
}
function refreshHints(){HINT_IDS.forEach(i=>{const e=$(i);if(e&&e._hint)e._hint();});}
HINT_IDS.forEach(amtHint);

/* ---------------- 分頁（tablist 語意＋方向鍵） ---------------- */
const tabBtns=[...document.querySelectorAll("nav.tabs [role=tab]")];
const navEl=$("mainNav"),moreBtn=$("moreBtn"),MOBILE=matchMedia("(max-width:760px)");
const SEC=new Set(["assets","invest","future","cloud"]); // 手機版收進「更多」的分頁
const visibleTabs=()=>tabBtns.filter(b=>b.offsetParent!==null);
function updateTabStops(){
  const vis=visibleTabs(),act=vis.find(b=>b.classList.contains("active"))||vis[0];
  tabBtns.forEach(b=>{b.tabIndex=(b===act)?0:-1;});
  moreBtn.classList.toggle("active",SEC.has(activeView()));
}
function setMore(open){navEl.classList.toggle("open",open);moreBtn.setAttribute("aria-expanded",open?"true":"false");}
moreBtn.onclick=()=>{
  const o=!navEl.classList.contains("open");setMore(o);
  if(o){const s=tabBtns.find(b=>SEC.has(b.dataset.view)&&b.classList.contains("active"))||tabBtns.find(b=>SEC.has(b.dataset.view));s.tabIndex=0;s.focus();}
};
document.addEventListener("click",e=>{if(navEl.classList.contains("open")&&!navEl.contains(e.target))setMore(false);});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&navEl.classList.contains("open")&&!modalState){setMore(false);moreBtn.focus();updateTabStops();}});
MOBILE.addEventListener("change",()=>{setMore(false);updateTabStops();});
function activateTab(b,keepOpen){
  if(!keepOpen)setMore(false);
  tabBtns.forEach(x=>{const on=x===b;x.classList.toggle("active",on);x.setAttribute("aria-selected",on?"true":"false");});
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  $("view-"+b.dataset.view).classList.add("active");
  document.title=b.querySelector(".lab").textContent+"｜理財記帳本";
  updateTabStops();
  renderAll();
}
tabBtns.forEach(b=>{
  b.onclick=()=>{
    activateTab(b);
    if(b.dataset.view==="add")setTimeout(()=>$("f-amt").focus({preventScroll:true}),0);
    else if(SEC.has(b.dataset.view)&&MOBILE.matches)moreBtn.focus();
  };
  b.onkeydown=e=>{
    const vis=visibleTabs(),i=vis.indexOf(b),n=vis.length;let k=null;
    if(e.key==="ArrowRight")k=(i+1)%n;
    else if(e.key==="ArrowLeft")k=(i-1+n)%n;
    else if(e.key==="Home")k=0;
    else if(e.key==="End")k=n-1;
    if(k!==null){e.preventDefault();vis[k].focus();activateTab(vis[k],true);}
  };
});

/* ---------------- 記帳表單 ---------------- */
$("f-date").value=todayStr();
$("ft-date").value=todayStr();
function fillCats(){
  const list=DB.cats[curType],h=$("f-cat"),box=$("f-cat-chips");
  if(!list.includes(h.value))h.value=list[0]||"";
  box.className="chips"+(curType==="expense"?" out":"");
  box.innerHTML=list.map(c=>`<button type="button" class="chip" role="radio" aria-checked="${c===h.value}" tabindex="${c===h.value?0:-1}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  const chips=[...box.querySelectorAll(".chip")];
  const pick=c=>{h.value=c;chips.forEach(x=>{const on=x.dataset.cat===c;x.setAttribute("aria-checked",on?"true":"false");x.tabIndex=on?0:-1;});};
  chips.forEach((b,i)=>{
    b.onclick=()=>pick(b.dataset.cat);
    b.onkeydown=e=>{
      const n=chips.length;let k=null;
      if(e.key==="ArrowRight"||e.key==="ArrowDown")k=(i+1)%n;
      else if(e.key==="ArrowLeft"||e.key==="ArrowUp")k=(i-1+n)%n;
      if(k!==null){e.preventDefault();chips[k].focus();pick(chips[k].dataset.cat);}
    };
  });
}
document.querySelectorAll("#typeSeg button").forEach(b=>{
  b.onclick=()=>{
    curType=b.dataset.type;
    document.querySelectorAll("#typeSeg button").forEach(x=>x.className="");
    b.className=curType==="income"?"on-in":"on-out";
    fillCats();
  };
});
fillCats();

/* ---------------- 分類管理 ---------------- */
let catEditType="income";
function renderChips(){
  const box=$("catChips");
  const list=DB.cats[catEditType];
  box.innerHTML=list.map(c=>`<span role="listitem" style="display:inline-flex;align-items:center;gap:2px;background:var(--paper);border:1px solid var(--field-line);border-radius:20px;padding:0 2px 0 12px;font-size:13.5px">${esc(c)}<button class="del" data-catdel="${esc(c)}" aria-label="刪除分類 ${esc(c)}"><span aria-hidden="true">×</span></button></span>`).join("")
    || `<span style="color:var(--muted);font-size:13px">這個類型還沒有分類，新增一個吧。</span>`;
  box.querySelectorAll("[data-catdel]").forEach(b=>b.onclick=()=>{
    const name=b.dataset.catdel;
    if(DB.cats[catEditType].length<=1){toast("至少要保留一個分類",true);return;}
    const used=DB.tx.some(t=>t.type===catEditType&&t.cat===name);
    withUndo(`已刪除分類「${name}」`+(used?"（既有記錄的分類名稱會保留）":""),()=>{
      DB.cats[catEditType]=DB.cats[catEditType].filter(c=>c!==name);
      if(catEditType==="expense")delete DB.budget[name];
    },()=>{renderChips();fillCats();});
  });
}
$("catManageBtn").onclick=()=>{
  catEditType=curType;
  document.querySelectorAll("#catTypeSeg button").forEach(x=>{
    const on=x.dataset.ctype===catEditType; x.className=on?(catEditType==="income"?"on-in":"on-out"):"";
  });
  renderChips();
  openModal("catModal","catNew");
};
$("catClose").onclick=()=>closeModal("catModal");
$("catModal").onclick=e=>{if(e.target===$("catModal"))closeModal("catModal");};
document.querySelectorAll("#catTypeSeg button").forEach(b=>{
  b.onclick=()=>{
    catEditType=b.dataset.ctype;
    document.querySelectorAll("#catTypeSeg button").forEach(x=>x.className="");
    b.className=catEditType==="income"?"on-in":"on-out";
    renderChips();
  };
});
$("catAdd").onclick=()=>{
  const name=$("catNew").value.trim();
  if(!name){showErr($("catNew"),"請輸入分類名稱",$("catNew").parentElement);return;}
  if(DB.cats[catEditType].includes(name)){showErr($("catNew"),"這個分類已經存在",$("catNew").parentElement);return;}
  DB.cats[catEditType].push(name);
  $("catNew").value="";
  save();renderChips();fillCats();renderBudget();
};
$("addBtn").onclick=()=>{
  const amt=parseMoney($("f-amt").value),date=$("f-date").value;
  if(!(amt>0)){showErr($("f-amt"),"請輸入大於 0 的金額（上限 1,000 億）");return;}
  if(!dateOk(date)){showErr($("f-date"),"請選擇日期");return;}
  DB.tx.push({id:uid(),u:Date.now(),type:curType,amount:amt,cat:$("f-cat").value,note:$("f-note").value,date});
  DB.tx.sort((a,b)=>b.date.localeCompare(a.date));
  $("f-amt").value="";$("f-note").value="";
  save();renderAll();
  toast("已記一筆"+(curType==="income"?"收入":"支出")+" "+fmt(amt));
  $("f-amt").focus();
};

/* ---------------- 明細 ---------------- */
const LF={q:"",m:"",t:"",c:"",n:50};
const PAGE=50;
function fillFilterOpts(){
  const months=[...new Set(DB.tx.map(t=>ym(t.date)))].sort().reverse();
  const cats=[...new Set(DB.tx.map(t=>t.cat))].sort();
  const key=JSON.stringify([months,cats]);
  if(fillFilterOpts.k===key)return;
  fillFilterOpts.k=key;
  $("fl-m").innerHTML='<option value="">全部月份</option>'+months.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join("");
  $("fl-c").innerHTML='<option value="">全部分類</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if(!months.includes(LF.m))LF.m="";
  if(!cats.includes(LF.c))LF.c="";
  $("fl-m").value=LF.m;$("fl-c").value=LF.c;
}
function goAdd(){activateTab($("tab-add"));setTimeout(()=>$("f-amt").focus({preventScroll:true}),0);}
function renderList(){
  fillFilterOpts();
  const tb=$("txBody"),emp=$("txEmpty"),q=LF.q.trim().toLowerCase();
  const rows=DB.tx.filter(t=>(!LF.m||ym(t.date)===LF.m)&&(!LF.t||t.type===LF.t)&&(!LF.c||t.cat===LF.c)&&(!q||(t.cat+" "+(t.note||"")).toLowerCase().includes(q)));
  const inc=rows.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0),exp=rows.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
  const shown=rows.slice(0,LF.n);
  $("flSummary").textContent=DB.tx.length?`符合 ${rows.length} / ${DB.tx.length} 筆${rows.length>shown.length?`（已顯示 ${shown.length} 筆）`:""}・收入 ${fmt(inc)}・支出 ${fmt(exp)}`:"";
  $("txMoreWrap").hidden=!(rows.length>shown.length);
  if(!rows.length){
    tb.innerHTML="";emp.style.display="block";$("txMoreWrap").hidden=true;
    emp.innerHTML=DB.tx.length?'沒有符合條件的記錄。 <button type="button" class="link-btn" id="flClear">清除篩選</button>':'還沒有任何記錄。 <button type="button" class="link-btn" id="txGoAdd">去記一筆</button>';
    const c=$("flClear");if(c)c.onclick=()=>{Object.assign(LF,{q:"",m:"",t:"",c:"",n:PAGE});["fl-q","fl-m","fl-t","fl-c"].forEach(i=>$(i).value="");renderList();};
    const g=$("txGoAdd");if(g)g.onclick=goAdd;
    return;
  }
  emp.style.display="none";
  tb.innerHTML=shown.map(t=>`<tr>
    <td data-label="日期">${esc(t.date)}</td>
    <td data-label="類型"><span class="tag ${t.type==="income"?"in":"out"}">${t.type==="income"?"收入":"支出"}</span></td>
    <td data-label="分類">${esc(t.cat)}</td><td data-label="備註">${esc(t.note)||"—"}</td>
    <td data-label="金額" style="text-align:right" class="${t.type==="income"?"amt-in":"amt-out"}">${t.type==="income"?"+":"−"}${fmt(t.amount)}</td>
    <td style="text-align:right;white-space:nowrap"><button class="del edit" data-txedit="${t.id}" aria-label="編輯 ${esc(t.date)} ${esc(t.cat)} ${fmt(t.amount)}">編輯</button> <button class="del" data-del="${t.id}" aria-label="刪除 ${esc(t.date)} ${esc(t.cat)} ${fmt(t.amount)}"><span aria-hidden="true">×</span></button></td>
  </tr>`).join("");
  tb.querySelectorAll("[data-txedit]").forEach(b=>b.onclick=()=>openTxEdit(b.dataset.txedit));
  tb.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>withUndo("已刪除 1 筆記錄",()=>removeItem(DB,"tx",b.dataset.del)));
}
Object.entries({"fl-q":"q","fl-m":"m","fl-t":"t","fl-c":"c"}).forEach(([id,k])=>$(id).addEventListener("input",e=>{LF[k]=e.target.value;LF.n=PAGE;renderList();}));
$("txMore").onclick=()=>{const old=LF.n;LF.n+=PAGE;renderList();const b=$("txBody").querySelectorAll("[data-txedit]")[old];if(b)b.focus();};

/* 明細編輯 */
let txEditId=null, txeType="income";
function fillTxeCats(){$("txe-cat").innerHTML=DB.cats[txeType].map(c=>`<option>${esc(c)}</option>`).join("");}
function openTxEdit(id){
  const t=DB.tx.find(x=>x.id==id); if(!t)return;
  txEditId=id; txeType=t.type;
  document.querySelectorAll("#txeTypeSeg button").forEach(x=>{const on=x.dataset.txetype===t.type;x.className=on?(t.type==="income"?"on-in":"on-out"):"";});
  fillTxeCats();
  $("txe-amt").value=t.amount;$("txe-date").value=t.date;$("txe-note").value=t.note||"";
  // 若分類存在就選它，否則加一個臨時選項保留原值
  if(!DB.cats[t.type].includes(t.cat)){const o=document.createElement("option");o.textContent=t.cat;$("txe-cat").appendChild(o);}
  $("txe-cat").value=t.cat;
  openModal("txModal","txe-amt");
}
$("txClose").onclick=()=>closeModal("txModal");
$("txModal").onclick=e=>{if(e.target===$("txModal"))closeModal("txModal");};
document.querySelectorAll("#txeTypeSeg button").forEach(b=>{
  b.onclick=()=>{
    txeType=b.dataset.txetype;
    document.querySelectorAll("#txeTypeSeg button").forEach(x=>x.className="");
    b.className=txeType==="income"?"on-in":"on-out";
    fillTxeCats();
  };
});
$("txSave").onclick=()=>{
  const t=DB.tx.find(x=>x.id==txEditId); if(!t)return;
  const amt=parseMoney($("txe-amt").value),date=$("txe-date").value;
  if(!(amt>0)){showErr($("txe-amt"),"請輸入大於 0 的金額（上限 1,000 億）");return;}
  if(!dateOk(date)){showErr($("txe-date"),"請選擇日期");return;}
  const fields={type:txeType,amount:amt,cat:$("txe-cat").value,note:$("txe-note").value,date};
  closeModal("txModal");
  withUndo("已更新記錄",()=>{Object.assign(t,fields,{u:Date.now()});DB.tx.sort((a,b)=>b.date.localeCompare(a.date));});
};

/* ---------------- 預算 ---------------- */
function renderBudget(){
  const ff=$("budForm");
  ff.innerHTML=DB.cats.expense.map((c,i)=>`<div class="field"><label for="bud-${i}">${esc(c)}</label><input type="number" inputmode="decimal" min="0" id="bud-${i}" data-bud="${esc(c)}" value="${DB.budget[c]||""}" placeholder="不設限"></div>`).join("");
  $("budSave").onclick=()=>{
    ff.querySelectorAll("[data-bud]").forEach(i=>{const v=parseMoney(i.value);if(v>0)DB.budget[i.dataset.bud]=v;else delete DB.budget[i.dataset.bud];});
    save();renderBudget();toast("預算已儲存");
  };
  const spent={};
  DB.tx.filter(t=>t.type==="expense"&&ym(t.date)===thisMonth).forEach(t=>spent[t.cat]=round2((spent[t.cat]||0)+t.amount));
  const keys=Object.keys(DB.budget);
  $("budList").innerHTML= keys.length? keys.map(c=>{
    const used=spent[c]||0,lim=DB.budget[c],pct=Math.min(100,used/lim*100);
    const cls=used>lim?"over":used>lim*0.8?"warn":"";
    return `<div class="bud-item"><div class="bud-head"><span>${esc(c)} ${used>lim?"⚠ 已超支":used>lim*0.8?"⚠ 接近上限":""}</span><b>${fmt(used)} / ${fmt(lim)}</b></div><div class="bar" role="progressbar" aria-label="${esc(c)} 預算使用率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-valuetext="已用 ${fmt(used)}，上限 ${fmt(lim)}${used>lim?"，已超支":used>lim*0.8?"，接近上限":""}"><i class="${cls}" style="width:${pct}%"></i></div></div>`;
  }).join("") : `<div class="empty">尚未設定任何預算。 <button type="button" class="link-btn" id="budGo">開始設定</button></div>`;
  const bg=$("budGo");if(bg)bg.onclick=()=>{const f=$("bud-0");if(f)f.focus();};
}

/* ---------------- 資產 ---------------- */
$("asAdd").onclick=()=>{
  const n=$("as-name").value.trim(),v=parseMoney($("as-val").value);
  if(!n){showErr($("as-name"),"請填寫項目名稱");return;}
  if(isNaN(v)){showErr($("as-val"),"請填寫有效金額（上限 1,000 億）");return;}
  DB.assets.push({id:uid(),u:Date.now(),name:n,val:v});$("as-name").value="";$("as-val").value="";save();renderAll();
};
function renderAssets(){
  $("asBody").innerHTML=DB.assets.map(a=>`<tr><td data-label="項目">${esc(a.name)}</td><td data-label="金額" style="text-align:right" class="${a.val>=0?"amt-in":"amt-out"}">${fmt(a.val)}</td><td style="text-align:right"><button class="del" data-adel="${a.id}" aria-label="刪除資產 ${esc(a.name)}"><span aria-hidden="true">×</span></button></td></tr>`).join("")
    ||`<tr><td colspan="3" class="empty" style="padding:24px">尚無資產項目</td></tr>`;
  $("asBody").querySelectorAll("[data-adel]").forEach(b=>b.onclick=()=>withUndo("已刪除資產項目",()=>removeItem(DB,"assets",b.dataset.adel)));
}

/* ---------------- 投資 ---------------- */
$("ivAdd").onclick=()=>{
  const n=$("iv-name").value.trim(),q=parseMoney($("iv-qty").value,4),c=parseMoney($("iv-cost").value,4),p=parseMoney($("iv-now").value,4);
  for(const [id,ok,msg] of [["iv-name",n,"請填寫標的"],["iv-qty",q,"請填寫股數"],["iv-cost",c,"請填寫成本價"],["iv-now",p,"請填寫現價"]]){if(!ok){showErr($(id),msg);return;}}
  DB.invest.push({id:uid(),u:Date.now(),name:n,qty:q,cost:c,now:p});
  ["iv-name","iv-qty","iv-cost","iv-now"].forEach(i=>$(i).value="");save();renderAll();
};
function renderInvest(){
  const tb=$("ivBody"),emp=$("ivEmpty");
  if(!DB.invest.length){tb.innerHTML="";emp.style.display="block";return;}
  emp.style.display="none";
  tb.innerHTML=DB.invest.map(v=>{
    const cost=v.qty*v.cost,mv=v.qty*v.now,pl=mv-cost,roi=pl/cost*100;
    return `<tr><td data-label="標的">${esc(v.name)}</td><td data-label="股數" style="text-align:right">${v.qty.toLocaleString()}</td><td data-label="成本" style="text-align:right">${fmt(cost)}</td><td data-label="市值" style="text-align:right">${fmt(mv)}</td>
    <td data-label="損益" style="text-align:right" class="${pl>=0?"amt-in":"amt-out"}">${pl>=0?"+":"−"}${fmt(Math.abs(pl))}</td>
    <td data-label="報酬率" style="text-align:right" class="${pl>=0?"amt-in":"amt-out"}">${roi>=0?"+":""}${roi.toFixed(1)}%</td>
    <td style="text-align:right"><button class="del" data-idel="${v.id}" aria-label="刪除持股 ${esc(v.name)}"><span aria-hidden="true">×</span></button></td></tr>`;
  }).join("");
  tb.querySelectorAll("[data-idel]").forEach(b=>b.onclick=()=>withUndo("已刪除持股",()=>removeItem(DB,"invest",b.dataset.idel)));
}

/* ---------------- KPI + 圖表 ---------------- */
let charts={};
// 每張圖下方附「檢視資料表」，不靠視覺也能讀到完整數字
function renderDataTable(el,cfg,empty){
  const box=el.closest(".chart-box");if(!box)return;
  let d=box.nextElementSibling;
  if(!d||!d.classList.contains("dt")){d=document.createElement("details");d.className="dt";d.innerHTML='<summary>檢視資料表</summary><div class="dt-scroll"></div>';box.after(d);}
  const wrap=d.querySelector(".dt-scroll");
  if(empty){wrap.innerHTML=`<p class="sub" style="margin:6px 0">${esc(empty)}</p>`;return;}
  const lab=cfg.data.labels||[],sets=cfg.data.datasets,single=cfg.type==="doughnut";
  const head=`<th scope="col">${single?"項目":"期間"}</th>`+sets.map(x=>`<th scope="col">${esc(single?"金額":x.label||"數值")}</th>`).join("");
  const rows=lab.map((l,i)=>`<tr><th scope="row">${esc(l)}</th>`+sets.map(x=>`<td>${fmt(x.data[i]||0)}</td>`).join("")+"</tr>").join("");
  wrap.innerHTML=`<table><caption class="sr-only">${esc(el.dataset.base)}</caption><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}
function chartSummary(cfg){
  const lab=cfg.data.labels||[];
  if(lab.length===1&&/^尚無/.test(lab[0]))return lab[0];
  return cfg.data.datasets.map(ds=>(ds.label?ds.label+"：":"")+lab.map((l,i)=>l+" "+fmt(ds.data[i]||0)).join("、")).join("；");
}
// 圖表鍵盤操作：左右方向鍵、Home、End 逐項顯示並朗讀數值（等同滑鼠 tooltip）
function chartKey(e,c){
  if(!c||!["ArrowRight","ArrowLeft","Home","End"].includes(e.key))return;
  e.preventDefault();
  const labs=c.data.labels||[],n=labs.length;if(!n)return;
  if(n===1&&/^尚無/.test(labs[0])){$("chartLive").textContent=labs[0];return;}
  let i=c._kb==null?-1:c._kb;
  i=e.key==="ArrowRight"?Math.min(n-1,i+1):e.key==="ArrowLeft"?Math.max(0,i<0?0:i-1):e.key==="Home"?0:n-1;
  c._kb=i;
  const act=c.data.datasets.map((_,d)=>({datasetIndex:d,index:i}));
  const m=c.getDatasetMeta(0).data[i];
  c.setActiveElements(act);
  c.tooltip.setActiveElements(act,{x:m?m.x:0,y:m?m.y:0});
  c.update("none");
  $("chartLive").textContent=labs[i]+"："+c.data.datasets.map(d=>(d.label?d.label+" ":"")+fmt(d.data[i]||0)).join("，");
}
// 圖表以文字摘要提供給螢幕閱讀器
function mkChart(id,cfg,summary){
  if(charts[id])charts[id].destroy();
  const el=$(id);
  if(el){
    charts[id]=new Chart(el,cfg);
    if(!el.dataset.base)el.dataset.base=el.getAttribute("aria-label")||"";
    const sum=summary||chartSummary(cfg);
    el.setAttribute("aria-label",el.dataset.base+"（聚焦後可用左右方向鍵逐項讀取數值）。"+sum);
    renderDataTable(el,cfg,/^尚無/.test(sum)?sum:"");
    el.tabIndex=0;
    el.onkeydown=e=>chartKey(e,charts[id]);
    el.onblur=()=>{const c=charts[id];if(c){c._kb=null;c.setActiveElements([]);c.tooltip.setActiveElements([],{x:0,y:0});c.update("none");}};
  }
}
/* 圖表主題（跟隨系統深／淺色）與「顏色以外」的區分：花紋填色 */
const DARK_Q=window.matchMedia("(prefers-color-scheme: dark)");
let T={};
function applyTheme(){
  T=DARK_Q.matches
   ?{inc:"#5fbf9a",exp:"#e0896a",gold:"#d4b25e",slate:"#8fa6b0",grid:"#34453d",font:"#a9a692",card:"#1a2722",empty:"#34453d",fill:"rgba(95,191,154,.14)",
     palette:["#5fbf9a","#e0896a","#d4b25e","#c58fb2","#8fa6b0","#a3b86a","#6fb1c4","#c9a273","#9d98e0"]}
   :{inc:"#1f6f54",exp:"#a8553a",gold:"#8a6a10",slate:"#5a6b74",grid:"#e0dccf",font:"#625e51",card:"#fffdf8",empty:"#e0dccf",fill:"rgba(31,111,84,.08)",
     palette:["#1f6f54","#a8553a","#8a6a10","#7d4a6b","#5a6b74","#6f7f3f","#3f7080","#8a6a3a","#4f4a8a"]};
  Chart.defaults.color=T.font;
}
Chart.defaults.font.family='"Noto Sans TC",sans-serif';
if(reduceMotion)Chart.defaults.animation=false;
// 依序產生：實心、斜線、圓點、交叉、橫線、反斜線
function pat(color,i){
  const k=i%6;if(k===0)return color;
  const c=document.createElement("canvas");c.width=c.height=10;const x=c.getContext("2d");
  x.fillStyle=color;x.fillRect(0,0,10,10);
  x.strokeStyle=T.card;x.fillStyle=T.card;x.lineWidth=2;x.beginPath();
  if(k===1){x.moveTo(0,10);x.lineTo(10,0);x.moveTo(-2,2);x.lineTo(2,-2);x.moveTo(8,12);x.lineTo(12,8);x.stroke();}
  else if(k===2){x.arc(5,5,1.8,0,7);x.fill();}
  else if(k===3){x.moveTo(0,10);x.lineTo(10,0);x.moveTo(0,0);x.lineTo(10,10);x.stroke();}
  else if(k===4){x.moveTo(0,5);x.lineTo(10,5);x.stroke();}
  else{x.moveTo(0,0);x.lineTo(10,10);x.moveTo(-2,8);x.lineTo(2,12);x.moveTo(8,-2);x.lineTo(12,2);x.stroke();}
  return x.createPattern(c,"repeat");
}
DARK_Q.addEventListener&&DARK_Q.addEventListener("change",()=>{applyTheme();renderAll();});



function renderKPI(){
  const inc=DB.tx.filter(t=>t.type==="income"&&ym(t.date)===thisMonth).reduce((s,t)=>s+t.amount,0);
  const exp=DB.tx.filter(t=>t.type==="expense"&&ym(t.date)===thisMonth).reduce((s,t)=>s+t.amount,0);
  const net=round2(inc-exp);
  const worth=DB.assets.reduce((s,a)=>s+a.val,0)+DB.invest.reduce((s,v)=>s+v.qty*v.now,0);
  $("k-income").textContent=fmt(inc);$("k-expense").textContent=fmt(exp);
  const kn=$("k-net");kn.textContent=(net>=0?"+":"−")+fmt(Math.abs(net));kn.className="val "+(net>=0?"up":"down");
  $("k-worth").textContent=fmt(worth);
}

function renderCharts(v){
  const sumBy=(type,m)=>DB.tx.filter(t=>t.type===type&&ym(t.date)===m).reduce((s,t)=>s+t.amount,0);
  const catSum={};DB.tx.filter(t=>t.type==="expense"&&ym(t.date)===thisMonth).forEach(t=>catSum[t.cat]=round2((catSum[t.cat]||0)+t.amount));
  const pieL=Object.keys(catSum),pieD=Object.values(catSum),P=T.palette;
  const mkPie=()=>({type:"doughnut",data:{labels:pieL.length?pieL:["尚無支出"],datasets:[{data:pieD.length?pieD:[1],
    backgroundColor:pieL.length?pieL.map((_,i)=>pat(P[i%P.length],i)):[T.empty],borderWidth:2,borderColor:T.card}]},
    options:{maintainAspectRatio:false,cutout:"60%",plugins:{legend:{position:"right",labels:{boxWidth:14,padding:10}}}}});

  if(v==="add"){mkChart("chDonutQuick",mkPie());return;}
  if(v==="assets"){
    const pos=DB.assets.filter(a=>a.val>0);
    mkChart("chAsset2",{type:"doughnut",data:{labels:pos.length?pos.map(a=>a.name):["尚無資產"],datasets:[{data:pos.length?pos.map(a=>a.val):[1],backgroundColor:pos.length?pos.map((_,i)=>pat(P[i%P.length],i)):[T.empty],borderWidth:2,borderColor:T.card}]},
      options:{maintainAspectRatio:false,cutout:"58%",plugins:{legend:{position:"right",labels:{boxWidth:14,padding:10}}}}});
    return;
  }
  if(v!=="dash")return;

  const mk=monthKeys(6);
  const incArr=mk.map(m=>sumBy("income",m)),expArr=mk.map(m=>sumBy("expense",m));
  const lbl=mk.map(m=>m.slice(5)+"月");

  mkChart("chBar",{type:"bar",data:{labels:lbl,datasets:[
    {label:"收入（實心）",data:incArr,backgroundColor:T.inc,borderRadius:4},
    {label:"支出（斜線）",data:expArr,backgroundColor:pat(T.exp,1),borderColor:T.exp,borderWidth:1,borderRadius:4}]},
    options:{maintainAspectRatio:false,plugins:{legend:{position:"bottom"}},scales:{y:{grid:{color:T.grid}},x:{grid:{display:false}}}}});

  mkChart("chPie",mkPie());

  let run=0;const netArr=mk.map((m,i)=>{run+=incArr[i]-expArr[i];return run;});
  mkChart("chLine",{type:"line",data:{labels:lbl,datasets:[{label:"累積結餘",data:netArr,borderColor:T.inc,backgroundColor:T.fill,fill:true,tension:.3,pointRadius:4,pointStyle:"circle"}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:{color:T.grid}},x:{grid:{display:false}}}}});

  const cash=DB.assets.filter(a=>a.val>0).reduce((s,a)=>s+a.val,0);
  const invv=DB.invest.reduce((s,x)=>s+x.qty*x.now,0);
  mkChart("chAsset",{type:"doughnut",data:{labels:["現金/資產","投資持股"],datasets:[{data:(cash+invv)?[cash,invv]:[1,0],backgroundColor:[T.slate,pat(T.gold,2)],borderWidth:2,borderColor:T.card}]},
    options:{maintainAspectRatio:false,cutout:"58%",plugins:{legend:{position:"bottom"}}}},(cash+invv)?null:"尚無資產資料");
}

function activeView(){const v=document.querySelector(".view.active");return v?v.id.slice(5):"dash";}
// 只重繪目前看得到的分頁（切換分頁時才畫其他頁），避免每次動作都重畫所有圖表
function renderAll(){
  thisMonth=todayStr().slice(0,7);
  const v=activeView();
  if(v==="dash"){renderKPI();renderBudAlert();renderPlanNotice();renderForecast();}
  else if(v==="list")renderList();
  else if(v==="budget")renderBudget();
  else if(v==="assets")renderAssets();
  else if(v==="invest")renderInvest();
  else if(v==="future")renderFuture();
  renderCharts(v);fixTables();linkLabels();refreshHints();
}

/* ---------------- 預算提醒（總覽） ---------------- */
function budgetStats(){
  const spent={};
  DB.tx.filter(t=>t.type==="expense"&&ym(t.date)===thisMonth).forEach(t=>spent[t.cat]=round2((spent[t.cat]||0)+t.amount));
  return Object.keys(DB.budget).map(c=>({c,used:spent[c]||0,lim:DB.budget[c]}));
}
function renderBudAlert(){
  const box=$("budAlert");
  const items=budgetStats().filter(x=>x.used>x.lim*0.8).sort((a,b)=>b.used/b.lim-a.used/a.lim);
  if(!items.length){box.style.display="none";box.innerHTML="";return;}
  box.style.display="block";
  box.innerHTML=`<h3>預算提醒</h3><p class="sub" style="margin-bottom:8px">本月有 ${items.length} 個分類已超支或接近上限</p>`
    +items.map(x=>x.used>x.lim
      ?`<div class="alert-line"><b>⚠ ${esc(x.c)} 已超支 ${fmt(x.used-x.lim)}</b><span style="color:var(--muted)">已用 ${fmt(x.used)} / ${fmt(x.lim)}</span></div>`
      :`<div class="alert-line"><b>⚠ ${esc(x.c)} 接近上限</b><span style="color:var(--muted)">已用 ${Math.round(x.used/x.lim*100)}%（${fmt(x.used)} / ${fmt(x.lim)}）</span></div>`).join("")
    +`<button type="button" class="link-btn" id="budAlertGo" style="padding-left:0">查看預算 →</button>`;
  $("budAlertGo").onclick=()=>activateTab($("tab-budget"));
}

/* ---------------- 未來 12 個月收支預測（總覽） ---------------- */
function renderForecast(){
  if(!$("chForecast"))return;
  const mk=futureMonths(12);
  const lbl=mk.map(m=>m.slice(5)+"月");

  // 日常平均月支出：取近 3 個完整月的實際支出平均（排除已標記為規劃轉入的，避免重複計算）
  const past=monthKeys(4).slice(0,3); // 前 3 個月（不含本月）
  let sum=0,cnt=0;
  past.forEach(m=>{
    const e=DB.tx.filter(t=>t.type==="expense"&&ym(t.date)===m&&!t.planKey).reduce((s,t)=>s+t.amount,0);
    sum+=e;cnt++;
  });
  const avgDaily = cnt? sum/cnt : 0; // 每月日常平均支出

  // 各月規劃支出/收入
  const planExp=[],planInc=[],dailyArr=[];
  mk.forEach(m=>{
    let pe=0,pi=0;
    DB.future.forEach(f=>{if(hitsMonth(f,m)){f.type==="income"?pi+=f.amount:pe+=f.amount;}});
    planExp.push(pe);planInc.push(pi);dailyArr.push(Math.round(avgDaily));
  });

  mkChart("chForecast",{
    type:"bar",
    data:{labels:lbl,datasets:[
      {label:"日常平均支出（圓點）",data:dailyArr,backgroundColor:pat(T.slate,2),borderColor:T.slate,borderWidth:1,stack:"exp",borderRadius:3,order:2},
      {label:"規劃支出（斜線）",data:planExp,backgroundColor:pat(T.exp,1),borderColor:T.exp,borderWidth:1,stack:"exp",borderRadius:3,order:2},
      {type:"line",label:"預估收入（菱形點）",data:planInc,borderColor:T.inc,backgroundColor:T.inc,tension:.3,pointRadius:5,pointStyle:"rectRot",order:0}
    ]},
    options:{maintainAspectRatio:false,
      plugins:{legend:{position:"bottom"},tooltip:{callbacks:{footer:(items)=>{
        const i=items[0].dataIndex;const tot=dailyArr[i]+planExp[i];const inc=planInc[i];
        return "當月支出合計 "+fmt(tot)+(inc?"　結餘 "+fmt(inc-tot):"");
      }}}},
      scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{color:T.grid}}}}
  });

  // 提示文字
  const hint=$("forecastHint");
  if(avgDaily>0) hint.textContent=`日常平均支出以近 ${cnt} 個月實際記帳估算，約每月 ${fmt(avgDaily)}；圓點花紋為日常平均支出、斜線花紋為規劃項目（保險、車貸等）。`;
  else hint.textContent="目前還沒有足夠的實際記帳可估日常平均支出，圖上只顯示規劃項目。多記幾筆帳後會更準。";

  renderFixedList();
}

// 固定收支一覽（列出所有定期項目）
function renderFixedList(){
  const panel=$("fixedPanel"),box=$("fixedList");if(!box)return;
  const recur=DB.future.filter(f=>f.rep!=="once");
  if(!recur.length){panel.style.display="none";return;}
  panel.style.display="block";
  const repTxt={monthly:"每月",quarterly:"每季",yearly:"每年"};
  box.innerHTML=recur.sort((a,b)=>a.type===b.type?b.amount-a.amount:(a.type==="expense"?-1:1)).map(f=>{
    const due=nextDueDate(f);
    let nextTxt="已結束",daysTxt="";
    if(due){
      nextTxt=`${due.getFullYear()}/${(due.getMonth()+1+"").padStart(2,"0")}/${(due.getDate()+"").padStart(2,"0")}`;
      const today=new Date();today.setHours(0,0,0,0);
      const d=Math.round((due-today)/86400000);
      daysTxt = d===0?"・今天":d===1?"・明天":d>1?`・還有 ${d} 天`:"";
    }
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid var(--line)">
      <div style="min-width:0">
        <span class="tag ${f.type==="income"?"in":"out"}">${f.type==="income"?"收入":"支出"}</span>
        <b style="margin-left:6px">${esc(f.name)}</b>
        <span style="color:var(--muted);font-size:12.5px;margin-left:8px">${repTxt[f.rep]}・下次 ${nextTxt}${daysTxt}</span>
      </div>
      <span class="${f.type==="income"?"amt-in":"amt-out"}" style="white-space:nowrap">${f.type==="income"?"+":"−"}${fmt(f.amount)}</span>
    </div>`;
  }).join("");
}

/* ---------------- 本月規劃提示（總覽） ---------------- */
function renderPlanNotice(){
  const box=$("planNotice"); if(!box)return;
  // 找出本月到期、且尚未被記帳落實的規劃項目
  const items=DB.future.filter(f=>hitsMonth(f,thisMonth) && !isPlanLogged(f,thisMonth));
  if(!items.length){box.style.display="none";return;}
  box.style.display="block";
  let net=0;
  $("planList").innerHTML=items.map(f=>{
    net += f.type==="income"?f.amount:-f.amount;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)">
      <div style="min-width:0">
        <span class="tag ${f.type==="income"?"in":"out"}">${f.type==="income"?"收入":"支出"}</span>
        <b style="margin-left:6px">${esc(f.name)}</b>
      </div>
      <div style="display:flex;align-items:center;gap:12px;white-space:nowrap">
        <span class="${f.type==="income"?"amt-in":"amt-out"}">${f.type==="income"?"+":"−"}${fmt(f.amount)}</span>
        <button class="btn" data-plandone="${f.id}" aria-label="${esc(f.name)} 已發生，轉為實際記帳" style="width:auto;margin:0;padding:10px 14px;font-size:13px;min-height:44px">已發生</button>
      </div>
    </div>`;
  }).join("");
  const pn=$("plan-net");pn.textContent=(net>=0?"+":"−")+fmt(Math.abs(net));pn.className=net>=0?"amt-in":"amt-out";
  $("planList").querySelectorAll("[data-plandone]").forEach(b=>b.onclick=()=>logPlanItem(b.dataset.plandone));
}
// 判斷某規劃項目在該月是否已被記成實際帳（用隱藏標記 planKey 比對）
function isPlanLogged(f,mKey){
  return DB.tx.some(t=>t.planKey===f.id+"@"+mKey);
}
// 把一筆規劃落實成實際記帳
function logPlanItem(fid){
  const f=DB.future.find(x=>x.id==fid); if(!f)return;
  const day=f.date.slice(8,10)||"01";
  const dateStr=thisMonth+"-"+day;
  // 分類：優先用規劃指定的分類；沒有才退回名稱比對，再退回「其他」
  const catPool=DB.cats[f.type];
  let cat;
  if(f.cat && catPool.includes(f.cat)) cat=f.cat;
  else if(f.cat) cat=f.cat; // 保留使用者當初填的分類（即使後來被刪）
  else if(catPool.includes(f.name)) cat=f.name;
  else cat=(f.type==="income"?"其他收入":"其他支出");
  DB.tx.push({id:uid(),u:Date.now(),type:f.type,amount:f.amount,cat,note:f.name+"（規劃）",date:dateStr,planKey:f.id+"@"+thisMonth});
  DB.tx.sort((a,b)=>b.date.localeCompare(a.date));
  save();renderAll();
}

/* ---------------- 同步狀態 ---------------- */
let SYNC={state:"",txt:""};
function setSync(state,txt){
  SYNC={state,txt};
  const d=$("syncDot");d.className="dot"+(state==="on"?" on":state==="err"?" err":"");$("syncTxt").textContent=txt;
  $("syncRetry").hidden=!(state==="err"&&cloudOn());
  if(typeof renderCfg==="function")renderCfg();
}
$("syncRetry").onclick=()=>{setSync("","重試同步中…");localStorage.getItem(LS_DIRTY)?doSave():pull();};
$("ivEmptyBtn").onclick=()=>$("iv-name").focus();
$("fEmptyBtn").onclick=()=>$("ft-name").focus();

/* ---------------- 未來規劃 ---------------- */
let fType="expense";
function fillFtCats(keep){
  const s=$("ft-cat");const list=DB.cats[fType];
  s.innerHTML=list.map(c=>`<option>${esc(c)}</option>`).join("");
  if(keep && !list.includes(keep)){const o=document.createElement("option");o.textContent=keep;s.appendChild(o);}
  if(keep)s.value=keep;
}
document.querySelectorAll("#fTypeSeg button").forEach(b=>{
  b.onclick=()=>{
    fType=b.dataset.ftype;
    document.querySelectorAll("#fTypeSeg button").forEach(x=>x.className="");
    b.className=fType==="income"?"on-in":"on-out";
    fillFtCats();
  };
});
fillFtCats();
let editingFid=null; // 目前正在編輯的規劃 id，null 代表新增
$("ftAdd").onclick=()=>{
  const name=$("ft-name").value.trim(),amt=parseMoney($("ft-amt").value),date=$("ft-date").value;
  if(!name){showErr($("ft-name"),"請填寫項目名稱");return;}
  if(!(amt>0)){showErr($("ft-amt"),"請輸入大於 0 的金額（上限 1,000 億）");return;}
  if(!dateOk(date)){showErr($("ft-date"),"請選擇日期");return;}
  const cat=$("ft-cat").value;
  const snap=JSON.stringify(DB),wasEdit=!!editingFid;
  if(editingFid){
    const f=DB.future.find(x=>x.id==editingFid);
    if(f){f.type=fType;f.name=name;f.amount=amt;f.cat=cat;f.rep=$("ft-rep").value;f.date=date;f.end=$("ft-end").value||"";f.u=Date.now();}
    exitEditMode();
  }else{
    DB.future.push({id:uid(),u:Date.now(),type:fType,name,amount:amt,cat,rep:$("ft-rep").value,date,end:$("ft-end").value||""});
  }
  $("ft-name").value="";$("ft-amt").value="";$("ft-end").value="";fillFtCats();
  save();renderAll();
  if(wasEdit)offerUndo(snap,"已更新規劃項目");
};
function enterEditMode(fid){
  const f=DB.future.find(x=>x.id==fid); if(!f)return;
  editingFid=fid;
  fType=f.type;
  document.querySelectorAll("#fTypeSeg button").forEach(x=>{const on=x.dataset.ftype===f.type;x.className=on?(f.type==="income"?"on-in":"on-out"):"";});
  $("ft-name").value=f.name;$("ft-amt").value=f.amount;$("ft-rep").value=f.rep;$("ft-date").value=f.date;$("ft-end").value=f.end||"";
  fillFtCats(f.cat);
  $("ftAdd").textContent="儲存修改";
  if(!$("ftCancel")){
    const c=document.createElement("button");c.type="button";c.id="ftCancel";c.className="btn ghost";c.textContent="取消編輯";c.style.marginTop="8px";
    c.onclick=()=>{exitEditMode();$("ft-name").value="";$("ft-amt").value="";$("ft-end").value="";fillFtCats();};
    $("ftAdd").after(c);
  }
  try{window.scrollTo({top:0,behavior:reduceMotion?"auto":"smooth"});}catch(e){}
  $("ft-name").focus({preventScroll:true});
}
function exitEditMode(){
  editingFid=null;$("ftAdd").textContent="加入規劃";
  const c=$("ftCancel");if(c)c.remove();
}

function renderFuture(){
  // 清單
  const tb=$("fListBody"),emp=$("fListEmpty");
  const repTxt={once:"單次",monthly:"每月",quarterly:"每季",yearly:"每年"};
  if(!DB.future.length){tb.innerHTML="";emp.style.display="block";}
  else{
    emp.style.display="none";
    const sorted=[...DB.future].sort((a,b)=>a.date.localeCompare(b.date));
    tb.innerHTML=sorted.map(f=>`<tr>
      <td data-label="項目">${esc(f.name)}</td>
      <td data-label="分類">${esc(f.cat)||"—"}</td>
      <td data-label="類型"><span class="tag ${f.type==="income"?"in":"out"}">${f.type==="income"?"收入":"支出"}</span></td>
      <td data-label="金額" style="text-align:right" class="${f.type==="income"?"amt-in":"amt-out"}">${fmt(f.amount)}</td>
      <td data-label="重複">${repTxt[f.rep]}</td><td data-label="起始">${esc(f.date)}</td><td data-label="結束">${esc(f.end)||"—"}</td>
      <td style="text-align:right;white-space:nowrap"><button class="del edit" data-fedit="${f.id}" aria-label="編輯規劃 ${esc(f.name)}">編輯</button> <button class="del" data-fdel="${f.id}" aria-label="刪除規劃 ${esc(f.name)}"><span aria-hidden="true">×</span></button></td></tr>`).join("");
    tb.querySelectorAll("[data-fedit]").forEach(b=>b.onclick=()=>enterEditMode(b.dataset.fedit));
    tb.querySelectorAll("[data-fdel]").forEach(b=>b.onclick=()=>withUndo("已刪除規劃項目",()=>{if(editingFid==b.dataset.fdel)exitEditMode();removeItem(DB,"future",b.dataset.fdel);}));
  }

  // 未來 12 個月現金流
  const mk=futureMonths(12);
  const incArr=[],expArr=[],needArr=[];
  mk.forEach(m=>{
    let inc=0,exp=0;
    DB.future.forEach(f=>{if(hitsMonth(f,m)){f.type==="income"?inc+=f.amount:exp+=f.amount;}});
    incArr.push(inc);expArr.push(exp);needArr.push(round2(exp-inc));
  });

  // KPI
  const totOut=expArr.reduce((a,b)=>a+b,0),totIn=incArr.reduce((a,b)=>a+b,0);
  $("fk-out").textContent=fmt(totOut);$("fk-in").textContent=fmt(totIn);
  let peakI=-1,peakV=-Infinity;needArr.forEach((v,i)=>{if(v>peakV){peakV=v;peakI=i;}});
  $("fk-peak").textContent=(peakV>0&&peakI>=0)?`${mk[peakI].slice(5)}月 · 缺 ${fmt(peakV)}`:"無缺口";

  // 表格
  $("fCalBody").innerHTML=mk.map((m,i)=>{
    const need=needArr[i];
    return `<tr>
      <td data-label="月份">${m.slice(0,4)}/${m.slice(5)}</td>
      <td data-label="預計收入" style="text-align:right" class="amt-in">${incArr[i]?fmt(incArr[i]):"—"}</td>
      <td data-label="預計支出" style="text-align:right" class="amt-out">${expArr[i]?fmt(expArr[i]):"—"}</td>
      <td data-label="當月需預留" style="text-align:right;font-weight:700;color:${need>0?"var(--danger)":"var(--jade)"}">${need>0?"預留 "+fmt(need):need<0?"結餘 "+fmt(-need):"—"}</td>
    </tr>`;
  }).join("");

  // 圖
  const lbl=mk.map(m=>m.slice(5)+"月");
  mkChart("chFuture",{type:"bar",data:{labels:lbl,datasets:[
    {type:"line",label:"預計收入（菱形點）",data:incArr,borderColor:T.inc,backgroundColor:T.inc,tension:.3,pointRadius:5,pointStyle:"rectRot",order:0},
    {label:"預計支出（斜線）",data:expArr,backgroundColor:pat(T.exp,1),borderColor:T.exp,borderWidth:1,borderRadius:4,order:1}]},
    options:{maintainAspectRatio:false,plugins:{legend:{position:"bottom"}},scales:{y:{grid:{color:T.grid}},x:{grid:{display:false}}}}});
}


/* ---------------- 匯出 Excel ---------------- */
let xlsxP=null;
function loadXLSX(){
  if(window.XLSX)return Promise.resolve();
  return xlsxP||(xlsxP=new Promise((res,rej)=>{
    const sc=document.createElement("script");sc.src="vendor/xlsx.full.min.js";
    sc.onload=res;sc.onerror=()=>{xlsxP=null;rej(new Error("load"));};document.head.appendChild(sc);
  }));
}
$("xlsxBtn").onclick=async()=>{
  try{await loadXLSX();}catch(e){toast("匯出元件載入失敗，請確認網路後再試",true);return;}
  const wb=XLSX.utils.book_new();

  // 交易明細
  const txRows=DB.tx.map(t=>({日期:t.date,類型:t.type==="income"?"收入":"支出",分類:t.cat,備註:t.note||"",金額:t.amount}));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(txRows.length?txRows:[{日期:"",類型:"",分類:"",備註:"",金額:""}]),"交易明細");

  // 月度彙總
  const mk=monthKeys(12);
  const sumRows=mk.map(m=>{
    const inc=DB.tx.filter(t=>t.type==="income"&&ym(t.date)===m).reduce((s,t)=>s+t.amount,0);
    const exp=DB.tx.filter(t=>t.type==="expense"&&ym(t.date)===m).reduce((s,t)=>s+t.amount,0);
    return {月份:m,收入:inc,支出:exp,結餘:inc-exp};
  });
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(sumRows),"月度彙總");

  // 預算
  const spent={};DB.tx.filter(t=>t.type==="expense"&&ym(t.date)===thisMonth).forEach(t=>spent[t.cat]=round2((spent[t.cat]||0)+t.amount));
  const budRows=Object.keys(DB.budget).map(c=>({分類:c,本月已花:spent[c]||0,預算上限:DB.budget[c],剩餘:DB.budget[c]-(spent[c]||0)}));
  if(budRows.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(budRows),"預算");

  // 資產
  if(DB.assets.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(DB.assets.map(a=>({項目:a.name,金額:a.val}))),"資產");

  // 投資
  if(DB.invest.length){
    const ivRows=DB.invest.map(v=>{const cost=v.qty*v.cost,mv=v.qty*v.now;return{標的:v.name,股數:v.qty,成本價:v.cost,現價:v.now,總成本:cost,市值:mv,損益:mv-cost,報酬率:(((mv-cost)/cost)*100).toFixed(1)+"%"};});
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(ivRows),"投資");
  }

  // 未來規劃
  if(DB.future.length){
    const repTxt={once:"單次",monthly:"每月",quarterly:"每季",yearly:"每年"};
    const fRows=DB.future.map(f=>({項目:f.name,分類:f.cat||"",類型:f.type==="income"?"收入":"支出",金額:f.amount,重複:repTxt[f.rep],起始日:f.date,結束日:f.end||""}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(fRows),"未來規劃");

    // 未來現金流月表
    const fmk=futureMonths(12);
    const flow=fmk.map(m=>{let inc=0,exp=0;DB.future.forEach(f=>{if(hitsMonth(f,m)){f.type==="income"?inc+=f.amount:exp+=f.amount;}});return{月份:m,預計收入:inc,預計支出:exp,當月需預留:exp-inc};});
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(flow),"未來現金流");
  }

  XLSX.writeFile(wb,"理財記帳本_"+todayStr()+".xlsx");
  toast(`已匯出 Excel（${DB.tx.length} 筆交易）`);
};

/* ---------------- 雲端設定頁 ---------------- */
function cfgMsg(t,ok){const m=$("cfgMsg");m.textContent=t;m.style.color=ok===false?"var(--danger)":ok?"var(--jade)":"var(--muted)";}
function readCfgForm(){
  const url=$("cfg-url").value.trim()||DEFAULT_URL;const key=$("cfg-key").value.trim();
  if(!key){showErr($("cfg-key"),"請輸入通行碼");return null;}
  if(!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)){$("cfgAdv").open=true;showErr($("cfg-url"),"網址格式不對：要是 https://script.google.com/…/exec 結尾",$("cfgUrlHint"));return null;}
  return{url,key};
}
$("cfg-url").value=CFG.url||"";$("cfg-key").value=CFG.key||"";
// 狀態列、按鈕文字與「進階」網址區塊的顯示
function renderCfg(){
  const on=cloudOn(),st=$("cfgStatus");
  if(!st)return;
  st.className="cfg-status"+(on?(SYNC.state==="err"?" err":" on"):"");
  st.innerHTML=on
    ?`<span aria-hidden="true">${SYNC.state==="err"?"⚠":"●"}</span><span>${esc(SYNC.txt||"已連接雲端")}<small>資料會自動同步到你的 Google Sheet</small></span>`
    :`<span aria-hidden="true">○</span><span>尚未連接雲端<small>${DEFAULT_URL?"輸入通行碼就能開始同步":"需要先填入 Apps Script 網址與通行碼"}</small></span>`;
  $("cfgSave").textContent=on?"更新並同步":"連接並同步";
  $("cfgClear").hidden=!on;
  const custom=!!CFG.url&&CFG.url!==DEFAULT_URL;
  $("cfgUrlHint").textContent=DEFAULT_URL&&!custom?"目前使用網站預設網址，通常不需要修改。":"";
  if(!DEFAULT_URL||custom)$("cfgAdv").open=true;
}
(()=>{let ls={};try{ls=JSON.parse(localStorage.getItem(LS_CFG)||"{}");}catch(e){}$("cfg-remember").checked=!!ls.key||!CFG.key;})();
$("cfgTest").onclick=async()=>{
  const c=readCfgForm();if(!c)return;
  cfgMsg("測試中…");
  try{const j=await api({action:"ping"},c);cfgMsg("連線成功 ✓ 試算表："+(j.sheet||""),true);}
  catch(e){cfgMsg("連線失敗："+e.message,false);}
};
$("cfgSave").onclick=async()=>{
  const c=readCfgForm();if(!c)return;
  cfgMsg("連線中…");
  let remote;
  try{remote=(await api({action:"get"},c)).data;}
  catch(e){cfgMsg("連線失敗："+e.message,false);return;}
  CFG=c;
  try{
    if($("cfg-remember").checked){localStorage.setItem(LS_CFG,JSON.stringify(CFG));sessionStorage.removeItem(LS_KEYS);}
    else{localStorage.setItem(LS_CFG,JSON.stringify({url:CFG.url}));sessionStorage.setItem(LS_KEYS,CFG.key);}
  }catch(err){}
  REMOTE_AT=(remote&&remote.updatedAt)||0;
  if(remote&&remote.tx!==undefined){
    const nLocal=DB.tx.length,nRemote=(remote.tx||[]).length;
    adoptMerged(mergeDB(DB,sanitizeDB(remote,todayStr())));
    await doSave();
    cfgMsg(`已連接雲端 ✓ 已合併雲端 ${nRemote} 筆與本機 ${nLocal} 筆記錄（共 ${DB.tx.length} 筆），沒有資料被覆蓋`,true);
  }else{
    DB.updatedAt=Date.now();saveLocal();await doSave();
    cfgMsg("已連接雲端 ✓",true);
  }
  renderCfg();
};
$("cfgClear").onclick=()=>{
  if(!confirm("中斷後資料只會存在這台裝置（雲端資料不會被刪除）。確定？"))return;
  CFG={};localStorage.removeItem(LS_CFG);try{sessionStorage.removeItem(LS_KEYS);}catch(err){}$("cfg-url").value=DEFAULT_URL;$("cfg-key").value="";
  cfgMsg("已中斷雲端");setSync("","已存在本機（未連接雲端）");renderCfg();
};
/* 備份與還原 */
$("bkExport").onclick=()=>{
  const blob=new Blob([JSON.stringify(DB,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="理財記帳本備份_"+todayStr()+".json";
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  toast(`已下載備份（${DB.tx.length} 筆記錄）`);
};
$("bkImport").onclick=()=>$("bkFile").click();
$("bkFile").onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  if(f.size>10e6){toast("檔案過大（超過 10 MB），不是有效的備份檔",true);$("bkFile").value="";return;}
  const r=new FileReader();
  r.onload=()=>{
    try{
      const d0=JSON.parse(r.result);
      if(!d0||!Array.isArray(d0.tx))throw 0;
      const d=sanitizeDB(d0,todayStr());
      if(!confirm(`備份檔含 ${d.tx.length} 筆記錄；目前有 ${DB.tx.length} 筆記錄，還原後會被取代（也會同步到雲端）。確定？`))return;
      restoreTombstones(DB,d);d.updatedAt=Date.now();
      applyDB(d);fillCats();fillFtCats();save();renderAll();toast("已還原");
    }catch(err){toast("這不是有效的備份檔",true);}
    $("bkFile").value="";
  };
  r.readAsText(f);
};

/* ---------------- 啟動：先讀本機，再跟雲端同步 ---------------- */
const CURS=[["$","$ 通用"],["NT$","NT$ 新台幣"],["US$","US$ 美元"],["¥","¥ 日圓／人民幣"],["€","€ 歐元"],["£","£ 英鎊"],["HK$","HK$ 港幣"]];
$("ui-cur").innerHTML=CURS.map(([v,l])=>`<option value="${v}">${l}</option>`).join("");
$("ui-cur").value=UI.cur||"$";
$("ui-cur").onchange=e=>{UI.cur=e.target.value;try{localStorage.setItem(UI_KEY,JSON.stringify(UI));}catch(_){}renderAll();refreshHints();toast("已更新貨幣符號為 "+e.target.value);};

// 所有表單：Enter 送出（由各自的送出按鈕處理）、行動裝置鍵盤顯示「下一個／完成」
document.querySelectorAll("form").forEach(f=>{
  f.addEventListener("submit",e=>e.preventDefault());
  f.querySelectorAll("button:not([type])").forEach(b=>b.type="button");
  const fields=[...f.querySelectorAll("input:not([type=hidden]):not([type=file]),select")];
  fields.forEach((x,i)=>{if(x.tagName==="INPUT")x.enterKeyHint=i===fields.length-1?"done":"next";});
});

function boot(){
  applyTheme();
  renderCfg();
  try{const local=JSON.parse(localStorage.getItem(LS_DB));if(local&&local.tx!==undefined)applyDB(local);}catch(e){}
  fillCats();fillFtCats();renderAll();updateTabStops();
  if(cloudOn())pull();
  else setSync("","已存在本機（到「雲端」分頁連接 Google Sheet）");
}
boot();

/* ---------------- PWA：離線快取 ---------------- */
if("serviceWorker" in navigator && location.protocol==="https:"){
  window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
