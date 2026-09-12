import React,{useEffect,useMemo,useState} from "react";
import * as XLSX from "xlsx";
import "./cashbookpro.css";

// ---------------------------------------------------------------------------
// CashBook Pro — a new module inside ISF Suite that mirrors the reference
// app's Business -> Books -> Entries structure (see /supabase/migration_v8_to_v9.sql
// for the cbp_* tables this screen reads/writes).
//
// It's rendered full-screen, phone-app style, on top of the rest of the app
// when appMode === "cashbookpro" (wired in main.jsx). It reuses the same
// Supabase session/business the rest of ISF Suite uses, so switching between
// this and Business Ledger / Cash Book keeps you logged into the same account
// and business.
// ---------------------------------------------------------------------------

const CBP_SUGGESTIONS=["Day Book","Investments","Project Book","Client Record"];
const CBP_DATE_PRESETS=["All Time","Today","Yesterday","This Month","Last Month","Single Day","Date Range"];
const CBP_ENTRY_TYPES=["All","Cash In","Cash Out"];

function cbpToday(){return new Date().toISOString().slice(0,10)}
function cbpPresetRange(preset){
  const t=cbpToday();
  if(preset==="Today")return{dateFrom:t,dateTo:t};
  if(preset==="Yesterday"){const d=new Date();d.setDate(d.getDate()-1);const s=d.toISOString().slice(0,10);return{dateFrom:s,dateTo:s}}
  if(preset==="This Month")return{dateFrom:t.slice(0,8)+"01",dateTo:t};
  if(preset==="Last Month"){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);const from=d.toISOString().slice(0,10);const end=new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10);return{dateFrom:from,dateTo:end}}
  return{dateFrom:"",dateTo:""};
}
function cbpMoney(n,symbol){return `${symbol||""}${new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(Number(n||0))}`}
function cbpTimeAgo(iso){
  if(!iso)return "";
  const d=new Date(iso),diff=(Date.now()-d.getTime())/1000;
  if(diff<60)return "Just now";
  if(diff<3600)return `Updated ${Math.max(1,Math.round(diff/60))} min ago`;
  if(diff<86400)return `Updated ${Math.round(diff/3600)} hours ago`;
  return `Updated on ${d.toLocaleDateString("en-US",{month:"short",day:"2-digit",year:"numeric"})}`;
}
const roleLabel=r=>r==="super_admin"?"Primary Admin":r==="admin"?"Admin":r==="pending"?"Pending":"Employee";

export default function CashBookPro({supabase,session,profile,businesses,businessId,setBusinessId,onExit}){
  const business=useMemo(()=>businesses.find(b=>b.id===businessId)||null,[businesses,businessId]);
  const symbol=business?.currency==="BDT"?"৳":(business?.currency||"");
  const myEmail=session?.user?.email||profile?.email||"";

  const [tab,setTab]=useState("cashbooks"); // cashbooks | help | settings
  const [screen,setScreen]=useState("books"); // books|addbook|book|filters|duplicate|activity
  const [settingsScreen,setSettingsScreen]=useState("main"); // main|team|profile|appsettings
  const [toast,setToast]=useState("");
  const [dark,setDark]=useState(()=>(typeof localStorage!=="undefined"&&localStorage.getItem("cbp_dark")==="1"));
  const [appLock,setAppLock]=useState(()=>(typeof localStorage!=="undefined"&&localStorage.getItem("cbp_applock")==="1"));
  const [groupNotif,setGroupNotif]=useState(()=>(typeof localStorage!=="undefined"?localStorage.getItem("cbp_groupnotif")!=="0":true));
  const [calcField,setCalcField]=useState(()=>(typeof localStorage!=="undefined"&&localStorage.getItem("cbp_calc")==="1"));

  const [books,setBooks]=useState([]);
  const [myRole,setMyRole]=useState("");
  const [activeBook,setActiveBook]=useState(null);
  const [entries,setEntries]=useState([]);
  const [categories,setCategories]=useState([]);
  const [paymentModes,setPaymentModes]=useState([]);
  const [members,setMembers]=useState([]);
  const [activity,setActivity]=useState([]);
  const [opening,setOpening]=useState(0);
  const [kebabOpen,setKebabOpen]=useState(false);
  const [entrySheet,setEntrySheet]=useState(null); // {type:'in'|'out'}
  const [entryForm,setEntryForm]=useState({entry_date:cbpToday(),category:"",payment_mode:"Cash",amount:"",remark:""});
  const [newBookName,setNewBookName]=useState("");
  const [newBookAccess,setNewBookAccess]=useState("just_me");
  const [dupForm,setDupForm]=useState({name:"",members:true,categories:true,paymentModes:true,contacts:true});
  const [bookMenuFor,setBookMenuFor]=useState(null);
  const [filters,setFilters]=useState({preset:"Today",dateFrom:cbpToday(),dateTo:cbpToday(),type:"All",member:"",category:"",paymentMode:"",openingBalance:true});
  const [filterTab,setFilterTab]=useState("Date");
  const [roleModal,setRoleModal]=useState(null); // member row being viewed
  const [roleModalTab,setRoleModalTab]=useState("primary");
  const [profileForm,setProfileForm]=useState(null);
  const [profileTab,setProfileTab]=useState("Basics");

  const say=m=>{setToast(m);setTimeout(()=>setToast(""),2200)};

  const fullAccess=myRole==="super_admin"||myRole==="admin";

  useEffect(()=>{if(typeof localStorage!=="undefined")localStorage.setItem("cbp_dark",dark?"1":"0")},[dark]);
  useEffect(()=>{if(typeof localStorage!=="undefined")localStorage.setItem("cbp_applock",appLock?"1":"0")},[appLock]);
  useEffect(()=>{if(typeof localStorage!=="undefined")localStorage.setItem("cbp_groupnotif",groupNotif?"1":"0")},[groupNotif]);
  useEffect(()=>{if(typeof localStorage!=="undefined")localStorage.setItem("cbp_calc",calcField?"1":"0")},[calcField]);

  // ---- data loaders --------------------------------------------------
  async function loadBooks(){
    if(!businessId)return;
    const {data:bm}=await supabase.from("business_members").select("role").eq("business_id",businessId).eq("user_id",session.user.id).maybeSingle();
    setMyRole(bm?.role||"");
    const {data,error}=await supabase.from("cbp_books").select("*").eq("business_id",businessId).eq("archived",false).order("created_at",{ascending:false});
    if(error){say(error.message);return}
    const withTotals=await Promise.all((data||[]).map(async b=>{
      const {data:rows}=await supabase.from("cbp_entries").select("type,amount").eq("book_id",b.id);
      const net=(rows||[]).reduce((s,r)=>s+(r.type==="in"?Number(r.amount):-Number(r.amount)),0);
      return {...b,net};
    }));
    setBooks(withTotals);
  }
  useEffect(()=>{loadBooks();setScreen("books")},[businessId]); // eslint-disable-line

  async function loadCategoriesAndModes(){
    const [{data:cats},{data:modes},{data:mems}]=await Promise.all([
      supabase.from("cbp_categories").select("*").eq("business_id",businessId).order("name"),
      supabase.from("cbp_payment_modes").select("*").eq("business_id",businessId).order("name"),
      supabase.from("business_members").select("id,role,user_id,profiles(full_name,email)").eq("business_id",businessId),
    ]);
    setCategories(cats||[]);
    setPaymentModes((modes&&modes.length)?modes:[{id:"cash",name:"Cash"},{id:"bank",name:"Bank"},{id:"online",name:"Online"}]);
    setMembers(mems||[]);
  }

  async function openBook(book){
    setActiveBook(book);
    setScreen("book");
    setFilters(f=>({...f,preset:"Today",...cbpPresetRange("Today")}));
    await loadCategoriesAndModes();
    await loadEntries(book.id,{preset:"Today",...cbpPresetRange("Today")});
    const {data:ob}=await supabase.from("cbp_opening_balances").select("amount").eq("book_id",book.id).order("balance_date",{ascending:false}).limit(1).maybeSingle();
    setOpening(Number(ob?.amount||0));
  }

  async function loadEntries(bookId,f){
    f=f||filters;
    let q=supabase.from("cbp_entries").select("*").eq("book_id",bookId).order("entry_date",{ascending:false}).order("created_at",{ascending:false});
    if(f.dateFrom)q=q.gte("entry_date",f.dateFrom);
    if(f.dateTo)q=q.lte("entry_date",f.dateTo);
    if(f.type==="Cash In")q=q.eq("type","in");
    if(f.type==="Cash Out")q=q.eq("type","out");
    if(f.category)q=q.eq("category",f.category);
    if(f.paymentMode)q=q.eq("payment_mode",f.paymentMode);
    const {data,error}=await q;
    if(error){say(error.message);return}
    setEntries(data||[]);
  }

  async function loadActivity(bookId){
    const {data}=await supabase.from("cbp_book_activity").select("*").eq("book_id",bookId).order("created_at",{ascending:false}).limit(100);
    setActivity(data||[]);
  }

  function logActivity(bookId,action,details){
    supabase.from("cbp_book_activity").insert({book_id:bookId,user_email:myEmail,action,details:details||null});
  }

  // ---- actions ---------------------------------------------------------
  async function createBook(name,access){
    if(!name.trim())return say("Enter a book name");
    const {data,error}=await supabase.from("cbp_books").insert({business_id:businessId,name:name.trim(),access_mode:access,created_by:session.user.id}).select().single();
    if(error)return say(error.message);
    logActivity(data.id,"Book created",`by ${myEmail}`);
    say("Book created");
    setNewBookName("");setNewBookAccess("just_me");
    await loadBooks();
    openBook({...data,net:0});
  }

  async function duplicateBook(){
    if(!dupForm.name.trim())return say("Enter a new book name");
    const {data:nb,error}=await supabase.from("cbp_books").insert({business_id:businessId,name:dupForm.name.trim(),access_mode:activeBook.access_mode,created_by:session.user.id}).select().single();
    if(error)return say(error.message);
    // Categories, payment modes and contacts already live at the business
    // level (shared across every book), so ticking those boxes needs no
    // extra copy step — only per-book membership would need copying, and
    // Employee book access can be added from Business Team once created.
    logActivity(nb.id,"Book duplicated",`from ${activeBook.name}`);
    say("New book created");
    setDupForm({name:"",members:true,categories:true,paymentModes:true,contacts:true});
    await loadBooks();
    openBook({...nb,net:0});
  }

  async function renameBook(book){
    const name=prompt("Rename book",book.name);
    if(!name||!name.trim())return;
    const {error}=await supabase.from("cbp_books").update({name:name.trim()}).eq("id",book.id);
    if(error)return say(error.message);
    say("Book renamed");
    loadBooks();
  }
  async function deleteBook(book){
    if(!confirm(`Delete "${book.name}" and all its entries? This can't be undone.`))return;
    const {error}=await supabase.from("cbp_books").delete().eq("id",book.id);
    if(error)return say(error.message);
    say("Book deleted");
    setBookMenuFor(null);
    loadBooks();
  }
  async function deleteAllEntries(){
    if(!confirm(`Delete ALL entries in "${activeBook.name}"? This can't be undone.`))return;
    const {error}=await supabase.from("cbp_entries").delete().eq("book_id",activeBook.id);
    if(error)return say(error.message);
    logActivity(activeBook.id,"All entries deleted");
    say("All entries deleted");
    setKebabOpen(false);
    loadEntries(activeBook.id);
    loadBooks();
  }

  async function saveEntry(){
    const amt=Number(entryForm.amount);
    if(!amt||amt<=0)return say("Enter a valid amount");
    const payload={book_id:activeBook.id,entry_date:entryForm.entry_date,type:entrySheet.type,amount:amt,category:entryForm.category||null,payment_mode:entryForm.payment_mode||"Cash",remark:entryForm.remark||null,created_by:session.user.id};
    const {error}=await supabase.from("cbp_entries").insert(payload);
    if(error)return say(error.message);
    logActivity(activeBook.id,entrySheet.type==="in"?"Cash In added":"Cash Out added",`${symbol}${amt}`);
    say("Entry saved");
    setEntrySheet(null);
    setEntryForm({entry_date:cbpToday(),category:"",payment_mode:"Cash",amount:"",remark:""});
    loadEntries(activeBook.id);
    loadBooks();
  }

  async function deleteEntry(id){
    if(!confirm("Delete this entry?"))return;
    const {error}=await supabase.from("cbp_entries").delete().eq("id",id);
    if(error)return say(error.message);
    loadEntries(activeBook.id);
    loadBooks();
  }

  function applyFilters(){
    setScreen("book");
    loadEntries(activeBook.id,filters);
  }
  function clearFilters(){
    const f={preset:"Today",...cbpPresetRange("Today"),type:"All",member:"",category:"",paymentMode:"",openingBalance:true};
    setFilters(f);
    loadEntries(activeBook.id,f);
    setScreen("book");
  }

  async function updateMemberRole(memberId,newRole){
    const {error}=await supabase.from("business_members").update({role:newRole}).eq("id",memberId);
    if(error)return say(error.message);
    say("Role updated");
    setRoleModal(null);
    loadCategoriesAndModes();
  }

  function openBusinessProfile(){
    setProfileForm({name:business?.name||"",address:business?.profile_meta?.address||"",employee_size:business?.profile_meta?.employee_size||"",category:business?.profile_meta?.category||"Other",subcategory:business?.profile_meta?.subcategory||"",biz_type:business?.profile_meta?.biz_type||"",registration_type:business?.profile_meta?.registration_type||"",mobile:business?.profile_meta?.mobile||"",email:business?.profile_meta?.email||""});
    setProfileTab("Basics");
    setSettingsScreen("profile");
  }
  async function saveBusinessProfile(){
    const {name,...meta}=profileForm;
    const {error}=await supabase.from("businesses").update({name,profile_meta:meta}).eq("id",businessId);
    if(error)return say(error.message);
    say("Business profile saved");
  }

  function exportExcel(){
    const rows=entries.map(e=>({Date:e.entry_date,Type:e.type==="in"?"Cash In":"Cash Out",Category:e.category||"",Mode:e.payment_mode||"",Amount:e.amount,Remark:e.remark||""}));
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Entries");
    XLSX.writeFile(wb,`${activeBook.name.replace(/\s+/g,"_")}_report.xlsx`);
    setKebabOpen(false);
  }

  const totals=useMemo(()=>{
    const totalIn=entries.filter(e=>e.type==="in").reduce((s,e)=>s+Number(e.amount),0);
    const totalOut=entries.filter(e=>e.type==="out").reduce((s,e)=>s+Number(e.amount),0);
    return {totalIn,totalOut,net:filters.openingBalance?opening+totalIn-totalOut:totalIn-totalOut};
  },[entries,opening,filters.openingBalance]);

  const groupedEntries=useMemo(()=>{
    const g={};
    entries.forEach(e=>{(g[e.entry_date]=g[e.entry_date]||[]).push(e)});
    return Object.entries(g).sort((a,b)=>b[0]<a[0]?-1:1);
  },[entries]);

  // ---- small presentational bits ---------------------------------------
  function TopBar({title,subtitle,onBack,right}){
    return <div className="cbp-topbar">
      {onBack&&<button className="cbp-back" onClick={onBack}>←</button>}
      <div className="cbp-topbar-title"><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>
      <div className="cbp-topbar-actions">{right}</div>
    </div>;
  }
  function BottomNav(){
    return <div className="cbp-bottomnav">
      <button className={"cbp-navbtn"+(tab==="cashbooks"?" active":"")} onClick={()=>{setTab("cashbooks");setScreen("books")}}><span className="cbp-navicon">📗</span>Cashbooks</button>
      <button className={"cbp-navbtn"+(tab==="help"?" active":"")} onClick={()=>setTab("help")}><span className="cbp-navicon">❓</span>Help</button>
      <button className={"cbp-navbtn"+(tab==="settings"?" active":"")} onClick={()=>{setTab("settings");setSettingsScreen("main")}}><span className="cbp-navicon">⚙️</span>Settings</button>
    </div>;
  }

  // ---- screens: Books list ----------------------------------------------
  function BooksListScreen(){
    return <>
      <TopBar title={business?.name||"Business"} subtitle="Tap to switch business" right={<button className="cbp-icon-btn" onClick={()=>setSettingsScreen("team")||setTab("settings")}>＋👤</button>}/>
      <div className="cbp-body">
        {books.map(b=><div key={b.id} className="cbp-booklist-row" style={{position:"relative"}}>
          <div onClick={()=>openBook(b)} style={{display:"flex",alignItems:"center",gap:12,flex:1,minWidth:0}}>
            <div className="cbp-book-icon">📘</div>
            <div className="cbp-book-main"><b>{b.name}</b><span>{cbpTimeAgo(b.created_at)}</span></div>
          </div>
          <div className="cbp-book-bal" style={{color:b.net<0?"#dc2626":"#16a34a"}}>{cbpMoney(b.net,symbol)}</div>
          <button className="cbp-kebab" onClick={()=>setBookMenuFor(bookMenuFor===b.id?null:b.id)}>⋮</button>
          {bookMenuFor===b.id&&<div className="cbp-menu" style={{top:44,right:8}} onMouseLeave={()=>setBookMenuFor(null)}>
            <div className="cbp-menu-item" onClick={()=>{setBookMenuFor(null);renameBook(b)}}>✏️ Rename</div>
            <div className="cbp-menu-item" onClick={()=>{setBookMenuFor(null);setActiveBook(b);setDupForm({name:"",members:true,categories:true,paymentModes:true,contacts:true});openBook(b).then(()=>setScreen("duplicate"))}}>🧬 Duplicate</div>
            <div className="cbp-menu-item danger" onClick={()=>deleteBook(b)}>🗑️ Delete</div>
          </div>}
        </div>)}
        <div className="cbp-addnew-card">
          <b>Add New Book</b>
          <p>Click to quickly add books for</p>
          <div className="cbp-chips">
            {CBP_SUGGESTIONS.map(s=><button key={s} className="cbp-chip-suggest" onClick={()=>{setNewBookName(s);setScreen("addbook")}}>{s}</button>)}
          </div>
        </div>
      </div>
      <button className="cbp-fab" onClick={()=>{setNewBookName("");setScreen("addbook")}}>＋</button>
      <BottomNav/>
    </>;
  }

  function AddBookScreen(){
    return <>
      <TopBar title="Add new book" onBack={()=>setScreen("books")}/>
      <div className="cbp-body">
        <div className="cbp-field">
          <label>Enter book name</label>
          <input className="cbp-input" value={newBookName} onChange={e=>setNewBookName(e.target.value)} placeholder="e.g. Day Book"/>
        </div>
        <div className="cbp-chips" style={{margin:"0 16px 20px"}}>
          {CBP_SUGGESTIONS.map(s=><button key={s} className={"cbp-chip-suggest"+(newBookName===s?" active":"")} onClick={()=>setNewBookName(s)}>{s}</button>)}
        </div>
        <div style={{padding:"0 16px",fontWeight:700,marginBottom:10}}>Who can access this book?</div>
        <div className="cbp-access-grid">
          <div className={"cbp-access-opt"+(newBookAccess==="just_me"?" active":"")} onClick={()=>setNewBookAccess("just_me")}><span className="cbp-access-icon">🙋</span>Just me</div>
          <div className={"cbp-access-opt"+(newBookAccess==="team"?" active":"")} onClick={()=>setNewBookAccess("team")}><span className="cbp-access-icon">👥</span>With team/family</div>
        </div>
        <div className="cbp-notice">ℹ️ Admins and members added to this book will get access to this book.</div>
        <button className="cbp-primary-btn" onClick={()=>createBook(newBookName,newBookAccess)}>Create book</button>
      </div>
    </>;
  }

  function DuplicateBookScreen(){
    return <>
      <TopBar title="Duplicate Book" onBack={()=>setScreen("book")}/>
      <div className="cbp-body">
        <div className="cbp-notice">ℹ️ Create new book with same settings as <b>&nbsp;{activeBook.name}</b></div>
        <div style={{padding:"0 16px",fontWeight:800,marginBottom:10}}>Step 1: Choose New Book Name</div>
        <div className="cbp-field"><input className="cbp-input" placeholder="Enter New Book Name" value={dupForm.name} onChange={e=>setDupForm({...dupForm,name:e.target.value})}/></div>
        <div style={{padding:"0 16px",fontWeight:800,margin:"6px 0 10px"}}>Step 2: Choose settings to duplicate</div>
        {[["members","Members & Roles"],["categories","Categories"],["paymentModes","Payment Modes"],["contacts","Contact Settings"]].map(([k,label])=>
          <label key={k} className="cbp-checkrow"><input type="checkbox" checked={dupForm[k]} onChange={e=>setDupForm({...dupForm,[k]:e.target.checked})}/>{label}</label>
        )}
        <button className="cbp-primary-btn" disabled={!dupForm.name.trim()} onClick={duplicateBook}>Add new book</button>
      </div>
    </>;
  }

  // ---- Day Book detail ----------------------------------------------------
  function DayBookScreen(){
    return <>
      <TopBar title={activeBook.name} subtitle="Tap here for Book settings" onBack={()=>setScreen("books")}
        right={<>
          <button className="cbp-icon-btn" title="Add member">👤＋</button>
          <button className="cbp-icon-btn" title="PDF report" onClick={exportExcel}>📄</button>
          <div style={{position:"relative"}}>
            <button className="cbp-icon-btn" onClick={()=>setKebabOpen(k=>!k)}>⋮</button>
            {kebabOpen&&<div className="cbp-menu">
              <div className="cbp-menu-item" onClick={()=>{setKebabOpen(false);say("Book settings coming soon")}}>📑 Book Settings</div>
              <div className="cbp-menu-item" onClick={()=>{setKebabOpen(false);loadActivity(activeBook.id);setScreen("activity")}}>🕘 Book Activity</div>
              <div className="cbp-menu-item" onClick={()=>{setKebabOpen(false);setDupForm({name:"",members:true,categories:true,paymentModes:true,contacts:true});setScreen("duplicate")}}>🧬 Duplicate Book</div>
              <div className="cbp-menu-item danger" onClick={deleteAllEntries}>🗑️ Delete All Entries</div>
              <div className="cbp-menu-item" onClick={exportExcel}>📊 Excel Report</div>
            </div>}
          </div>
        </>}/>
      <div className="cbp-body" onClick={()=>kebabOpen&&setKebabOpen(false)}>
        <div className="cbp-card cbp-summary">
          <div className="cbp-summary-row"><span>Net Balance</span><span>{cbpMoney(totals.net,symbol)}</span></div>
          {filters.openingBalance&&<div className="cbp-sub"><span>Opening Balance</span><span>{cbpMoney(opening,symbol)}</span></div>}
          <div className="cbp-sub"><span>Total In (+)</span><span className="cbp-in">{cbpMoney(totals.totalIn,symbol)}</span></div>
          <div className="cbp-sub"><span>Total Out (-)</span><span className="cbp-out">{cbpMoney(totals.totalOut,symbol)}</span></div>
          <div className="cbp-view-reports" onClick={exportExcel}>View Reports ›</div>
        </div>

        <div className="cbp-filterbar">
          <div className="cbp-fchip" onClick={()=>{setFilterTab("Date");setScreen("filters")}}>☰ Filters {(filters.category||filters.paymentMode||filters.type!=="All")&&<span className="cbp-badge">•</span>}</div>
          <div className={"cbp-fchip active"} onClick={()=>{setFilterTab("Date");setScreen("filters")}}>📅 {filters.preset||"Date"}</div>
          <div className="cbp-fchip" onClick={()=>{setFilterTab("Entry Type");setScreen("filters")}}>Entry Type ⌄</div>
          <div className="cbp-fchip" onClick={()=>{setFilterTab("Members");setScreen("filters")}}>Members ⌄</div>
        </div>

        {groupedEntries.length===0?
          <div className="cbp-empty">Add your first entry<div className="cbp-arrow">↓</div></div>
        :groupedEntries.map(([date,rows])=><div key={date}>
          <div className="cbp-daylabel">{new Date(date+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",day:"2-digit",month:"short"})}</div>
          {rows.map(e=><div key={e.id} className="cbp-entry" onClick={()=>deleteEntry(e.id)}>
            <div className="cbp-entry-left"><b>{e.category||(e.type==="in"?"Cash In":"Cash Out")}</b><span>{e.payment_mode}{e.remark?` • ${e.remark}`:""}</span></div>
            <div className="cbp-entry-amt" style={{color:e.type==="in"?"#16a34a":"#dc2626"}}>{e.type==="in"?"+":"-"}{cbpMoney(e.amount,symbol)}</div>
          </div>)}
        </div>)}
      </div>
      <div className="cbp-record-labels"><span style={{color:"#16a34a"}}>Record Income</span><span style={{color:"#dc2626"}}>Record Expense</span></div>
      <div className="cbp-actionbar">
        <button className="cbp-btn-in" onClick={()=>setEntrySheet({type:"in"})}>＋ Cash In</button>
        <button className="cbp-btn-out" onClick={()=>setEntrySheet({type:"out"})}>− Cash Out</button>
      </div>
    </>;
  }

  function EntrySheet(){
    if(!entrySheet)return null;
    return <div className="cbp-overlay" onClick={()=>setEntrySheet(null)}>
      <div className="cbp-sheet" onClick={e=>e.stopPropagation()}>
        <div className="cbp-sheet-head"><h3>{entrySheet.type==="in"?"Record Income (Cash In)":"Record Expense (Cash Out)"}</h3><button className="cbp-sheet-close" onClick={()=>setEntrySheet(null)}>✕</button></div>
        <div className="cbp-field"><label>Date</label><input type="date" className="cbp-input" value={entryForm.entry_date} onChange={e=>setEntryForm({...entryForm,entry_date:e.target.value})}/></div>
        <div className="cbp-field"><label>Amount</label><input type="number" className="cbp-input" placeholder="0.00" value={entryForm.amount} onChange={e=>setEntryForm({...entryForm,amount:e.target.value})}/></div>
        <div className="cbp-field"><label>Category</label>
          <select className="cbp-select" value={entryForm.category} onChange={e=>setEntryForm({...entryForm,category:e.target.value})}>
            <option value="">Select category</option>
            {categories.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
            <option value="General">General</option>
          </select>
        </div>
        <div className="cbp-field"><label>Payment Mode</label>
          <select className="cbp-select" value={entryForm.payment_mode} onChange={e=>setEntryForm({...entryForm,payment_mode:e.target.value})}>
            {paymentModes.map(m=><option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div className="cbp-field"><label>Remark</label><input className="cbp-input" placeholder="Add a note" value={entryForm.remark} onChange={e=>setEntryForm({...entryForm,remark:e.target.value})}/></div>
        <button className="cbp-primary-btn" onClick={saveEntry}>Save {entrySheet.type==="in"?"Cash In":"Cash Out"}</button>
      </div>
    </div>;
  }

  // ---- Filters full screen -------------------------------------------
  function FiltersScreen(){
    const tabs=["Date","Entry Type","Members","Contact","Category","Payment Mode"];
    return <>
      <TopBar title="Filters" onBack={()=>setScreen("book")}/>
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        <div style={{width:118,borderRight:"1px solid #eef0f4",overflowY:"auto"}}>
          {tabs.map(t=><div key={t} onClick={()=>setFilterTab(t)} style={{padding:"16px 10px",fontWeight:700,fontSize:13.5,cursor:"pointer",background:filterTab===t?"#eef0ff":"transparent",color:filterTab===t?"#4338ca":"#334155",borderLeft:filterTab===t?"3px solid #5b5fef":"3px solid transparent"}}>{t}</div>)}
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"6px 16px"}}>
          {filterTab==="Date"&&CBP_DATE_PRESETS.map(p=>
            <label key={p} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 4px",fontWeight:filters.preset===p?800:500,background:filters.preset===p?"#eef0ff":"transparent",borderRadius:10,cursor:"pointer"}}>
              <input type="radio" checked={filters.preset===p} onChange={()=>setFilters({...filters,preset:p,...cbpPresetRange(p)})}/>{p}
            </label>)}
          {filterTab==="Date"&&filters.preset==="Date Range"&&<div style={{display:"flex",gap:8,marginTop:8}}>
            <input type="date" className="cbp-input" value={filters.dateFrom} onChange={e=>setFilters({...filters,dateFrom:e.target.value})}/>
            <input type="date" className="cbp-input" value={filters.dateTo} onChange={e=>setFilters({...filters,dateTo:e.target.value})}/>
          </div>}
          {filterTab==="Entry Type"&&CBP_ENTRY_TYPES.map(t=>
            <label key={t} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 4px",cursor:"pointer"}}>
              <input type="radio" checked={filters.type===t} onChange={()=>setFilters({...filters,type:t})}/>{t}
            </label>)}
          {filterTab==="Members"&&(members.length?members.map(m=>
            <label key={m.id} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 4px",cursor:"pointer"}}>
              <input type="radio" checked={filters.member===m.id} onChange={()=>setFilters({...filters,member:m.id})}/>{m.profiles?.full_name||m.profiles?.email||"Member"}
            </label>):<p className="muted">No members yet</p>)}
          {filterTab==="Contact"&&<p className="muted">No contacts tagged yet.</p>}
          {filterTab==="Category"&&(categories.length?categories.map(c=>
            <label key={c.id} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 4px",cursor:"pointer"}}>
              <input type="radio" checked={filters.category===c.name} onChange={()=>setFilters({...filters,category:c.name})}/>{c.name}
            </label>):<p className="muted">No categories yet</p>)}
          {filterTab==="Payment Mode"&&paymentModes.map(m=>
            <label key={m.id} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 4px",cursor:"pointer"}}>
              <input type="radio" checked={filters.paymentMode===m.name} onChange={()=>setFilters({...filters,paymentMode:m.name})}/>{m.name}
            </label>)}
        </div>
      </div>
      <label className="cbp-checkrow" style={{margin:"10px 16px"}}>
        <input type="checkbox" checked={filters.openingBalance} onChange={e=>setFilters({...filters,openingBalance:e.target.checked})}/>Add opening balance
      </label>
      <div style={{display:"flex",gap:12,padding:"10px 16px 20px"}}>
        <button className="cbp-secondary-btn" onClick={clearFilters}>✕ Clear all</button>
        <button className="cbp-primary-btn" style={{margin:0,flex:1}} onClick={applyFilters}>Apply</button>
      </div>
    </>;
  }

  function ActivityScreen(){
    return <>
      <TopBar title="Book Activity" onBack={()=>setScreen("book")}/>
      <div className="cbp-body">
        {activity.length===0&&<p className="muted" style={{padding:16}}>No activity recorded yet.</p>}
        {activity.map(a=><div key={a.id} className="cbp-entry"><div className="cbp-entry-left"><b>{a.action}</b><span>{a.user_email} • {new Date(a.created_at).toLocaleString()}</span></div></div>)}
      </div>
    </>;
  }

  // ---- Settings tab ------------------------------------------------------
  function SettingsMainScreen(){
    return <>
      <div className="cbp-pad" style={{paddingTop:20}}><h2 style={{margin:0}}>Settings</h2></div>
      <div className="cbp-body">
        <div className="cbp-settingsrow" onClick={()=>setSettingsScreen("team")}>
          <div className="cbp-si">👥</div><div className="cbp-settingsrow-main"><b>Business Team</b><span>Add, remove or change role</span></div><span>›</span>
        </div>
        <div className="cbp-settingsrow" onClick={()=>say("No pending move-book requests")}>
          <div className="cbp-si">📥</div><div className="cbp-settingsrow-main"><b>Move Book Requests</b><span>Approve or deny requests</span></div><span>›</span>
        </div>
        <div className="cbp-settingsrow" onClick={openBusinessProfile}>
          <div className="cbp-si">🏢</div><div className="cbp-settingsrow-main"><b>Business Settings</b><span>Settings specific to this business</span></div><span>›</span>
        </div>
        <div className="cbp-section-title">General Settings</div>
        <div className="cbp-settingsrow" onClick={()=>setSettingsScreen("appsettings")}>
          <div className="cbp-si">📱</div><div className="cbp-settingsrow-main"><b>App Settings</b><span>Language, Theme, Security, Backup</span></div><span>›</span>
        </div>
        <div className="cbp-settingsrow" onClick={()=>say(myEmail)}>
          <div className="cbp-si">👤</div><div className="cbp-settingsrow-main"><b>Your Profile</b><span>Name, Mobile Number, Email</span></div><span>›</span>
        </div>
        <div className="cbp-settingsrow" onClick={onExit}>
          <div className="cbp-si">↩️</div><div className="cbp-settingsrow-main"><b>Exit CashBook Pro</b><span>Back to ISF Suite app chooser</span></div><span>›</span>
        </div>
      </div>
      <BottomNav/>
    </>;
  }

  function BusinessTeamScreen(){
    return <>
      <TopBar title="Business Team" onBack={()=>setSettingsScreen("main")}/>
      <div className="cbp-body">
        <div className="cbp-section-title">Primary Admin/Admin ({members.filter(m=>m.role==="super_admin"||m.role==="admin").length})</div>
        {members.filter(m=>m.role==="super_admin"||m.role==="admin").map(m=>
          <div key={m.id} className="cbp-entry" onClick={()=>{setRoleModal(m);setRoleModalTab(m.role==="super_admin"?"primary":"admin")}}>
            <div className="cbp-entry-left"><b>{m.profiles?.full_name||m.profiles?.email}{m.user_id===session.user.id?" (You)":""}</b><span>{m.profiles?.email}</span></div>
            <span style={{color:m.role==="super_admin"?"#166534":"#9a3412",fontWeight:700,fontSize:13}}>{roleLabel(m.role)} ›</span>
          </div>)}
        <div className="cbp-section-title">Employees ({members.filter(m=>!["super_admin","admin"].includes(m.role)).length})</div>
        {members.filter(m=>!["super_admin","admin"].includes(m.role)).map(m=>
          <div key={m.id} className="cbp-entry" onClick={()=>{setRoleModal(m);setRoleModalTab("employee")}}>
            <div className="cbp-entry-left"><b>{m.profiles?.full_name||m.profiles?.email}</b><span>{m.profiles?.email}</span></div>
            <span style={{color:"#1d4ed8",fontWeight:700,fontSize:13}}>{roleLabel(m.role)} ›</span>
          </div>)}
        {members.length<=1&&<p className="muted" style={{padding:16}}>Invite teammates from "Add member" on a book, or here once invites are set up.</p>}
      </div>
    </>;
  }

  function RolesModal(){
    if(!roleModal)return null;
    return <div className="cbp-overlay" onClick={()=>setRoleModal(null)}>
      <div className="cbp-sheet" onClick={e=>e.stopPropagation()}>
        <div className="cbp-sheet-head"><h3>Roles and Permissions</h3><button className="cbp-sheet-close" onClick={()=>setRoleModal(null)}>✕</button></div>
        <div className="cbp-roletabs">
          <div className={"cbp-roletab"+(roleModalTab==="primary"?" active-primary":"")} onClick={()=>roleModal.role==="super_admin"&&setRoleModalTab("primary")}>Primary Admin{roleModal.user_id===session.user.id?" (You)":""}</div>
          <div className={"cbp-roletab"+(roleModalTab==="admin"?" active-admin":"")} onClick={()=>fullAccess&&roleModal.role!=="super_admin"&&setRoleModalTab("admin")}>Admin</div>
          <div className={"cbp-roletab"+(roleModalTab==="employee"?" active-employee":"")} onClick={()=>fullAccess&&roleModal.role!=="super_admin"&&setRoleModalTab("employee")}>Employee</div>
        </div>
        {roleModalTab==="primary"&&<div className="cbp-notice">ℹ️ Every business can have only one primary admin</div>}
        <div className="cbp-permbox">
          <h4>Permissions</h4>
          {roleModalTab==="employee"?<>
            <div className="cbp-permrow"><span className="cbp-perm-yes">✓</span>Limited access to selected books</div>
            <div className="cbp-permrow"><span className="cbp-perm-yes">✓</span>Primary Admin/Admin can assign Book Admin, Viewer or Data Operator role to Employee in any book</div>
            <h4 style={{marginTop:14}}>Restrictions</h4>
            <div className="cbp-permrow"><span className="cbp-perm-no">✕</span>No access to books they are not part of</div>
            <div className="cbp-permrow"><span className="cbp-perm-no">✕</span>No access to business settings</div>
            <div className="cbp-permrow"><span className="cbp-perm-no">✕</span>No option to delete books</div>
          </>:<>
            <div className="cbp-permrow"><span className="cbp-perm-yes">✓</span>Full access to all books of this business</div>
            <div className="cbp-permrow"><span className="cbp-perm-yes">✓</span>Full access to business settings</div>
            <div className="cbp-permrow"><span className="cbp-perm-yes">✓</span>Add/remove members in business</div>
            {roleModalTab==="admin"&&<>
              <h4 style={{marginTop:14}}>Restrictions</h4>
              <div className="cbp-permrow"><span className="cbp-perm-no">✕</span>Can't delete business</div>
              <div className="cbp-permrow"><span className="cbp-perm-no">✕</span>Can't remove primary admin from business</div>
            </>}
          </>}
        </div>
        {fullAccess&&roleModal.role!=="super_admin"&&roleModalTab!==roleModal.role&&
          <button className="cbp-primary-btn" onClick={()=>updateMemberRole(roleModal.id,roleModalTab==="admin"?"admin":"member")}>Save as {roleModalTab==="admin"?"Admin":"Employee"}</button>}
        <button className="cbp-primary-btn" style={roleModalTab!==roleModal.role||!fullAccess?{}:{}} onClick={()=>setRoleModal(null)}>Ok, got it</button>
      </div>
    </div>;
  }

  function BusinessProfileScreen(){
    if(!profileForm)return null;
    return <>
      <TopBar title="Business Profile" onBack={()=>setSettingsScreen("main")}/>
      <div className="cbp-tabs">
        {["Basics","Business Info","Communication"].map(t=><div key={t} className={"cbp-tab"+(profileTab===t?" active":"")} onClick={()=>setProfileTab(t)}>{t}</div>)}
      </div>
      <div className="cbp-body">
        {profileTab==="Basics"&&<>
          <div className="cbp-field"><label>Business Name</label><input className="cbp-input" value={profileForm.name} onChange={e=>setProfileForm({...profileForm,name:e.target.value})}/></div>
          <div className="cbp-field"><label>Business address</label><input className="cbp-input" value={profileForm.address} onChange={e=>setProfileForm({...profileForm,address:e.target.value})}/></div>
          <div className="cbp-field"><label>Employee Size</label>
            <select className="cbp-select" value={profileForm.employee_size} onChange={e=>setProfileForm({...profileForm,employee_size:e.target.value})}>
              {["1-5","6-20","20+"].map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
        </>}
        {profileTab==="Business Info"&&<>
          <div className="cbp-field"><label>Business Category</label><input className="cbp-input" value={profileForm.category} onChange={e=>setProfileForm({...profileForm,category:e.target.value})}/></div>
          <div className="cbp-field"><label>Business Subcategory</label><input className="cbp-input" value={profileForm.subcategory} onChange={e=>setProfileForm({...profileForm,subcategory:e.target.value})}/></div>
          <div className="cbp-field"><label>Business Type</label><input className="cbp-input" value={profileForm.biz_type} onChange={e=>setProfileForm({...profileForm,biz_type:e.target.value})}/></div>
          <div className="cbp-field"><label>Business registration type</label><input className="cbp-input" value={profileForm.registration_type} onChange={e=>setProfileForm({...profileForm,registration_type:e.target.value})}/></div>
        </>}
        {profileTab==="Communication"&&<>
          <div className="cbp-field"><label>Business Mobile Number</label><input className="cbp-input" value={profileForm.mobile} onChange={e=>setProfileForm({...profileForm,mobile:e.target.value})}/></div>
          <div className="cbp-field"><label>Business email</label><input className="cbp-input" value={profileForm.email} onChange={e=>setProfileForm({...profileForm,email:e.target.value})}/></div>
        </>}
        <button className="cbp-primary-btn" onClick={saveBusinessProfile}>Save changes</button>
      </div>
    </>;
  }

  function AppSettingsScreen(){
    const Row=({icon,label,value,onToggle})=><div className="cbp-settingsrow">
      <div className="cbp-si">{icon}</div><div className="cbp-settingsrow-main"><b>{label}</b></div>
      <label className="cbp-switch"><input type="checkbox" checked={value} onChange={onToggle}/><span className="cbp-slider"/></label>
    </div>;
    return <>
      <TopBar title="App Settings" onBack={()=>setSettingsScreen("main")}/>
      <div className="cbp-body">
        <div className="cbp-section-title">Data Security</div>
        <div className="cbp-settingsrow" onClick={()=>say("Backup runs automatically")}><div className="cbp-si">☁️</div><div className="cbp-settingsrow-main"><b>Data Backup</b></div><span>›</span></div>
        <Row icon="🔒" label="App Lock" value={appLock} onToggle={()=>setAppLock(v=>!v)}/>
        <div className="cbp-section-title">Features</div>
        <Row icon="🔔" label="Group Book Notifications" value={groupNotif} onToggle={()=>setGroupNotif(v=>!v)}/>
        <Row icon="🧮" label="Amount Field Calculator" value={calcField} onToggle={()=>setCalcField(v=>!v)}/>
        <div className="cbp-section-title">General</div>
        <div className="cbp-settingsrow"><div className="cbp-si">🌐</div><div className="cbp-settingsrow-main"><b>Change Language</b></div><span className="muted">English</span></div>
        <Row icon="🌙" label="Dark Theme" value={dark} onToggle={()=>setDark(v=>!v)}/>
      </div>
    </>;
  }

  // ---- Help tab ------------------------------------------------------
  const FAQ=["How to use CashBook App?","How to do backdated entries?","How to view daily or monthly data in a book?","How to Delete or Rename a book?","How to edit entries in the CashBook app?","What is the Book Activity Log?","What is Business Profile?","How to create Business Profile?","What is Business team?","How to add team members in business?","What are the Roles and permission of Business team members?","How to Filter entries by Time, Day, Date?","How to generate a PDF report?","How to share/export the Excel reports?"];
  function HelpScreen(){
    return <>
      <div className="cbp-pad" style={{paddingTop:20}}><h2 style={{margin:0}}>Help & Support</h2></div>
      <div className="cbp-body">
        <div className="cbp-faq-chips">{["All","Basics","Business Profile","Business Team"].map(c=><span key={c} className="cbp-chip-suggest">{c}</span>)}</div>
        {FAQ.map(q=><div key={q} className="cbp-faqrow" onClick={()=>say("Opens in Help & Support")}>{q}<span>›</span></div>)}
      </div>
      <BottomNav/>
    </>;
  }

  // ---- render --------------------------------------------------------
  let content=null;
  if(tab==="help")content=<HelpScreen/>;
  else if(tab==="settings"){
    if(settingsScreen==="main")content=<SettingsMainScreen/>;
    else if(settingsScreen==="team")content=<BusinessTeamScreen/>;
    else if(settingsScreen==="profile")content=<BusinessProfileScreen/>;
    else if(settingsScreen==="appsettings")content=<AppSettingsScreen/>;
  }else{
    if(screen==="books")content=<BooksListScreen/>;
    else if(screen==="addbook")content=<AddBookScreen/>;
    else if(screen==="duplicate")content=<DuplicateBookScreen/>;
    else if(screen==="filters")content=<FiltersScreen/>;
    else if(screen==="activity")content=<ActivityScreen/>;
    else if(screen==="book"&&activeBook)content=<DayBookScreen/>;
    else content=<BooksListScreen/>;
  }

  return <div className="cbp-shell">
    <div className="cbp-app" data-theme={dark?"dark":"light"}>
      {content}
      {tab==="cashbooks"&&screen==="book"&&activeBook&&<EntrySheet/>}
      {tab==="settings"&&settingsScreen==="team"&&<RolesModal/>}
      {toast&&<div className="cbp-toast">{toast}</div>}
      {screen==="book"&&tab==="cashbooks"&&
        <div style={{position:"fixed",left:"50%",transform:"translateX(-50%)",bottom:8,fontSize:11,color:"#94a3b8",pointerEvents:"none"}}/>}
    </div>
  </div>;
}
