import React,{useEffect,useMemo,useState} from "react";
import {createRoot} from "react-dom/client";
import {createClient} from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";
import "./styles.css";

const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase=url&&key?createClient(url,key):null;
const defaultChannels=["Cash","bKash","Nagad","Rocket","Upay","Bank"];
const roleOptions=["pending","agent","member","manager","admin","super_admin"];
const currencyList=["BDT","USD","INR","EUR","GBP","PKR","NPR","MYR","AED","SAR"];
const currencySymbols={BDT:"৳",USD:"$",INR:"₹",EUR:"€",GBP:"£",PKR:"₨",NPR:"₨",MYR:"RM",AED:"د.إ",SAR:"﷼"};
const money=n=>new Intl.NumberFormat("en-BD",{maximumFractionDigits:2}).format(Number(n||0));
const today=()=>new Date().toISOString().slice(0,10);
// Cash Book / Personal Expense are single-user tools (no business currency), so they
// always show Taka. Swap this if you want them to follow a chosen currency later.
const cbFmt=n=>`৳${money(n)}`;
const expenseCategories=["Food","Transport","Rent","Bills","Shopping","Health","Education","Entertainment","Other"];
const freqOptions=["daily","weekly","monthly"];
const invoiceStatuses=["draft","sent","paid"];
const monthOf=d=>(d||today()).slice(0,7);
function addByFreq(dateStr,freq){const d=new Date(dateStr+"T00:00:00");if(freq==="daily")d.setDate(d.getDate()+1);else if(freq==="weekly")d.setDate(d.getDate()+7);else d.setMonth(d.getMonth()+1);return d.toISOString().slice(0,10)}
// Small dependency-free SVG bar chart used by both Analytics screens.
function BarChart({data,fmt,height=180}){
 const max=Math.max(1,...data.map(d=>d.value));
 const w=Math.max(320,data.length*64);
 return <div className="table-wrap"><svg viewBox={`0 0 ${w} ${height+30}`} width="100%" style={{minWidth:w}}>
  {data.map((d,i)=>{const barH=(d.value/max)*height;const x=i*64+12;return <g key={i}>
   <rect x={x} y={height-barH+10} width="36" height={Math.max(barH,1)} rx="4" fill={d.color||"var(--accent,#2563eb)"}/>
   <text x={x+18} y={height+24} textAnchor="middle" fontSize="11" fill="currentColor">{d.label}</text>
   <text x={x+18} y={height-barH+2} textAnchor="middle" fontSize="10" fill="currentColor">{fmt?fmt(d.value):d.value}</text>
  </g>})}
 </svg></div>
}
// Turns cryptic Postgres/PostgREST errors into an actionable message so a missing
// migration or a stale schema cache doesn't just look like a random failure.
function friendly(msg){
 if(!msg)return msg;
 if(/schema cache/i.test(msg))return "Database setup incomplete: a table isn't visible to the API yet. In Supabase → SQL Editor, make sure you've run the full supabase/schema.sql (fresh project) or the migration files in order (existing project) for THIS project — check the URL in your .env matches. Then in Supabase → Settings → API click \"Reload schema cache\" (or run: NOTIFY pgrst, 'reload schema';) and refresh this page.";
 if(/JWT|refresh_token|invalid_grant/i.test(msg))return "Your session expired — please log out and log back in.";
 return msg;
}

function App(){
 const [session,setSession]=useState(null),[loading,setLoading]=useState(true),[tab,setTab]=useState("dashboard"),[msg,setMsg]=useState("");
 const [profile,setProfile]=useState(null),[bizLoaded,setBizLoaded]=useState(false),[businesses,setBusinesses]=useState([]),[businessId,setBusinessId]=useState("");
 const [members,setMembers]=useState([]),[agents,setAgents]=useState([]),[tx,setTx]=useState([]),[closings,setClosings]=useState([]),[openingsDb,setOpeningsDb]=useState([]);
 const [channelsDb,setChannelsDb]=useState([]),[bizMembers,setBizMembers]=useState([]),[auditLog,setAuditLog]=useState([]),[newChannel,setNewChannel]=useState("");
 const [addMemberEmail,setAddMemberEmail]=useState(""),[newBizName,setNewBizName]=useState(""),[newBizCurrency,setNewBizCurrency]=useState("BDT");
 const [bizNameEdit,setBizNameEdit]=useState(""),[bizCurrencyEdit,setBizCurrencyEdit]=useState("BDT"),[receiptFile,setReceiptFile]=useState(null);
 const [reminder,setReminderState]=useState(()=>(typeof localStorage!=="undefined"&&localStorage.getItem("isf_reminder"))||"");
 const [backupReminder,setBackupReminderState]=useState(()=>(typeof localStorage!=="undefined"&&localStorage.getItem("isf_backup_reminder"))||"");
 const [form,setForm]=useState({type:"collection",person_type:"agent",person_id:"",channel:"bKash",amount:"",note:"",receipt_url:"",transaction_date:today()});
 const [person,setPerson]=useState({name:"",phone:"",type:"agent"}),[closeDate,setCloseDate]=useState(today());
 const [opening,setOpening]=useState({date:today(),channel:"Cash",amount:"",note:""}),[editing,setEditing]=useState(null),[filter,setFilter]=useState({dateFrom:"",dateTo:"",person:"",channel:"",type:""});
 // Three independent tools share this one login: Business Ledger (multi-user, roles),
 // Cash Book and Personal Expense (both simple, single-user). appMode picks which one
 // shows after login; remembered per-device so returning users skip the chooser.
 const [appMode,setAppModeState]=useState(()=>(typeof localStorage!=="undefined"&&localStorage.getItem("isf_app_mode"))||"");
 const [cbEntries,setCbEntries]=useState([]),[cbForm,setCbForm]=useState({entry_date:today(),type:"in",category:"",channel:"Cash",amount:"",note:""}),[cbEditing,setCbEditing]=useState(null);
 const [peEntries,setPeEntries]=useState([]),[peForm,setPeForm]=useState({expense_date:today(),category:"Food",amount:"",note:""}),[peEditing,setPeEditing]=useState(null);
 // Cash Book's own Khata (customer/supplier due-amount ledger): who owes you, who you owe.
 const [cbTab,setCbTab]=useState("entries");
 const [contacts,setContacts]=useState([]),[contactForm,setContactForm]=useState({name:"",phone:"",type:"customer"});
 const [ledgerEntries,setLedgerEntries]=useState([]),[ledgerForm,setLedgerForm]=useState({contact_id:"",entry_type:"you_will_get",amount:"",note:"",entry_date:today()}),[ledgerEditing,setLedgerEditing]=useState(null);
 // ---- V8: Inventory / Invoices / Recurring / Budgets / Multi-currency (Business Ledger). ----
 const [invItems,setInvItems]=useState([]),[invMovements,setInvMovements]=useState([]),[invForm,setInvForm]=useState({name:"",sku:"",unit:"pcs",quantity:"",cost_price:"",sale_price:"",low_stock_threshold:""}),[invEditing,setInvEditing]=useState(null);
 const [moveForm,setMoveForm]=useState({item_id:"",movement_type:"in",quantity:"",note:""});
 const [invoices,setInvoices]=useState([]),[invoiceItems,setInvoiceItems]=useState([]);
 const [invoiceForm,setInvoiceForm]=useState({invoice_no:"",customer_name:"",customer_phone:"",issue_date:today(),due_date:"",status:"draft",notes:""}),[invoiceEditing,setInvoiceEditing]=useState(null);
 const [lineItems,setLineItems]=useState([{item_id:"",description:"",quantity:1,unit_price:0}]);
 const [recurring,setRecurring]=useState([]),[recForm,setRecForm]=useState({type:"expense",person_type:"agent",person_id:"",channel:"Cash",amount:"",note:"",frequency:"monthly",next_run_date:today()}),[recEditing,setRecEditing]=useState(null);
 const [budgets,setBudgets]=useState([]),[budgetForm,setBudgetForm]=useState({channel:"Cash",month:monthOf(),amount_limit:""});
 const [exRates,setExRates]=useState([]),[exForm,setExForm]=useState({currency:"USD",rate:""}),[dispCurrency,setDispCurrency]=useState("");
 // ---- V8: same five features for Cash Book (single-user, no business_id). ----
 const [cbInvItems,setCbInvItems]=useState([]),[cbInvMovements,setCbInvMovements]=useState([]),[cbInvForm,setCbInvForm]=useState({name:"",sku:"",unit:"pcs",quantity:"",cost_price:"",sale_price:"",low_stock_threshold:""}),[cbInvEditing,setCbInvEditing]=useState(null);
 const [cbMoveForm,setCbMoveForm]=useState({item_id:"",movement_type:"in",quantity:"",note:""});
 const [cbInvoices,setCbInvoices]=useState([]),[cbInvoiceItems,setCbInvoiceItems]=useState([]);
 const [cbInvoiceForm,setCbInvoiceForm]=useState({invoice_no:"",customer_name:"",customer_phone:"",issue_date:today(),due_date:"",status:"draft",notes:""}),[cbInvoiceEditing,setCbInvoiceEditing]=useState(null);
 const [cbLineItems,setCbLineItems]=useState([{item_id:"",description:"",quantity:1,unit_price:0}]);
 const [cbRecurring,setCbRecurring]=useState([]),[cbRecForm,setCbRecForm]=useState({type:"out",category:"",channel:"Cash",amount:"",note:"",frequency:"monthly",next_run_date:today()}),[cbRecEditing,setCbRecEditing]=useState(null);
 const [cbBudgets,setCbBudgets]=useState([]),[cbBudgetForm,setCbBudgetForm]=useState({category:"",month:monthOf(),amount_limit:""});
 const [cbExRates,setCbExRates]=useState([]),[cbExForm,setCbExForm]=useState({currency:"USD",rate:""}),[cbDispCurrency,setCbDispCurrency]=useState("");
 function setAppMode(mode){if(typeof localStorage!=="undefined"){if(mode)localStorage.setItem("isf_app_mode",mode);else localStorage.removeItem("isf_app_mode")}setAppModeState(mode)}

 useEffect(()=>{if(!supabase){setLoading(false);return} supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)});const {data:l}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>l.subscription.unsubscribe()},[]);
 useEffect(()=>{if(session&&appMode==="business")loadBusinesses()},[session,appMode]);
 useEffect(()=>{const b=businesses.find(x=>x.id===businessId);if(b){setBizNameEdit(b.name);setBizCurrencyEdit(b.currency)}},[businessId,businesses]);
 useEffect(()=>{if(session&&appMode==="cashbook"){loadCashbook();loadContacts();loadLedger();loadCbV8()}},[session,appMode]);
 useEffect(()=>{if(session&&appMode==="personal")loadPersonal()},[session,appMode]);

 // Daily-closing browser reminder. Client-side only: fires while this tab is
 // open on this device. Real SMS/email needs a backend + provider (see README).
 useEffect(()=>{
  if(!reminder||typeof Notification==="undefined")return;
  const iv=setInterval(()=>{
   const now=new Date();const hh=String(now.getHours()).padStart(2,"0"),mm=String(now.getMinutes()).padStart(2,"0");
   if(`${hh}:${mm}`===reminder&&now.getSeconds()<20&&Notification.permission==="granted"){new Notification("ISF Business Ledger",{body:"Reminder: complete today's daily closing."})}
  },15000);
  return()=>clearInterval(iv);
 },[reminder]);

 // Weekly backup-download reminder. Same client-side-only limitation as above:
 // only fires while this tab is open. Format stored: "dayOfWeek|HH:MM" (day 0=Sun).
 useEffect(()=>{
  if(!backupReminder||typeof Notification==="undefined")return;
  const [day,time]=backupReminder.split("|");
  const iv=setInterval(()=>{
   const now=new Date();const hh=String(now.getHours()).padStart(2,"0"),mm=String(now.getMinutes()).padStart(2,"0");
   const todayStr=today();
   if(String(now.getDay())===day&&`${hh}:${mm}`===time&&now.getSeconds()<20&&Notification.permission==="granted"&&localStorage.getItem("isf_backup_last_fired")!==todayStr){
    new Notification("ISF Business Ledger",{body:"Weekly reminder: download your backup and save it to Google Drive."});
    localStorage.setItem("isf_backup_last_fired",todayStr);
   }
  },15000);
  return()=>clearInterval(iv);
 },[backupReminder]);

 function pickBusinessId(list){const saved=typeof localStorage!=="undefined"&&localStorage.getItem("isf_business_id");if(saved&&list.some(b=>b.id===saved))return saved;const approved=list.find(b=>b.role!=="pending");return approved?approved.id:(list[0]?.id||"")}

 async function loadBusinesses(){
  const {data:p}=await supabase.from("profiles").select("*").eq("id",session.user.id).maybeSingle();
  setProfile(p);
  const {data:bm,error}=await supabase.from("business_members").select("role,business:businesses(id,name,currency)").eq("user_id",session.user.id);
  if(error)setMsg(friendly(error.message));
  const list=(!error&&bm?bm.filter(x=>x.business).map(x=>({id:x.business.id,name:x.business.name,currency:x.business.currency,role:x.role})):[]);
  setBusinesses(list);
  const chosen=pickBusinessId(list);
  setBusinessId(chosen);
  if(chosen&&typeof localStorage!=="undefined")localStorage.setItem("isf_business_id",chosen);
  const cur=list.find(b=>b.id===chosen);
  if(cur&&cur.role!=="pending"){await loadData(chosen);await loadV8(chosen)}
  setBizLoaded(true);
 }
 async function loadData(bizId){
  const [m,a,t,c,o,ch,bmem,al]=await Promise.all([
   supabase.from("members").select("*").eq("business_id",bizId).order("name"),
   supabase.from("agents").select("*").eq("business_id",bizId).order("name"),
   supabase.from("transactions").select("*").eq("business_id",bizId).order("transaction_date",{ascending:false}).order("created_at",{ascending:false}),
   supabase.from("daily_closings").select("*").eq("business_id",bizId).order("closing_date",{ascending:false}),
   supabase.from("opening_balances").select("*").eq("business_id",bizId).order("balance_date",{ascending:false}),
   supabase.from("channels").select("*").eq("business_id",bizId).order("sort_order",{ascending:true}).order("name"),
   supabase.from("business_members").select("*, member:profiles(email,full_name)").eq("business_id",bizId).order("created_at",{ascending:false}),
   supabase.from("audit_logs").select("*").eq("business_id",bizId).order("created_at",{ascending:false}).limit(300)
  ]);
  if(!m.error)setMembers(m.data||[]);if(!a.error)setAgents(a.data||[]);if(!t.error)setTx(t.data||[]);if(!c.error)setClosings(c.data||[]);if(!o.error)setOpeningsDb(o.data||[]);
  if(!ch.error)setChannelsDb(ch.data||[]);if(!bmem.error)setBizMembers(bmem.data||[]);if(!al.error)setAuditLog(al.data||[]);
 }
 // ---- V8 data for the current business: inventory, invoices, recurring, budgets, rates. ----
 async function loadV8(bizId){
  const [ii,im,inv,ivi,rec,bud,ex]=await Promise.all([
   supabase.from("inventory_items").select("*").eq("business_id",bizId).order("name"),
   supabase.from("inventory_movements").select("*").eq("business_id",bizId).order("created_at",{ascending:false}),
   supabase.from("invoices").select("*").eq("business_id",bizId).order("issue_date",{ascending:false}),
   supabase.from("invoice_items").select("*").eq("business_id",bizId),
   supabase.from("recurring_transactions").select("*").eq("business_id",bizId).order("next_run_date"),
   supabase.from("budgets").select("*").eq("business_id",bizId),
   supabase.from("exchange_rates").select("*").eq("business_id",bizId)
  ]);
  if(!ii.error)setInvItems(ii.data||[]);if(!im.error)setInvMovements(im.data||[]);
  if(!inv.error)setInvoices(inv.data||[]);if(!ivi.error)setInvoiceItems(ivi.data||[]);
  if(!rec.error)setRecurring(rec.data||[]);if(!bud.error)setBudgets(bud.data||[]);if(!ex.error)setExRates(ex.data||[]);
 }
 async function loadCbV8(){
  const uid=session.user.id;
  const [ii,im,inv,ivi,rec,bud,ex]=await Promise.all([
   supabase.from("cashbook_inventory_items").select("*").eq("user_id",uid).order("name"),
   supabase.from("cashbook_inventory_movements").select("*").eq("user_id",uid).order("created_at",{ascending:false}),
   supabase.from("cashbook_invoices").select("*").eq("user_id",uid).order("issue_date",{ascending:false}),
   supabase.from("cashbook_invoice_items").select("*").eq("user_id",uid),
   supabase.from("cashbook_recurring").select("*").eq("user_id",uid).order("next_run_date"),
   supabase.from("cashbook_budgets").select("*").eq("user_id",uid),
   supabase.from("cashbook_exchange_rates").select("*").eq("user_id",uid)
  ]);
  if(!ii.error)setCbInvItems(ii.data||[]);if(!im.error)setCbInvMovements(im.data||[]);
  if(!inv.error)setCbInvoices(inv.data||[]);if(!ivi.error)setCbInvoiceItems(ivi.data||[]);
  if(!rec.error)setCbRecurring(rec.data||[]);if(!bud.error)setCbBudgets(bud.data||[]);if(!ex.error)setCbExRates(ex.data||[]);
 }
 function switchBusiness(id){if(!id)return;setBusinessId(id);if(typeof localStorage!=="undefined")localStorage.setItem("isf_business_id",id);const b=businesses.find(x=>x.id===id);if(b&&b.role!=="pending"){loadData(id);loadV8(id)}}
 async function createBusiness(e){e.preventDefault();if(!newBizName.trim())return setMsg("Enter a business name.");const {data,error}=await supabase.from("businesses").insert({name:newBizName.trim(),currency:newBizCurrency,created_by:session.user.id}).select().single();setMsg(friendly(error?.message)||"Business created.");if(!error){setNewBizName("");await loadBusinesses();setBusinessId(data.id);if(typeof localStorage!=="undefined")localStorage.setItem("isf_business_id",data.id);loadData(data.id);loadV8(data.id)}}
 async function updateBusinessInfo(e){e.preventDefault();if(!canAdmin)return setMsg("Permission denied.");const {error}=await supabase.from("businesses").update({name:bizNameEdit.trim(),currency:bizCurrencyEdit}).eq("id",businessId);if(!error)await audit("UPDATE","businesses",businessId,"business info updated");setMsg(friendly(error?.message)||"Business updated.");if(!error)loadBusinesses()}

 const people=useMemo(()=>[...members.map(x=>({...x,person_type:"member"})),...agents.map(x=>({...x,person_type:"agent"}))],[members,agents]);
 const name=id=>people.find(p=>p.id===id)?.name||"Unknown";
 const currentBiz=businesses.find(b=>b.id===businessId);
 const myRole=currentBiz?.role;
 const allowed=(...roles)=>roles.includes(myRole)||myRole==="super_admin";
 const canManage=allowed("super_admin","admin","manager"),canAdmin=allowed("super_admin","admin");
 const symbol=currencySymbols[currentBiz?.currency]||currentBiz?.currency||"৳";
 const fmt=n=>`${symbol}${money(n)}`;
 const channelNames=useMemo(()=>{const act=channelsDb.filter(c=>c.active).map(c=>c.name);return act.length?act:defaultChannels},[channelsDb]);
 const allChannelNames=useMemo(()=>[...new Set([...channelsDb.map(c=>c.name),...tx.map(t=>t.channel),...defaultChannels])],[channelsDb,tx]);
 const totals=useMemo(()=>sumTx(tx),[tx]);
 const dayTx=useMemo(()=>tx.filter(t=>t.transaction_date===closeDate),[tx,closeDate]);
 const dayStats=useMemo(()=>sumTx(dayTx),[dayTx]);
 const dayOpenings=useMemo(()=>openingsDb.filter(x=>x.balance_date===closeDate),[openingsDb,closeDate]);
 const channelClosing=useMemo(()=>channelNames.map(ch=>{const op=dayOpenings.filter(x=>x.channel===ch).reduce((s,x)=>s+ +x.amount,0);const d=dayTx.filter(x=>x.channel===ch).reduce((s,x)=>s+(x.type==="collection"?+x.amount:x.type==="fund_given"||x.type==="expense"?-+x.amount:0),0);return {channel:ch,opening:op,movement:d,closing:op+d}}),[channelNames,dayOpenings,dayTx]);

 function sumTx(rows){return rows.reduce((a,t)=>{const v=+t.amount||0;if(t.type==="fund_given")a.fund+=v;if(t.type==="collection")a.collection+=v;if(t.type==="expense")a.expense+=v;return a},{fund:0,collection:0,expense:0})}
 async function audit(action,table,rowId,details=""){await supabase.from("audit_logs").insert({business_id:businessId,user_id:session.user.id,user_email:session.user.email,action,table_name:table,row_id:rowId,details})}
 async function login(){const {error}=await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin}});if(error)setMsg(error.message)}
 async function logout(){await supabase.auth.signOut()}

 async function addPerson(e){e.preventDefault();if(!allowed("admin","manager"))return setMsg("Permission denied.");const table=person.type==="member"?"members":"agents";const {data,error}=await supabase.from(table).insert({business_id:businessId,name:person.name.trim(),phone:person.phone.trim(),active:true}).select().single();if(!error)await audit("CREATE",table,data.id,person.name);setMsg(friendly(error?.message)||"Added.");if(!error){setPerson({...person,name:"",phone:""});loadData(businessId)}}
 async function togglePerson(p){if(!allowed("admin","manager"))return setMsg("Permission denied.");const table=p.person_type==="member"?"members":"agents";const {error}=await supabase.from(table).update({active:!p.active}).eq("id",p.id);if(!error)await audit("UPDATE",table,p.id,`active -> ${!p.active}`);setMsg(friendly(error?.message)||"Updated.");if(!error)loadData(businessId)}

 // ---- V8: Inventory (Business Ledger) ----
 async function saveInvItem(e){e.preventDefault();if(!canManage)return setMsg("Permission denied.");if(!invForm.name.trim())return setMsg("Enter an item name.");const payload={name:invForm.name.trim(),sku:invForm.sku.trim(),unit:invForm.unit.trim()||"pcs",quantity:+invForm.quantity||0,cost_price:+invForm.cost_price||0,sale_price:+invForm.sale_price||0,low_stock_threshold:+invForm.low_stock_threshold||0};let error;if(invEditing){({error}=await supabase.from("inventory_items").update(payload).eq("id",invEditing))}else{({error}=await supabase.from("inventory_items").insert({...payload,business_id:businessId,created_by:session.user.id}))}setMsg(friendly(error?.message)||(invEditing?"Item updated.":"Item added."));if(!error){setInvForm({name:"",sku:"",unit:"pcs",quantity:"",cost_price:"",sale_price:"",low_stock_threshold:""});setInvEditing(null);loadV8(businessId)}}
 function editInvItem(x){setInvEditing(x.id);setInvForm({name:x.name,sku:x.sku||"",unit:x.unit,quantity:x.quantity,cost_price:x.cost_price,sale_price:x.sale_price,low_stock_threshold:x.low_stock_threshold})}
 function cancelInvItem(){setInvEditing(null);setInvForm({name:"",sku:"",unit:"pcs",quantity:"",cost_price:"",sale_price:"",low_stock_threshold:""})}
 async function deleteInvItem(id){if(!canManage)return setMsg("Permission denied.");if(!confirm("Delete this item and its stock history?"))return;const {error}=await supabase.from("inventory_items").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadV8(businessId)}
 async function saveMovement(e){e.preventDefault();if(!canManage)return setMsg("Permission denied.");if(!moveForm.item_id||!+moveForm.quantity)return setMsg("Select an item and quantity.");const item=invItems.find(x=>x.id===moveForm.item_id);if(!item)return;const qty=+moveForm.quantity;const newQty=moveForm.movement_type==="adjustment"?qty:moveForm.movement_type==="in"?+item.quantity+qty:+item.quantity-qty;const {error:e1}=await supabase.from("inventory_movements").insert({business_id:businessId,item_id:item.id,movement_type:moveForm.movement_type,quantity:qty,note:moveForm.note.trim(),created_by:session.user.id});const {error:e2}=await supabase.from("inventory_items").update({quantity:newQty}).eq("id",item.id);setMsg(friendly(e1?.message||e2?.message)||"Stock updated.");if(!e1&&!e2){setMoveForm({item_id:"",movement_type:"in",quantity:"",note:""});loadV8(businessId)}}

 // ---- V8: Invoices (Business Ledger) ----
 function addLineItem(list,setList){setList([...list,{item_id:"",description:"",quantity:1,unit_price:0}])}
 function removeLineItem(list,setList,idx){setList(list.filter((_,i)=>i!==idx))}
 function updateLineItem(list,setList,items,idx,field,value){const copy=[...list];copy[idx]={...copy[idx],[field]:value};if(field==="item_id"){const it=items.find(x=>x.id===value);if(it){copy[idx].description=it.name;copy[idx].unit_price=it.sale_price}}setList(copy)}
 function lineTotal(list){return list.reduce((s,l)=>s+(+l.quantity||0)*(+l.unit_price||0),0)}
 async function saveInvoice(e){e.preventDefault();if(!canManage)return setMsg("Permission denied.");if(!invoiceForm.invoice_no.trim()||!invoiceForm.customer_name.trim())return setMsg("Enter invoice number and customer name.");const valid=lineItems.filter(l=>l.description.trim()&&+l.quantity>0);if(!valid.length)return setMsg("Add at least one line item.");
  let invoiceId=invoiceEditing;let error;
  if(invoiceEditing){({error}=await supabase.from("invoices").update(invoiceForm).eq("id",invoiceEditing));if(!error)await supabase.from("invoice_items").delete().eq("invoice_id",invoiceEditing)}
  else{const {data,error:e1}=await supabase.from("invoices").insert({...invoiceForm,business_id:businessId,created_by:session.user.id}).select().single();error=e1;if(!error)invoiceId=data.id}
  if(!error){const rows=valid.map(l=>({business_id:businessId,invoice_id:invoiceId,item_id:l.item_id||null,description:l.description.trim(),quantity:+l.quantity,unit_price:+l.unit_price}));const {error:e2}=await supabase.from("invoice_items").insert(rows);error=e2}
  setMsg(friendly(error?.message)||(invoiceEditing?"Invoice updated.":"Invoice saved."));if(!error){setInvoiceForm({invoice_no:"",customer_name:"",customer_phone:"",issue_date:today(),due_date:"",status:"draft",notes:""});setLineItems([{item_id:"",description:"",quantity:1,unit_price:0}]);setInvoiceEditing(null);loadV8(businessId)}}
 function editInvoice(inv){setInvoiceEditing(inv.id);setInvoiceForm({invoice_no:inv.invoice_no,customer_name:inv.customer_name,customer_phone:inv.customer_phone||"",issue_date:inv.issue_date,due_date:inv.due_date||"",status:inv.status,notes:inv.notes||""});const items=invoiceItems.filter(x=>x.invoice_id===inv.id);setLineItems(items.length?items.map(x=>({item_id:x.item_id||"",description:x.description,quantity:x.quantity,unit_price:x.unit_price})):[{item_id:"",description:"",quantity:1,unit_price:0}])}
 function cancelInvoice(){setInvoiceEditing(null);setInvoiceForm({invoice_no:"",customer_name:"",customer_phone:"",issue_date:today(),due_date:"",status:"draft",notes:""});setLineItems([{item_id:"",description:"",quantity:1,unit_price:0}])}
 async function deleteInvoice(id){if(!canManage)return setMsg("Permission denied.");if(!confirm("Delete this invoice?"))return;const {error}=await supabase.from("invoices").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadV8(businessId)}
 function invoicePDF(inv){const items=invoiceItems.filter(x=>x.invoice_id===inv.id);const d=new jsPDF();d.text(`${currentBiz?.name||"Invoice"}`,14,15);d.text(`Invoice #${inv.invoice_no}`,14,23);d.text(`Bill To: ${inv.customer_name}${inv.customer_phone?" ("+inv.customer_phone+")":""}`,14,31);d.text(`Date: ${inv.issue_date}${inv.due_date?"  Due: "+inv.due_date:""}`,14,38);d.autoTable({startY:45,head:[["Description","Qty","Unit Price","Total"]],body:items.map(x=>[x.description,x.quantity,money(x.unit_price),money(x.quantity*x.unit_price)])});const y=(d.lastAutoTable?.finalY||60)+12;d.text(`Total: ${fmt(items.reduce((s,x)=>s+x.quantity*x.unit_price,0))}`,14,y);d.save(`Invoice-${inv.invoice_no}.pdf`)}

 // ---- V8: Recurring Transactions (Business Ledger) ----
 async function saveRecurring(e){e.preventDefault();if(!canManage)return setMsg("Permission denied.");if(!+recForm.amount)return setMsg("Enter an amount.");let error;if(recEditing){({error}=await supabase.from("recurring_transactions").update(recForm).eq("id",recEditing))}else{({error}=await supabase.from("recurring_transactions").insert({...recForm,amount:+recForm.amount,business_id:businessId,created_by:session.user.id}))}setMsg(friendly(error?.message)||(recEditing?"Recurring updated.":"Recurring created."));if(!error){setRecForm({type:"expense",person_type:"agent",person_id:"",channel:"Cash",amount:"",note:"",frequency:"monthly",next_run_date:today()});setRecEditing(null);loadV8(businessId)}}
 function editRecurring(x){setRecEditing(x.id);setRecForm({type:x.type,person_type:x.person_type,person_id:x.person_id||"",channel:x.channel,amount:x.amount,note:x.note||"",frequency:x.frequency,next_run_date:x.next_run_date})}
 function cancelRecurring(){setRecEditing(null);setRecForm({type:"expense",person_type:"agent",person_id:"",channel:"Cash",amount:"",note:"",frequency:"monthly",next_run_date:today()})}
 async function deleteRecurring(id){if(!canManage)return setMsg("Permission denied.");if(!confirm("Delete this recurring rule?"))return;const {error}=await supabase.from("recurring_transactions").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadV8(businessId)}
 async function toggleRecurring(x){const {error}=await supabase.from("recurring_transactions").update({active:!x.active}).eq("id",x.id);if(!error)loadV8(businessId)}
 async function processDueRecurring(){if(!canManage)return setMsg("Permission denied.");const dueRows=recurring.filter(r=>r.active&&r.next_run_date<=today());if(!dueRows.length)return setMsg("Nothing due.");let count=0;for(const r of dueRows){let next=r.next_run_date;let guard=0;while(next<=today()&&guard<24){await supabase.from("transactions").insert({business_id:businessId,type:r.type,person_type:r.person_type,person_id:r.person_id,channel:r.channel,amount:r.amount,note:`${r.note||""} (recurring)`.trim(),transaction_date:next,created_by:session.user.id});next=addByFreq(next,r.frequency);count++;guard++}await supabase.from("recurring_transactions").update({next_run_date:next}).eq("id",r.id)}setMsg(`${count} recurring transaction(s) posted.`);loadData(businessId);loadV8(businessId)}

 // ---- V8: Budgets & Alerts (Business Ledger) — tracked per channel, per month, against expense transactions. ----
 async function saveBudget(e){e.preventDefault();if(!canManage)return setMsg("Permission denied.");if(!+budgetForm.amount_limit)return setMsg("Enter a limit.");const {error}=await supabase.from("budgets").upsert({...budgetForm,amount_limit:+budgetForm.amount_limit,business_id:businessId,created_by:session.user.id},{onConflict:"business_id,channel,month"});setMsg(friendly(error?.message)||"Budget saved.");if(!error){setBudgetForm({...budgetForm,amount_limit:""});loadV8(businessId)}}
 async function deleteBudget(id){if(!canManage)return setMsg("Permission denied.");if(!confirm("Delete this budget?"))return;const {error}=await supabase.from("budgets").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadV8(businessId)}
 function budgetSpent(channel,month){return tx.filter(t=>t.type==="expense"&&t.channel===channel&&t.transaction_date.slice(0,7)===month).reduce((s,t)=>s+ +t.amount,0)}

 // ---- V8: Multi-currency display (Business Ledger) — conversion is display-only; stored amounts stay in the business's base currency. ----
 async function saveExRate(e){e.preventDefault();if(!canAdmin)return setMsg("Permission denied.");if(!+exForm.rate)return setMsg("Enter a rate.");const {error}=await supabase.from("exchange_rates").upsert({business_id:businessId,currency:exForm.currency,rate:+exForm.rate,updated_at:new Date().toISOString()},{onConflict:"business_id,currency"});setMsg(friendly(error?.message)||"Rate saved.");if(!error){setExForm({...exForm,rate:""});loadV8(businessId)}}
 async function deleteExRate(id){if(!canAdmin)return setMsg("Permission denied.");const {error}=await supabase.from("exchange_rates").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadV8(businessId)}
 function convert(amount){if(!dispCurrency||dispCurrency===currentBiz?.currency)return amount;const r=exRates.find(x=>x.currency===dispCurrency);return r?amount*+r.rate:amount}
 function dispFmt(amount){if(!dispCurrency||dispCurrency===currentBiz?.currency)return fmt(amount);const sym=currencySymbols[dispCurrency]||dispCurrency;return `${sym}${money(convert(amount))}`}

 // ---- Cash Book: simple personal cash-in/cash-out log, scoped to this user only (no business_id). ----
 async function loadCashbook(){const {data,error}=await supabase.from("cashbook_entries").select("*").eq("user_id",session.user.id).order("entry_date",{ascending:false}).order("created_at",{ascending:false});if(!error)setCbEntries(data||[]);else setMsg(friendly(error.message))}
 async function saveCbEntry(e){e.preventDefault();if(!+cbForm.amount)return setMsg("Enter an amount.");const payload={entry_date:cbForm.entry_date,type:cbForm.type,category:cbForm.category.trim()||"General",channel:cbForm.channel,amount:+cbForm.amount,note:cbForm.note.trim()};let error;if(cbEditing){({error}=await supabase.from("cashbook_entries").update(payload).eq("id",cbEditing))}else{({error}=await supabase.from("cashbook_entries").insert({...payload,user_id:session.user.id}))}setMsg(friendly(error?.message)||(cbEditing?"Entry updated.":"Entry saved."));if(!error){setCbForm({entry_date:cbForm.entry_date,type:"in",category:"",channel:cbForm.channel,amount:"",note:""});setCbEditing(null);loadCashbook()}}
 function editCb(x){setCbEditing(x.id);setCbForm({entry_date:x.entry_date,type:x.type,category:x.category,channel:x.channel,amount:x.amount,note:x.note||""})}
 function cancelCb(){setCbEditing(null);setCbForm({entry_date:today(),type:"in",category:"",channel:"Cash",amount:"",note:""})}
 async function deleteCbEntry(id){if(!confirm("Delete this entry?"))return;const {error}=await supabase.from("cashbook_entries").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadCashbook()}
 function exportCbExcel(){const rows=cbEntries.map(x=>({Date:x.entry_date,Type:x.type,Category:x.category,Channel:x.channel,Amount:+x.amount,Note:x.note||""}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),"Cash Book");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(contacts.map(c=>({Name:c.name,Phone:c.phone||"",Type:c.type,Balance:contactBalance(c.id)}))),"Khata");XLSX.writeFile(wb,`CashBook-${today()}.xlsx`)}
 function exportCbPDF(){const d=new jsPDF();d.text("Cash Book Report",14,15);d.text(`Generated: ${today()}`,14,23);d.autoTable({startY:30,head:[["Date","Type","Category","Channel","Amount"]],body:cbEntries.map(x=>[x.entry_date,x.type==="in"?"Cash In":"Cash Out",x.category,x.channel,money(x.amount)])});const y=(d.lastAutoTable?.finalY||50)+12;d.text(`Total Cash In: ${cbFmt(cbTotals.in)}   Total Cash Out: ${cbFmt(cbTotals.out)}   Balance: ${cbFmt(cbTotals.in-cbTotals.out)}`,14,y);d.save(`CashBook-${today()}.pdf`)}
 function downloadCbBackup(){const payload={exported_at:new Date().toISOString(),cash_entries:cbEntries,contacts,ledger:ledgerEntries};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const objUrl=URL.createObjectURL(blob);const a=document.createElement("a");a.href=objUrl;a.download=`CashBook-Backup-${today()}.json`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(objUrl);setMsg("Backup downloaded.")}

 // ---- Khata: customer/supplier due-amount ledger, part of Cash Book, single-user. ----
 async function loadContacts(){const {data,error}=await supabase.from("cashbook_contacts").select("*").eq("user_id",session.user.id).order("name");if(!error)setContacts(data||[]);else setMsg(friendly(error.message))}
 async function saveContact(e){e.preventDefault();if(!contactForm.name.trim())return setMsg("Enter a name.");const {error}=await supabase.from("cashbook_contacts").insert({user_id:session.user.id,name:contactForm.name.trim(),phone:contactForm.phone.trim(),type:contactForm.type});setMsg(friendly(error?.message)||"Contact added.");if(!error){setContactForm({name:"",phone:"",type:contactForm.type});loadContacts()}}
 async function deleteContact(id){if(!confirm("Delete this contact and all of their ledger entries?"))return;const {error}=await supabase.from("cashbook_contacts").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error){loadContacts();loadLedger()}}
 async function loadLedger(){const {data,error}=await supabase.from("cashbook_ledger").select("*").eq("user_id",session.user.id).order("entry_date",{ascending:false}).order("created_at",{ascending:false});if(!error)setLedgerEntries(data||[]);else setMsg(friendly(error.message))}
 async function saveLedgerEntry(e){e.preventDefault();if(!ledgerForm.contact_id)return setMsg("Select a contact.");if(!+ledgerForm.amount)return setMsg("Enter an amount.");const payload={contact_id:ledgerForm.contact_id,entry_type:ledgerForm.entry_type,amount:+ledgerForm.amount,note:ledgerForm.note.trim(),entry_date:ledgerForm.entry_date};let error;if(ledgerEditing){({error}=await supabase.from("cashbook_ledger").update(payload).eq("id",ledgerEditing))}else{({error}=await supabase.from("cashbook_ledger").insert({...payload,user_id:session.user.id}))}setMsg(friendly(error?.message)||(ledgerEditing?"Entry updated.":"Entry saved."));if(!error){setLedgerForm({...ledgerForm,amount:"",note:""});setLedgerEditing(null);loadLedger()}}
 function editLedger(x){setLedgerEditing(x.id);setLedgerForm({contact_id:x.contact_id,entry_type:x.entry_type,amount:x.amount,note:x.note||"",entry_date:x.entry_date})}
 function cancelLedger(){setLedgerEditing(null);setLedgerForm({contact_id:ledgerForm.contact_id,entry_type:"you_will_get",amount:"",note:"",entry_date:today()})}
 async function deleteLedgerEntry(id){if(!confirm("Delete this entry?"))return;const {error}=await supabase.from("cashbook_ledger").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadLedger()}
 function contactBalance(cid){return ledgerEntries.filter(x=>x.contact_id===cid).reduce((s,x)=>s+(x.entry_type==="you_will_get"?+x.amount:-+x.amount),0)}
 // WhatsApp-only reminder (no SMS gateway/account available here — see README). Opens
 // wa.me with the amount pre-filled; the person still taps Send themselves.
 function sendReminder(c){const bal=contactBalance(c.id);const text=bal>=0?`${c.name}, আপনার কাছে আমাদের পাওনা ${cbFmt(bal)}। অনুগ্রহ করে শীঘ্রই পরিশোধ করুন। ধন্যবাদ।`:`${c.name}, আমাদের কাছে আপনার পাওনা ${cbFmt(-bal)}। শীঘ্রই পরিশোধ করে দেব।`;const phone=(c.phone||"").replace(/[^0-9]/g,"");window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`,"_blank")}

 // ---- V8: Inventory (Cash Book) ----
 const uid=()=>session.user.id;
 async function saveCbInvItem(e){e.preventDefault();if(!cbInvForm.name.trim())return setMsg("Enter an item name.");const payload={name:cbInvForm.name.trim(),sku:cbInvForm.sku.trim(),unit:cbInvForm.unit.trim()||"pcs",quantity:+cbInvForm.quantity||0,cost_price:+cbInvForm.cost_price||0,sale_price:+cbInvForm.sale_price||0,low_stock_threshold:+cbInvForm.low_stock_threshold||0};let error;if(cbInvEditing){({error}=await supabase.from("cashbook_inventory_items").update(payload).eq("id",cbInvEditing))}else{({error}=await supabase.from("cashbook_inventory_items").insert({...payload,user_id:uid()}))}setMsg(friendly(error?.message)||(cbInvEditing?"Item updated.":"Item added."));if(!error){setCbInvForm({name:"",sku:"",unit:"pcs",quantity:"",cost_price:"",sale_price:"",low_stock_threshold:""});setCbInvEditing(null);loadCbV8()}}
 function editCbInvItem(x){setCbInvEditing(x.id);setCbInvForm({name:x.name,sku:x.sku||"",unit:x.unit,quantity:x.quantity,cost_price:x.cost_price,sale_price:x.sale_price,low_stock_threshold:x.low_stock_threshold})}
 function cancelCbInvItem(){setCbInvEditing(null);setCbInvForm({name:"",sku:"",unit:"pcs",quantity:"",cost_price:"",sale_price:"",low_stock_threshold:""})}
 async function deleteCbInvItem(id){if(!confirm("Delete this item and its stock history?"))return;const {error}=await supabase.from("cashbook_inventory_items").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadCbV8()}
 async function saveCbMovement(e){e.preventDefault();if(!cbMoveForm.item_id||!+cbMoveForm.quantity)return setMsg("Select an item and quantity.");const item=cbInvItems.find(x=>x.id===cbMoveForm.item_id);if(!item)return;const qty=+cbMoveForm.quantity;const newQty=cbMoveForm.movement_type==="adjustment"?qty:cbMoveForm.movement_type==="in"?+item.quantity+qty:+item.quantity-qty;const {error:e1}=await supabase.from("cashbook_inventory_movements").insert({user_id:uid(),item_id:item.id,movement_type:cbMoveForm.movement_type,quantity:qty,note:cbMoveForm.note.trim()});const {error:e2}=await supabase.from("cashbook_inventory_items").update({quantity:newQty}).eq("id",item.id);setMsg(friendly(e1?.message||e2?.message)||"Stock updated.");if(!e1&&!e2){setCbMoveForm({item_id:"",movement_type:"in",quantity:"",note:""});loadCbV8()}}

 // ---- V8: Invoices (Cash Book) ----
 async function saveCbInvoice(e){e.preventDefault();if(!cbInvoiceForm.invoice_no.trim()||!cbInvoiceForm.customer_name.trim())return setMsg("Enter invoice number and customer name.");const valid=cbLineItems.filter(l=>l.description.trim()&&+l.quantity>0);if(!valid.length)return setMsg("Add at least one line item.");
  let invoiceId=cbInvoiceEditing;let error;
  if(cbInvoiceEditing){({error}=await supabase.from("cashbook_invoices").update(cbInvoiceForm).eq("id",cbInvoiceEditing));if(!error)await supabase.from("cashbook_invoice_items").delete().eq("invoice_id",cbInvoiceEditing)}
  else{const {data,error:e1}=await supabase.from("cashbook_invoices").insert({...cbInvoiceForm,user_id:uid()}).select().single();error=e1;if(!error)invoiceId=data.id}
  if(!error){const rows=valid.map(l=>({user_id:uid(),invoice_id:invoiceId,item_id:l.item_id||null,description:l.description.trim(),quantity:+l.quantity,unit_price:+l.unit_price}));const {error:e2}=await supabase.from("cashbook_invoice_items").insert(rows);error=e2}
  setMsg(friendly(error?.message)||(cbInvoiceEditing?"Invoice updated.":"Invoice saved."));if(!error){setCbInvoiceForm({invoice_no:"",customer_name:"",customer_phone:"",issue_date:today(),due_date:"",status:"draft",notes:""});setCbLineItems([{item_id:"",description:"",quantity:1,unit_price:0}]);setCbInvoiceEditing(null);loadCbV8()}}
 function editCbInvoice(inv){setCbInvoiceEditing(inv.id);setCbInvoiceForm({invoice_no:inv.invoice_no,customer_name:inv.customer_name,customer_phone:inv.customer_phone||"",issue_date:inv.issue_date,due_date:inv.due_date||"",status:inv.status,notes:inv.notes||""});const items=cbInvoiceItems.filter(x=>x.invoice_id===inv.id);setCbLineItems(items.length?items.map(x=>({item_id:x.item_id||"",description:x.description,quantity:x.quantity,unit_price:x.unit_price})):[{item_id:"",description:"",quantity:1,unit_price:0}])}
 function cancelCbInvoice(){setCbInvoiceEditing(null);setCbInvoiceForm({invoice_no:"",customer_name:"",customer_phone:"",issue_date:today(),due_date:"",status:"draft",notes:""});setCbLineItems([{item_id:"",description:"",quantity:1,unit_price:0}])}
 async function deleteCbInvoice(id){if(!confirm("Delete this invoice?"))return;const {error}=await supabase.from("cashbook_invoices").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadCbV8()}
 function cbInvoicePDF(inv){const items=cbInvoiceItems.filter(x=>x.invoice_id===inv.id);const d=new jsPDF();d.text("Invoice",14,15);d.text(`Invoice #${inv.invoice_no}`,14,23);d.text(`Bill To: ${inv.customer_name}${inv.customer_phone?" ("+inv.customer_phone+")":""}`,14,31);d.text(`Date: ${inv.issue_date}${inv.due_date?"  Due: "+inv.due_date:""}`,14,38);d.autoTable({startY:45,head:[["Description","Qty","Unit Price","Total"]],body:items.map(x=>[x.description,x.quantity,money(x.unit_price),money(x.quantity*x.unit_price)])});const y=(d.lastAutoTable?.finalY||60)+12;d.text(`Total: ${cbFmt(items.reduce((s,x)=>s+x.quantity*x.unit_price,0))}`,14,y);d.save(`Invoice-${inv.invoice_no}.pdf`)}

 // ---- V8: Recurring Entries (Cash Book) ----
 async function saveCbRecurring(e){e.preventDefault();if(!+cbRecForm.amount)return setMsg("Enter an amount.");let error;if(cbRecEditing){({error}=await supabase.from("cashbook_recurring").update(cbRecForm).eq("id",cbRecEditing))}else{({error}=await supabase.from("cashbook_recurring").insert({...cbRecForm,amount:+cbRecForm.amount,user_id:uid()}))}setMsg(friendly(error?.message)||(cbRecEditing?"Recurring updated.":"Recurring created."));if(!error){setCbRecForm({type:"out",category:"",channel:"Cash",amount:"",note:"",frequency:"monthly",next_run_date:today()});setCbRecEditing(null);loadCbV8()}}
 function editCbRecurring(x){setCbRecEditing(x.id);setCbRecForm({type:x.type,category:x.category,channel:x.channel,amount:x.amount,note:x.note||"",frequency:x.frequency,next_run_date:x.next_run_date})}
 function cancelCbRecurring(){setCbRecEditing(null);setCbRecForm({type:"out",category:"",channel:"Cash",amount:"",note:"",frequency:"monthly",next_run_date:today()})}
 async function deleteCbRecurring(id){if(!confirm("Delete this recurring rule?"))return;const {error}=await supabase.from("cashbook_recurring").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadCbV8()}
 async function toggleCbRecurring(x){const {error}=await supabase.from("cashbook_recurring").update({active:!x.active}).eq("id",x.id);if(!error)loadCbV8()}
 async function processCbDueRecurring(){const dueRows=cbRecurring.filter(r=>r.active&&r.next_run_date<=today());if(!dueRows.length)return setMsg("Nothing due.");let count=0;for(const r of dueRows){let next=r.next_run_date;let guard=0;while(next<=today()&&guard<24){await supabase.from("cashbook_entries").insert({user_id:uid(),entry_date:next,type:r.type,category:r.category||"General",channel:r.channel,amount:r.amount,note:`${r.note||""} (recurring)`.trim()});next=addByFreq(next,r.frequency);count++;guard++}await supabase.from("cashbook_recurring").update({next_run_date:next}).eq("id",r.id)}setMsg(`${count} recurring entr${count===1?"y":"ies"} posted.`);loadCashbook();loadCbV8()}

 // ---- V8: Budgets & Alerts (Cash Book) — tracked per category, per month, against Cash Out entries. ----
 async function saveCbBudget(e){e.preventDefault();if(!cbBudgetForm.category.trim())return setMsg("Enter a category.");if(!+cbBudgetForm.amount_limit)return setMsg("Enter a limit.");const {error}=await supabase.from("cashbook_budgets").upsert({...cbBudgetForm,category:cbBudgetForm.category.trim(),amount_limit:+cbBudgetForm.amount_limit,user_id:uid()},{onConflict:"user_id,category,month"});setMsg(friendly(error?.message)||"Budget saved.");if(!error){setCbBudgetForm({...cbBudgetForm,amount_limit:""});loadCbV8()}}
 async function deleteCbBudget(id){if(!confirm("Delete this budget?"))return;const {error}=await supabase.from("cashbook_budgets").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadCbV8()}
 function cbBudgetSpent(category,month){return cbEntries.filter(x=>x.type==="out"&&x.category===category&&x.entry_date.slice(0,7)===month).reduce((s,x)=>s+ +x.amount,0)}

 // ---- V8: Multi-currency display (Cash Book) — Cash Book always stores Taka; conversion is display-only, used on the Analytics tab. ----
 async function saveCbExRate(e){e.preventDefault();if(!+cbExForm.rate)return setMsg("Enter a rate.");const {error}=await supabase.from("cashbook_exchange_rates").upsert({user_id:uid(),currency:cbExForm.currency,rate:+cbExForm.rate,updated_at:new Date().toISOString()},{onConflict:"user_id,currency"});setMsg(friendly(error?.message)||"Rate saved.");if(!error){setCbExForm({...cbExForm,rate:""});loadCbV8()}}
 async function deleteCbExRate(id){const {error}=await supabase.from("cashbook_exchange_rates").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadCbV8()}
 function cbConvert(amount){if(!cbDispCurrency)return amount;const r=cbExRates.find(x=>x.currency===cbDispCurrency);return r?amount*+r.rate:amount}
 function cbDispFmt(amount){if(!cbDispCurrency)return cbFmt(amount);const sym=currencySymbols[cbDispCurrency]||cbDispCurrency;return `${sym}${money(cbConvert(amount))}`}

 // ---- Personal Expense: individual spending tracker, scoped to this user only. ----
 async function loadPersonal(){const {data,error}=await supabase.from("personal_expenses").select("*").eq("user_id",session.user.id).order("expense_date",{ascending:false}).order("created_at",{ascending:false});if(!error)setPeEntries(data||[]);else setMsg(friendly(error.message))}
 async function savePeEntry(e){e.preventDefault();if(!+peForm.amount)return setMsg("Enter an amount.");const payload={expense_date:peForm.expense_date,category:peForm.category,amount:+peForm.amount,note:peForm.note.trim()};let error;if(peEditing){({error}=await supabase.from("personal_expenses").update(payload).eq("id",peEditing))}else{({error}=await supabase.from("personal_expenses").insert({...payload,user_id:session.user.id}))}setMsg(friendly(error?.message)||(peEditing?"Expense updated.":"Expense saved."));if(!error){setPeForm({expense_date:peForm.expense_date,category:peForm.category,amount:"",note:""});setPeEditing(null);loadPersonal()}}
 function editPe(x){setPeEditing(x.id);setPeForm({expense_date:x.expense_date,category:x.category,amount:x.amount,note:x.note||""})}
 function cancelPe(){setPeEditing(null);setPeForm({expense_date:today(),category:"Food",amount:"",note:""})}
 async function deletePeEntry(id){if(!confirm("Delete this expense?"))return;const {error}=await supabase.from("personal_expenses").delete().eq("id",id);setMsg(friendly(error?.message)||"Deleted.");if(!error)loadPersonal()}

 // Resizes/re-compresses a receipt photo client-side before upload: fixes
 // sideways phone-camera photos (EXIF orientation) and shrinks huge photos
 // (often several MB) down to a small JPEG so uploads are fast and storage stays cheap.
 async function compressImage(file){
  if(!file.type||!file.type.startsWith("image/"))return file;
  try{
   const bitmap=await createImageBitmap(file,{imageOrientation:"from-image"});
   const maxDim=1600;let w=bitmap.width,h=bitmap.height;
   if(w>maxDim||h>maxDim){const scale=maxDim/Math.max(w,h);w=Math.round(w*scale);h=Math.round(h*scale)}
   const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
   const ctx=canvas.getContext("2d");ctx.drawImage(bitmap,0,0,w,h);
   const blob=await new Promise(res=>canvas.toBlob(res,"image/jpeg",0.8));
   return blob||file;
  }catch(e){return file}
 }
 async function uploadReceipt(file){const processed=await compressImage(file);const isJpeg=processed!==file;const ext=isJpeg?"jpg":(file.name.split(".").pop()||"jpg").toLowerCase();const path=`${businessId}/${crypto.randomUUID()}.${ext}`;const {error}=await supabase.storage.from("receipts").upload(path,processed,{contentType:isJpeg?"image/jpeg":file.type});if(error){setMsg(error.message);return null}return supabase.storage.from("receipts").getPublicUrl(path).data.publicUrl}
 async function saveTx(e){e.preventDefault();if(!allowed("admin","manager","member","agent"))return setMsg("Permission denied.");if(!form.person_id||!+form.amount)return setMsg("Select person and amount.");
  let receipt_url=form.receipt_url||null;
  if(receiptFile){const up=await uploadReceipt(receiptFile);if(up)receipt_url=up}
  const payload={...form,amount:+form.amount,receipt_url,business_id:businessId};let error,data;
  if(editing){({error}=await supabase.from("transactions").update(payload).eq("id",editing));if(!error)await audit("UPDATE","transactions",editing,JSON.stringify(payload));setMsg(friendly(error?.message)||"Transaction updated.");setEditing(null)}
  else {({data,error}=await supabase.from("transactions").insert({...payload,created_by:session.user.id}).select().single());if(!error)await audit("CREATE","transactions",data.id,JSON.stringify(payload));setMsg(friendly(error?.message)||"Transaction saved.")}
  if(!error){setForm({...form,person_id:"",amount:"",note:"",receipt_url:""});setReceiptFile(null);loadData(businessId)}
 }
 function editTx(t){setEditing(t.id);setForm({type:t.type,person_type:t.person_type,person_id:t.person_id,channel:t.channel,amount:t.amount,note:t.note||"",receipt_url:t.receipt_url||"",transaction_date:t.transaction_date});setReceiptFile(null);setTab("transactions")}
 async function deleteTx(id){if(!allowed("admin","manager"))return setMsg("Only Admin/Manager can delete.");if(!confirm("Delete this transaction?"))return;const {error}=await supabase.from("transactions").delete().eq("id",id);if(!error)await audit("DELETE","transactions",id,"Transaction deleted");setMsg(friendly(error?.message)||"Transaction deleted.");if(!error)loadData(businessId)}
 async function addOpening(e){e.preventDefault();if(!allowed("admin","manager"))return setMsg("Permission denied.");const {data,error}=await supabase.from("opening_balances").insert({...opening,amount:+opening.amount,business_id:businessId,created_by:session.user.id}).select().single();if(!error)await audit("CREATE","opening_balances",data.id,JSON.stringify(opening));setMsg(friendly(error?.message)||"Opening balance saved.");if(!error){setOpening({...opening,amount:"",note:""});loadData(businessId)}}
 async function dailyClose(){if(!allowed("admin","manager","super_admin"))return setMsg("Only authorized users can close a day.");const net=dayStats.collection-dayStats.fund-dayStats.expense;const {data,error}=await supabase.from("daily_closings").upsert({business_id:businessId,closing_date:closeDate,total_fund:dayStats.fund,total_collection:dayStats.collection,total_expense:dayStats.expense,net_result:net,closed_by:session.user.id},{onConflict:"business_id,closing_date"}).select().single();if(!error)await audit("CLOSE","daily_closings",data.id,closeDate);setMsg(friendly(error?.message)||"Daily closing saved.");if(!error)loadData(businessId)}
 function personLedger(id,date=""){const rows=tx.filter(t=>t.person_id===id&&(!date||t.transaction_date===date));return sumTx(rows)}

 async function addMemberByEmail(e){e.preventDefault();if(!canAdmin)return setMsg("Permission denied.");const email=addMemberEmail.trim();if(!email)return;const {data:uid,error:e1}=await supabase.rpc("find_user_id_by_email",{lookup_email:email});if(e1||!uid)return setMsg("No account found for that email yet — ask them to sign in with Google once first, then try again.");const {error}=await supabase.from("business_members").insert({business_id:businessId,user_id:uid,role:"pending"});if(!error)await audit("CREATE","business_members",uid,`added ${email}`);setMsg(friendly(error?.message)||"User added — set their role below.");if(!error){setAddMemberEmail("");loadData(businessId)}}
 async function updateMemberRole(memberRowId,userId,role){if(!canAdmin)return setMsg("Permission denied.");const {error}=await supabase.from("business_members").update({role}).eq("id",memberRowId);if(!error)await audit("UPDATE","business_members",userId,`role -> ${role}`);setMsg(friendly(error?.message)||"Updated.");if(!error)loadData(businessId)}
 async function removeMember(memberRowId,userId){if(!canAdmin)return setMsg("Permission denied.");if(!confirm("Remove this user from the business?"))return;const {error}=await supabase.from("business_members").delete().eq("id",memberRowId);if(!error)await audit("DELETE","business_members",userId,"removed from business");setMsg(friendly(error?.message)||"Removed.");if(!error)loadData(businessId)}
 async function addChannel(e){e.preventDefault();if(!canManage)return setMsg("Permission denied.");const nm=newChannel.trim();if(!nm)return setMsg("Enter a channel name.");const {data,error}=await supabase.from("channels").insert({business_id:businessId,name:nm}).select().single();if(!error)await audit("CREATE","channels",data.id,nm);setMsg(friendly(error?.message)||"Channel added.");if(!error){setNewChannel("");loadData(businessId)}}
 async function toggleChannel(c){if(!canManage)return setMsg("Permission denied.");const {error}=await supabase.from("channels").update({active:!c.active}).eq("id",c.id);if(!error)await audit("UPDATE","channels",c.id,`active -> ${!c.active}`);setMsg(friendly(error?.message)||"Channel updated.");if(!error)loadData(businessId)}
 function enableReminder(time){if(!time)return;if(typeof Notification!=="undefined"&&Notification.permission!=="granted"){Notification.requestPermission().then(perm=>{if(perm==="granted"){localStorage.setItem("isf_reminder",time);setReminderState(time)}else setMsg("Browser notification permission was denied.")});return}localStorage.setItem("isf_reminder",time);setReminderState(time)}
 function disableReminder(){localStorage.removeItem("isf_reminder");setReminderState("")}
 function enableBackupReminder(day,time){if(!time)return;const val=`${day}|${time}`;if(typeof Notification!=="undefined"&&Notification.permission!=="granted"){Notification.requestPermission().then(perm=>{if(perm==="granted"){localStorage.setItem("isf_backup_reminder",val);setBackupReminderState(val)}else setMsg("Browser notification permission was denied.")});return}localStorage.setItem("isf_backup_reminder",val);setBackupReminderState(val)}
 function disableBackupReminder(){localStorage.removeItem("isf_backup_reminder");setBackupReminderState("")}
 // One-click full backup: bundles everything for the current business into one
 // JSON file the user downloads and can save anywhere (e.g. upload to Google Drive).
 function downloadBackup(){
  const payload={exported_at:new Date().toISOString(),business:currentBiz,members,agents,transactions:tx,daily_closings:closings,opening_balances:openingsDb,channels:channelsDb,team:bizMembers,audit_log:auditLog};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const objUrl=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=objUrl;a.download=`${(currentBiz?.name||"ISF").replace(/\s+/g,"_")}-Backup-${today()}.json`;
  document.body.appendChild(a);a.click();a.remove();
  URL.revokeObjectURL(objUrl);
  localStorage.setItem("isf_last_backup",today());
  setMsg("Backup downloaded. Save it to Google Drive (or similar) so it's safe even if this device is lost.");
 }

 function reportText(){return `${currentBiz?.name||"ISF"} Daily Report ${closeDate}\nFund Given: ${fmt(dayStats.fund)}\nCollection: ${fmt(dayStats.collection)}\nExpense: ${fmt(dayStats.expense)}\nNet Result: ${fmt(dayStats.collection-dayStats.fund-dayStats.expense)}\n\nChannel Closing:\n${channelClosing.map(x=>`${x.channel}: ${fmt(x.closing)}`).join("\n")}`}
 function shareText(){const text=reportText();navigator.clipboard?.writeText(text);if(navigator.share)navigator.share({title:"Daily Report",text}).catch(()=>{});else setMsg("Report copied.")}
 function shareWhatsApp(){window.open(`https://wa.me/?text=${encodeURIComponent(reportText())}`,"_blank")}
 function shareTelegram(){window.open(`https://t.me/share/url?url=&text=${encodeURIComponent(reportText())}`,"_blank")}
 function makePDF(){const d=new jsPDF();d.text(`${currentBiz?.name||"ISF Business Ledger"}`,14,15);d.text(`Daily Report: ${closeDate}`,14,23);d.autoTable({startY:30,head:[["Date","Type","Person","Channel","Amount"]],body:dayTx.map(t=>[t.transaction_date,t.type,name(t.person_id),t.channel,money(t.amount)])});const y=(d.lastAutoTable?.finalY||50)+12;d.text(`Fund: ${money(dayStats.fund)} | Collection: ${money(dayStats.collection)} | Expense: ${money(dayStats.expense)}`,14,y);d.text(`Net Result: ${money(dayStats.collection-dayStats.fund-dayStats.expense)}`,14,y+8);return d}
 function exportPDF(){makePDF().save(`Daily-${closeDate}.pdf`)}
 async function sharePDF(){const d=makePDF();const blob=d.output("blob");const file=new File([blob],`Daily-${closeDate}.pdf`,{type:"application/pdf"});if(navigator.canShare?.({files:[file]})){try{await navigator.share({title:"Daily Report",text:reportText(),files:[file]});return}catch(e){}}exportPDF();setMsg("PDF downloaded. WhatsApp/Telegram direct links cannot attach local files; use the phone Share option when supported.")}
 function exportExcel(){const rows=tx.map(t=>({Date:t.transaction_date,Type:t.type,Person:name(t.person_id),Channel:t.channel,Amount:+t.amount,Receipt:t.receipt_url||"",Note:t.note||""}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),"Transactions");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(people.map(p=>({Type:p.person_type,Name:p.name,Phone:p.phone||"",Fund:personLedger(p.id).fund,Collection:personLedger(p.id).collection,Expense:personLedger(p.id).expense,Net:personLedger(p.id).collection-personLedger(p.id).fund-personLedger(p.id).expense}))),"People Ledger");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(channelClosing),"Channel Closing");XLSX.writeFile(wb,`${currentBiz?.name||"ISF"}-${today()}.xlsx`)}
 const filtered=useMemo(()=>tx.filter(t=>(!filter.dateFrom||t.transaction_date>=filter.dateFrom)&&(!filter.dateTo||t.transaction_date<=filter.dateTo)&&(!filter.person||t.person_id===filter.person)&&(!filter.channel||t.channel===filter.channel)&&(!filter.type||t.type===filter.type)),[tx,filter]);
 const cbTotals=useMemo(()=>cbEntries.reduce((a,x)=>{const v=+x.amount||0;if(x.type==="in")a.in+=v;else a.out+=v;return a},{in:0,out:0}),[cbEntries]);
 const peTotal=useMemo(()=>peEntries.reduce((s,x)=>s+(+x.amount||0),0),[peEntries]);
 const peByCategory=useMemo(()=>{const m={};peEntries.forEach(x=>{m[x.category]=(m[x.category]||0)+(+x.amount||0)});return Object.entries(m).sort((a,b)=>b[1]-a[1])},[peEntries]);

 if(!supabase)return <Setup/>;
 if(loading)return <div className="center">Loading...</div>;
 if(!session)return <Login login={login} message={msg}/>;
 if(!appMode)return <AppChooser choose={setAppMode} email={session.user.email} logout={logout}/>;
 if(appMode==="cashbook")return <CashBookApp entries={cbEntries} form={cbForm} setForm={setCbForm} submit={saveCbEntry} editing={cbEditing} edit={editCb} del={deleteCbEntry} cancel={cancelCb} totals={cbTotals} email={session.user.email} logout={logout} back={()=>setAppMode("")} msg={msg} setMsg={setMsg} cbTab={cbTab} setCbTab={setCbTab} contacts={contacts} contactForm={contactForm} setContactForm={setContactForm} saveContact={saveContact} deleteContact={deleteContact} ledgerEntries={ledgerEntries} ledgerForm={ledgerForm} setLedgerForm={setLedgerForm} saveLedgerEntry={saveLedgerEntry} ledgerEditing={ledgerEditing} editLedger={editLedger} cancelLedger={cancelLedger} deleteLedgerEntry={deleteLedgerEntry} contactBalance={contactBalance} sendReminder={sendReminder} exportExcel={exportCbExcel} exportPDF={exportCbPDF} backup={downloadCbBackup}
  invItems={cbInvItems} invMovements={cbInvMovements} invForm={cbInvForm} setInvForm={setCbInvForm} saveInv={saveCbInvItem} invEditing={cbInvEditing} editInv={editCbInvItem} cancelInv={cancelCbInvItem} delInv={deleteCbInvItem} moveForm={cbMoveForm} setMoveForm={setCbMoveForm} saveMove={saveCbMovement}
  invoices={cbInvoices} invoiceForm={cbInvoiceForm} setInvoiceForm={setCbInvoiceForm} lineItems={cbLineItems} addLine={()=>addLineItem(cbLineItems,setCbLineItems)} removeLine={i=>removeLineItem(cbLineItems,setCbLineItems,i)} updateLine={(i,f,v)=>updateLineItem(cbLineItems,setCbLineItems,cbInvItems,i,f,v)} saveInvoice={saveCbInvoice} invoiceEditing={cbInvoiceEditing} editInvoice={editCbInvoice} cancelInvoice={cancelCbInvoice} delInvoice={deleteCbInvoice} invoicePdf={cbInvoicePDF}
  recurring={cbRecurring} recForm={cbRecForm} setRecForm={setCbRecForm} saveRec={saveCbRecurring} recEditing={cbRecEditing} editRec={editCbRecurring} cancelRec={cancelCbRecurring} delRec={deleteCbRecurring} toggleRec={toggleCbRecurring} processDue={processCbDueRecurring}
  budgets={cbBudgets} budgetForm={cbBudgetForm} setBudgetForm={setCbBudgetForm} saveBudget={saveCbBudget} delBudget={deleteCbBudget} budgetSpent={cbBudgetSpent}
  dispCurrency={cbDispCurrency} setDispCurrency={setCbDispCurrency} exRates={cbExRates} exForm={cbExForm} setExForm={setCbExForm} saveExRate={saveCbExRate} deleteExRate={deleteCbExRate} dispFmt={cbDispFmt}
 />;
 if(appMode==="personal")return <PersonalExpenseApp entries={peEntries} form={peForm} setForm={setPeForm} submit={savePeEntry} editing={peEditing} edit={editPe} del={deletePeEntry} cancel={cancelPe} total={peTotal} byCategory={peByCategory} email={session.user.email} logout={logout} back={()=>setAppMode("")} msg={msg} setMsg={setMsg}/>;
 if(!bizLoaded)return <div className="center">Loading...</div>;
 if(!businesses.length)return <CreateBusinessScreen name={newBizName} setName={setNewBizName} currency={newBizCurrency} setCurrency={setNewBizCurrency} create={createBusiness} logout={logout} back={()=>setAppMode("")} message={msg}/>;
 if(!currentBiz||currentBiz.role==="pending")return <PendingScreen email={session.user.email} businesses={businesses} currentId={businessId} switchBusiness={switchBusiness} createBusiness={createBusiness} newBizName={newBizName} setNewBizName={setNewBizName} newBizCurrency={newBizCurrency} setNewBizCurrency={setNewBizCurrency} refresh={loadBusinesses} logout={logout} back={()=>setAppMode("")} message={msg}/>;

 const tabs=["dashboard","transactions","ledger","closing","people","inventory","invoices","recurring","budgets","analytics","reports","settings",...(canManage?["audit"]:[]),...(canAdmin?["users"]:[])];
 const monthlyChart=useMemo(()=>{const months=[...Array(6)].map((_,i)=>{const d=new Date();d.setMonth(d.getMonth()-(5-i));return d.toISOString().slice(0,7)});return months.map(m=>({label:m.slice(5),value:tx.filter(t=>t.type==="expense"&&t.transaction_date.slice(0,7)===m).reduce((s,t)=>s+ +t.amount,0)}))},[tx]);
 const channelChart=useMemo(()=>channelNames.map(c=>({label:c,value:tx.filter(t=>t.channel===c&&t.type==="collection").reduce((s,t)=>s+ +t.amount,0)})),[channelNames,tx]);
 const lowStockItems=useMemo(()=>invItems.filter(x=>+x.quantity<=+x.low_stock_threshold),[invItems]);
 return <div className="app"><header className="topbar"><b>ISF Business Ledger <span>V5</span></b><div className="user"><select value={businessId} onChange={e=>switchBusiness(e.target.value)}>{businesses.filter(b=>b.role!=="pending").map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>{session.user.email}<button onClick={()=>setAppMode("")}>Switch App</button><button onClick={logout}>Logout</button></div></header><div className="layout"><aside>{tabs.map(x=><button className={tab===x?"active":""} onClick={()=>setTab(x)} key={x}>{x[0].toUpperCase()+x.slice(1)}</button>)}</aside><main>{msg&&<div className="notice">{msg}<button onClick={()=>setMsg("")}>×</button></div>}
 {tab==="dashboard"&&<Dashboard totals={totals} dayStats={dayStats} date={closeDate} people={people} tx={tx} channelClosing={channelClosing} fmt={fmt}/>}
 {tab==="transactions"&&<Transactions form={form} setForm={setForm} submit={saveTx} members={members} agents={agents} editing={editing} cancel={()=>{setEditing(null);setForm({...form,person_id:"",amount:"",note:"",receipt_url:""});setReceiptFile(null)}} channelNames={channelNames} receiptFile={receiptFile} setReceiptFile={setReceiptFile}/>}
 {tab==="ledger"&&<Ledger agents={agents} members={members} ledger={personLedger} date={closeDate} setDate={setCloseDate} fmt={fmt}/>}
 {tab==="closing"&&<Closing date={closeDate} setDate={setCloseDate} stats={dayStats} close={dailyClose} openings={opening} setOpening={setOpening} addOpening={addOpening} channelClosing={channelClosing} channelNames={channelNames} share={shareText} whatsapp={shareWhatsApp} telegram={shareTelegram} pdf={sharePDF} fmt={fmt}/>}
 {tab==="people"&&<People person={person} setPerson={setPerson} add={addPerson} members={members} agents={agents} toggle={togglePerson} canManage={canManage}/>}
 {tab==="inventory"&&<Inventory items={invItems} movements={invMovements} form={invForm} setForm={setInvForm} save={saveInvItem} editing={invEditing} edit={editInvItem} cancel={cancelInvItem} del={deleteInvItem} moveForm={moveForm} setMoveForm={setMoveForm} saveMove={saveMovement} fmt={fmt} canManage={canManage}/>}
 {tab==="invoices"&&<Invoices invoices={invoices} invItems={invItems} form={invoiceForm} setForm={setInvoiceForm} lineItems={lineItems} addLine={()=>addLineItem(lineItems,setLineItems)} removeLine={i=>removeLineItem(lineItems,setLineItems,i)} updateLine={(i,f,v)=>updateLineItem(lineItems,setLineItems,invItems,i,f,v)} save={saveInvoice} editing={invoiceEditing} edit={editInvoice} cancel={cancelInvoice} del={deleteInvoice} pdf={invoicePDF} fmt={fmt} canManage={canManage}/>}
 {tab==="recurring"&&<Recurring rows={recurring} form={recForm} setForm={setRecForm} save={saveRecurring} editing={recEditing} edit={editRecurring} cancel={cancelRecurring} del={deleteRecurring} toggle={toggleRecurring} processDue={processDueRecurring} members={members} agents={agents} channelNames={channelNames} name={name} fmt={fmt} canManage={canManage}/>}
 {tab==="budgets"&&<Budgets budgets={budgets} form={budgetForm} setForm={setBudgetForm} save={saveBudget} del={deleteBudget} channelNames={channelNames} spent={budgetSpent} fmt={fmt} canManage={canManage}/>}
 {tab==="analytics"&&<AnalyticsView title="Business Analytics" monthlyChart={monthlyChart} monthlyTitle="Monthly Expense (last 6 months)" byGroupChart={channelChart} byGroupTitle="Collection by Channel" lowStock={lowStockItems} currencyList={currencyList} baseCurrency={currentBiz?.currency} dispCurrency={dispCurrency} setDispCurrency={setDispCurrency} exRates={exRates} exForm={exForm} setExForm={setExForm} saveExRate={saveExRate} deleteExRate={deleteExRate} canEditRates={canAdmin} fmt={dispFmt}/>}
 {tab==="reports"&&<Reports tx={filtered} allTx={tx} name={name} pdf={exportPDF} excel={exportExcel} filter={filter} setFilter={setFilter} edit={editTx} del={deleteTx} people={people} allChannelNames={allChannelNames} fmt={fmt}/>}
 {tab==="settings"&&<Settings profile={profile} channelsDb={channelsDb} canManage={canManage} canAdmin={canAdmin} newChannel={newChannel} setNewChannel={setNewChannel} addChannel={addChannel} toggleChannel={toggleChannel} reminder={reminder} enableReminder={enableReminder} disableReminder={disableReminder} myRole={myRole} businesses={businesses} businessId={businessId} switchBusiness={switchBusiness} newBizName={newBizName} setNewBizName={setNewBizName} newBizCurrency={newBizCurrency} setNewBizCurrency={setNewBizCurrency} createBusiness={createBusiness} bizNameEdit={bizNameEdit} setBizNameEdit={setBizNameEdit} bizCurrencyEdit={bizCurrencyEdit} setBizCurrencyEdit={setBizCurrencyEdit} updateBusinessInfo={updateBusinessInfo} backupReminder={backupReminder} enableBackupReminder={enableBackupReminder} disableBackupReminder={disableBackupReminder} downloadBackup={downloadBackup}/>}
 {tab==="audit"&&canManage&&<AuditLog auditLog={auditLog}/>}
 {tab==="users"&&canAdmin&&<UsersManagement bizMembers={bizMembers} addMemberEmail={addMemberEmail} setAddMemberEmail={setAddMemberEmail} addMemberByEmail={addMemberByEmail} updateMemberRole={updateMemberRole} removeMember={removeMember} currentUserId={session.user.id}/>}
 </main></div></div>
}

const Stat=({title,value,fmt})=><div className="card stat"><span>{title}</span><strong>{fmt(value)}</strong></div>;
function Login({login,message}){return <div className="login"><div className="card login-card"><h1>ISF Business Ledger V5</h1><p>Multi-Business • Distributor • Agent • Daily Settlement</p><button className="primary wide" onClick={login}>Continue with Google</button>{message&&<p className="error">{message}</p>}<small>Cloud saved • Mobile friendly • Secure per-business roles • New accounts require admin approval</small></div></div>}
function CreateBusinessScreen({name,setName,currency,setCurrency,create,logout,back,message}){return <div className="login"><div className="card login-card"><h1>ISF Business Ledger V5</h1><p><b>Create your first business</b></p><p className="muted">You'll become its Super Admin. You can add teammates afterward from the Users tab.</p><form className="form" onSubmit={create}><label>Business name<input required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. ISF Distribution"/></label><label>Currency<select value={currency} onChange={e=>setCurrency(e.target.value)}>{currencyList.map(c=><option key={c}>{c}</option>)}</select></label><button className="primary wide">Create Business</button></form>{message&&<p className="error">{message}</p>}<div className="center-actions">{back&&<button onClick={back}>Switch App</button>}<button onClick={logout}>Logout</button></div></div></div>}
function PendingScreen({email,businesses,currentId,switchBusiness,createBusiness,newBizName,setNewBizName,newBizCurrency,setNewBizCurrency,refresh,logout,back,message}){const approved=businesses.filter(b=>b.role!=="pending");return <div className="login"><div className="card login-card"><h1>ISF Business Ledger V5</h1><p><b>Waiting for approval</b></p><p className="muted">Signed in as {email}. An admin of this business needs to approve you before you can see or enter any data.</p>{approved.length>0&&<div className="form"><label>Switch to a business you're already approved in<select value={currentId} onChange={e=>switchBusiness(e.target.value)}>{approved.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>}<div className="center-actions"><button className="primary" onClick={refresh}>Refresh</button>{back&&<button onClick={back}>Switch App</button>}<button onClick={logout}>Logout</button></div><hr/><p className="muted">Or create your own new business instead:</p><form className="form" onSubmit={createBusiness}><label>Business name<input value={newBizName} onChange={e=>setNewBizName(e.target.value)}/></label><label>Currency<select value={newBizCurrency} onChange={e=>setNewBizCurrency(e.target.value)}>{currencyList.map(c=><option key={c}>{c}</option>)}</select></label><button className="primary">Create Business</button></form>{message&&<p className="error">{message}</p>}</div></div>}

// ==================== App Chooser + Cash Book + Personal Expense ====================
// These two extra tools are intentionally simple and single-user (no roles, no team,
// no business_id) — just a quick cash log or personal spend tracker for whoever is
// signed in. Business Ledger keeps all its existing multi-user/role behaviour untouched.
function AppChooser({choose,email,logout}){return <div className="login"><div className="card login-card chooser"><h1>ISF Suite</h1><p className="muted">Signed in as {email}</p><div className="chooser-list"><button className="chooser-btn" onClick={()=>choose("business")}><span>📊 Business Ledger</span><small>Multi-business, team roles, agents, daily closing</small></button><button className="chooser-btn" onClick={()=>choose("cashbook")}><span>💵 Cash Book</span><small>Simple daily cash in / cash out log</small></button><button className="chooser-btn" onClick={()=>choose("personal")}><span>🧾 Personal Expense</span><small>Track your own personal spending</small></button></div><div className="center-actions"><button onClick={logout}>Logout</button></div></div></div>}

function CashBookApp({entries,form,setForm,submit,editing,edit,del,cancel,totals,email,logout,back,msg,setMsg,cbTab,setCbTab,contacts,contactForm,setContactForm,saveContact,deleteContact,ledgerEntries,ledgerForm,setLedgerForm,saveLedgerEntry,ledgerEditing,editLedger,cancelLedger,deleteLedgerEntry,contactBalance,sendReminder,exportExcel,exportPDF,backup,
 invItems,invMovements,invForm,setInvForm,saveInv,invEditing,editInv,cancelInv,delInv,moveForm,setMoveForm,saveMove,
 invoices,invoiceForm,setInvoiceForm,lineItems,addLine,removeLine,updateLine,saveInvoice,invoiceEditing,editInvoice,cancelInvoice,delInvoice,invoicePdf,
 recurring,recForm,setRecForm,saveRec,recEditing,editRec,cancelRec,delRec,toggleRec,processDue,
 budgets,budgetForm,setBudgetForm,saveBudget,delBudget,budgetSpent,
 dispCurrency,setDispCurrency,exRates,exForm,setExForm,saveExRate,deleteExRate,dispFmt
}){
 const balance=totals.in-totals.out;
 const totalReceivable=contacts.reduce((s,c)=>{const b=contactBalance(c.id);return s+(b>0?b:0)},0);
 const totalPayable=contacts.reduce((s,c)=>{const b=contactBalance(c.id);return s+(b<0?-b:0)},0);
 const lowStockItems=invItems.filter(x=>+x.quantity<=+x.low_stock_threshold);
 const monthlyChart=[...Array(6)].map((_,i)=>{const d=new Date();d.setMonth(d.getMonth()-(5-i));const m=d.toISOString().slice(0,7);return {label:m.slice(5),value:entries.filter(x=>x.type==="out"&&x.entry_date.slice(0,7)===m).reduce((s,x)=>s+ +x.amount,0)}});
 const catTotals={};entries.filter(x=>x.type==="out").forEach(x=>{catTotals[x.category]=(catTotals[x.category]||0)+ +x.amount});
 const categoryChart=Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([label,value])=>({label,value}));
 return <div className="app"><header className="topbar"><b>Cash Book</b><div className="user">{email}<button onClick={back}>Switch App</button><button onClick={logout}>Logout</button></div></header><main>
 {msg&&<div className="notice">{msg}<button onClick={()=>setMsg("")}>×</button></div>}
 <div className="actions" style={{marginBottom:18,flexWrap:"wrap"}}>
  <button className={cbTab==="entries"?"primary":""} onClick={()=>setCbTab("entries")}>Cash Entries</button>
  <button className={cbTab==="khata"?"primary":""} onClick={()=>setCbTab("khata")}>Khata</button>
  <button className={cbTab==="inventory"?"primary":""} onClick={()=>setCbTab("inventory")}>Inventory</button>
  <button className={cbTab==="invoices"?"primary":""} onClick={()=>setCbTab("invoices")}>Invoices</button>
  <button className={cbTab==="recurring"?"primary":""} onClick={()=>setCbTab("recurring")}>Recurring</button>
  <button className={cbTab==="budgets"?"primary":""} onClick={()=>setCbTab("budgets")}>Budgets</button>
  <button className={cbTab==="analytics"?"primary":""} onClick={()=>setCbTab("analytics")}>Analytics</button>
  <button onClick={exportPDF}>PDF</button><button onClick={exportExcel}>Excel</button><button onClick={backup}>Backup</button>
 </div>
 {cbTab==="inventory"&&<Inventory items={invItems} movements={invMovements} form={invForm} setForm={setInvForm} save={saveInv} editing={invEditing} edit={editInv} cancel={cancelInv} del={delInv} moveForm={moveForm} setMoveForm={setMoveForm} saveMove={saveMove} fmt={cbFmt} canManage={true}/>}
 {cbTab==="invoices"&&<Invoices invoices={invoices} invItems={invItems} form={invoiceForm} setForm={setInvoiceForm} lineItems={lineItems} addLine={addLine} removeLine={removeLine} updateLine={updateLine} save={saveInvoice} editing={invoiceEditing} edit={editInvoice} cancel={cancelInvoice} del={delInvoice} pdf={invoicePdf} fmt={cbFmt} canManage={true}/>}
 {cbTab==="recurring"&&<CbRecurring rows={recurring} form={recForm} setForm={setRecForm} save={saveRec} editing={recEditing} edit={editRec} cancel={cancelRec} del={delRec} toggle={toggleRec} processDue={processDue} fmt={cbFmt}/>}
 {cbTab==="budgets"&&<CbBudgets budgets={budgets} form={budgetForm} setForm={setBudgetForm} save={saveBudget} del={delBudget} spent={budgetSpent} fmt={cbFmt}/>}
 {cbTab==="analytics"&&<AnalyticsView title="Cash Book Analytics" monthlyChart={monthlyChart} monthlyTitle="Monthly Cash Out (last 6 months)" byGroupChart={categoryChart} byGroupTitle="Top Expense Categories" lowStock={lowStockItems} currencyList={currencyList} baseCurrency="BDT" dispCurrency={dispCurrency} setDispCurrency={setDispCurrency} exRates={exRates} exForm={exForm} setExForm={setExForm} saveExRate={saveExRate} deleteExRate={deleteExRate} canEditRates={true} fmt={dispFmt}/>}
 {cbTab==="entries"&&<>
  <div className="stats"><Stat title="Total Cash In" value={totals.in} fmt={cbFmt}/><Stat title="Total Cash Out" value={totals.out} fmt={cbFmt}/><Stat title="Balance" value={balance} fmt={cbFmt}/></div>
  <div className="card"><h3>{editing?"Edit Entry":"Add Entry"}</h3><form className="form" onSubmit={submit}><label>Date<input type="date" value={form.entry_date} onChange={e=>setForm({...form,entry_date:e.target.value})}/></label><label>Type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="in">Cash In</option><option value="out">Cash Out</option></select></label><label>Channel<select value={form.channel} onChange={e=>setForm({...form,channel:e.target.value})}>{defaultChannels.map(c=><option key={c}>{c}</option>)}</select></label><label>Category<input value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="e.g. Sales, Rent"/></label><label>Amount<input required type="number" min="0.01" step=".01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label><label className="full">Note<input value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label><div className="actions"><button className="primary">{editing?"Update Entry":"Save Entry"}</button>{editing&&<button type="button" onClick={cancel}>Cancel</button>}</div></form></div>
  <div className="card"><div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Channel</th><th>Amount</th><th>Note</th><th>Action</th></tr></thead><tbody>{entries.map(x=><tr key={x.id}><td>{x.entry_date}</td><td>{x.type==="in"?"Cash In":"Cash Out"}</td><td>{x.category}</td><td>{x.channel}</td><td>{cbFmt(x.amount)}</td><td>{x.note||""}</td><td><button onClick={()=>edit(x)}>Edit</button><button className="danger" onClick={()=>del(x.id)}>Delete</button></td></tr>)}</tbody></table></div>{!entries.length&&<p className="muted">No entries yet.</p>}</div>
 </>}
 {cbTab==="khata"&&<>
  <div className="stats"><Stat title="You'll Get (মোট পাবেন)" value={totalReceivable} fmt={cbFmt}/><Stat title="You'll Give (মোট দিবেন)" value={totalPayable} fmt={cbFmt}/><Stat title="Net" value={totalReceivable-totalPayable} fmt={cbFmt}/></div>
  <div className="grid2">
   <div className="card"><h3>Add Customer / Supplier</h3><form className="form" onSubmit={saveContact}><label>Type<select value={contactForm.type} onChange={e=>setContactForm({...contactForm,type:e.target.value})}><option value="customer">Customer</option><option value="supplier">Supplier</option></select></label><label>Name<input required value={contactForm.name} onChange={e=>setContactForm({...contactForm,name:e.target.value})}/></label><label>Phone (for WhatsApp reminder)<input value={contactForm.phone} onChange={e=>setContactForm({...contactForm,phone:e.target.value})} placeholder="8801XXXXXXXXX"/></label><button className="primary">Add</button></form></div>
   <div className="card"><h3>{ledgerEditing?"Edit Ledger Entry":"Add Ledger Entry"}</h3><form className="form" onSubmit={saveLedgerEntry}><label className="full">Contact<select value={ledgerForm.contact_id} onChange={e=>setLedgerForm({...ledgerForm,contact_id:e.target.value})}><option value="">Select...</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}</select></label><label>Type<select value={ledgerForm.entry_type} onChange={e=>setLedgerForm({...ledgerForm,entry_type:e.target.value})}><option value="you_will_get">You'll Get (+)</option><option value="you_will_give">You'll Give (−)</option></select></label><label>Date<input type="date" value={ledgerForm.entry_date} onChange={e=>setLedgerForm({...ledgerForm,entry_date:e.target.value})}/></label><label>Amount<input required type="number" min="0.01" step=".01" value={ledgerForm.amount} onChange={e=>setLedgerForm({...ledgerForm,amount:e.target.value})}/></label><label className="full">Note<input value={ledgerForm.note} onChange={e=>setLedgerForm({...ledgerForm,note:e.target.value})}/></label><div className="actions"><button className="primary">{ledgerEditing?"Update Entry":"Save Entry"}</button>{ledgerEditing&&<button type="button" onClick={cancelLedger}>Cancel</button>}</div></form></div>
  </div>
  <div className="card"><h3>Contacts & Balances</h3>{contacts.map(c=>{const b=contactBalance(c.id);return <div className="listrow" key={c.id}><b>{c.name}</b><span>{c.type} {c.phone&&`· ${c.phone}`}</span><strong>{b>=0?`You'll Get ${cbFmt(b)}`:`You'll Give ${cbFmt(-b)}`}</strong><div className="actions">{c.phone&&<button className="wa" onClick={()=>sendReminder(c)}>WhatsApp Reminder</button>}<button className="danger" onClick={()=>deleteContact(c.id)}>Delete</button></div></div>})}{!contacts.length&&<p className="muted">No contacts yet.</p>}</div>
  <div className="card"><h3>Ledger Entries</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Contact</th><th>Type</th><th>Amount</th><th>Note</th><th>Action</th></tr></thead><tbody>{ledgerEntries.map(x=><tr key={x.id}><td>{x.entry_date}</td><td>{contacts.find(c=>c.id===x.contact_id)?.name||"—"}</td><td>{x.entry_type==="you_will_get"?"You'll Get":"You'll Give"}</td><td>{cbFmt(x.amount)}</td><td>{x.note||""}</td><td><button onClick={()=>editLedger(x)}>Edit</button><button className="danger" onClick={()=>deleteLedgerEntry(x.id)}>Delete</button></td></tr>)}</tbody></table></div>{!ledgerEntries.length&&<p className="muted">No ledger entries yet.</p>}</div>
 </>}
 </main></div>}

function PersonalExpenseApp({entries,form,setForm,submit,editing,edit,del,cancel,total,byCategory,email,logout,back,msg,setMsg}){return <div className="app"><header className="topbar"><b>Personal Expense</b><div className="user">{email}<button onClick={back}>Switch App</button><button onClick={logout}>Logout</button></div></header><main>{msg&&<div className="notice">{msg}<button onClick={()=>setMsg("")}>×</button></div>}<div className="stats"><Stat title="Total Spent" value={total} fmt={cbFmt}/>{byCategory.slice(0,3).map(([cat,amt])=><Stat key={cat} title={cat} value={amt} fmt={cbFmt}/>)}</div><div className="card"><h3>{editing?"Edit Expense":"Add Expense"}</h3><form className="form" onSubmit={submit}><label>Date<input type="date" value={form.expense_date} onChange={e=>setForm({...form,expense_date:e.target.value})}/></label><label>Category<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{expenseCategories.map(c=><option key={c}>{c}</option>)}</select></label><label>Amount<input required type="number" min="0.01" step=".01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label><label className="full">Note<input value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label><div className="actions"><button className="primary">{editing?"Update Expense":"Save Expense"}</button>{editing&&<button type="button" onClick={cancel}>Cancel</button>}</div></form></div><div className="card"><h3>By Category</h3>{byCategory.map(([cat,amt])=><div className="listrow" key={cat}><b>{cat}</b><strong>{cbFmt(amt)}</strong></div>)}{!byCategory.length&&<p className="muted">No expenses yet.</p>}</div><div className="card"><div className="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Note</th><th>Action</th></tr></thead><tbody>{entries.map(x=><tr key={x.id}><td>{x.expense_date}</td><td>{x.category}</td><td>{cbFmt(x.amount)}</td><td>{x.note||""}</td><td><button onClick={()=>edit(x)}>Edit</button><button className="danger" onClick={()=>del(x.id)}>Delete</button></td></tr>)}</tbody></table></div>{!entries.length&&<p className="muted">No expenses yet.</p>}</div></main></div>}
function Setup(){return <div className="center"><div className="card"><h2>Supabase setup required</h2><p>Copy .env.example to .env, add Supabase credentials, and run supabase/schema.sql (new project) or the migration_*.sql files in order (existing project).</p></div></div>}

function Dashboard({totals,dayStats,date,people,tx,channelClosing,fmt}){return <section><h1>Dashboard</h1><p className="muted">Business overview — {date}</p><p className="muted small-note">Net Result = Collection − Fund Given − Expense · Channel Closing = Opening + Collection − Fund Given − Expense</p><div className="stats"><Stat title="Total Fund Given" value={totals.fund} fmt={fmt}/><Stat title="Total Collection" value={totals.collection} fmt={fmt}/><Stat title="Total Expense" value={totals.expense} fmt={fmt}/><Stat title="Day Net" value={dayStats.collection-dayStats.fund-dayStats.expense} fmt={fmt}/></div><div className="grid2"><div className="card"><h3>Today's Settlement</h3>{people.slice(0,8).map(p=>{const l=tx.filter(t=>t.person_id===p.id&&t.transaction_date===date);const s=l.reduce((a,t)=>a+(t.type==="fund_given"?+t.amount:t.type==="collection"?-+t.amount:0),0);return <div className="ledgerrow" key={p.id}><b>{p.name}</b><span>{p.person_type}</span><strong>Balance {fmt(s)}</strong></div>})}</div><div className="card"><h3>Channel Snapshot ({date})</h3>{channelClosing.map(x=><div className="ledgerrow" key={x.channel}><b>{x.channel}</b><span>Opening {fmt(x.opening)}</span><strong>Closing {fmt(x.closing)}</strong></div>)}</div></div></section>}

function Transactions({form,setForm,submit,members,agents,editing,cancel,channelNames,receiptFile,setReceiptFile}){let ps=(form.person_type==="member"?members:agents).filter(p=>p.active);return <section><h1>{editing?"Edit Transaction":"Transactions"}</h1><form className="card form" onSubmit={submit}><label>Type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="collection">Collection</option><option value="fund_given">Fund Given</option><option value="expense">Expense</option></select></label><label>Person Type<select value={form.person_type} onChange={e=>setForm({...form,person_type:e.target.value,person_id:""})}><option value="agent">Agent</option><option value="member">Member</option></select></label><label>Person<select value={form.person_id} onChange={e=>setForm({...form,person_id:e.target.value})}><option value="">Select...</option>{ps.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Channel<select value={form.channel} onChange={e=>setForm({...form,channel:e.target.value})}>{channelNames.map(x=><option key={x}>{x}</option>)}</select></label><label>Amount<input required type="number" min="0.01" step=".01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label><label>Date<input type="date" value={form.transaction_date} onChange={e=>setForm({...form,transaction_date:e.target.value})}/></label><label className="full">Note<input value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label><label className="full">Receipt Photo (optional)<input type="file" accept="image/*" onChange={e=>setReceiptFile(e.target.files[0]||null)}/>{form.receipt_url&&!receiptFile&&<a href={form.receipt_url} target="_blank" rel="noreferrer"> Current receipt</a>}</label><div className="actions"><button className="primary">{editing?"Update Transaction":"Save Transaction"}</button>{editing&&<button type="button" onClick={cancel}>Cancel</button>}</div></form></section>}

function Ledger({agents,members,ledger,date,setDate,fmt}){return <section><div className="section-head"><div><h1>Individual Ledger</h1><p className="muted">Select a date for daily settlement.</p></div><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div><div className="grid2"><LedgerList title="Agents" items={agents} ledger={ledger} date={date} fmt={fmt}/><LedgerList title="Members / Distributors" items={members} ledger={ledger} date={date} fmt={fmt}/></div></section>}
function LedgerList({title,items,ledger,date,fmt}){return <div className="card"><h3>{title}</h3>{items.map(p=>{const l=ledger(p.id,date);return <div className="ledgerrow" key={p.id}><b>{p.name}</b><span>Fund {fmt(l.fund)} · Collection {fmt(l.collection)} · Expense {fmt(l.expense)}</span><strong>Net {fmt(l.collection-l.fund-l.expense)}</strong></div>})}</div>}

function Closing({date,setDate,stats,close,openings,setOpening,addOpening,channelClosing,channelNames,share,whatsapp,telegram,pdf,fmt}){return <section><div className="section-head"><div><h1>Daily Closing</h1><p className="muted">Opening → transactions → closing</p></div><input type="date" value={date} onChange={e=>{setDate(e.target.value);setOpening({...openings,date:e.target.value})}}/></div><div className="stats"><Stat title="Fund Given" value={stats.fund} fmt={fmt}/><Stat title="Collection" value={stats.collection} fmt={fmt}/><Stat title="Expense" value={stats.expense} fmt={fmt}/><Stat title="Net Result" value={stats.collection-stats.fund-stats.expense} fmt={fmt}/></div><div className="card"><h3>Opening Balance</h3><form className="form" onSubmit={addOpening}><label>Channel<select value={openings.channel} onChange={e=>setOpening({...openings,channel:e.target.value})}>{channelNames.map(x=><option key={x}>{x}</option>)}</select></label><label>Amount<input required type="number" min="0" step=".01" value={openings.amount} onChange={e=>setOpening({...openings,amount:e.target.value,date})}/></label><label>Note<input value={openings.note} onChange={e=>setOpening({...openings,note:e.target.value,date})}/></label><button className="primary">Save Opening</button></form></div><div className="card"><h3>Channel Closing</h3><div className="table-wrap"><table><thead><tr><th>Channel</th><th>Opening</th><th>Movement</th><th>Closing</th></tr></thead><tbody>{channelClosing.map(x=><tr key={x.channel}><td>{x.channel}</td><td>{fmt(x.opening)}</td><td>{fmt(x.movement)}</td><td><b>{fmt(x.closing)}</b></td></tr>)}</tbody></table></div></div><div className="actions"><button className="primary" onClick={close}>Close This Day</button><button onClick={pdf}>📄 Share PDF</button><button onClick={share}>📤 Share</button><button className="wa" onClick={whatsapp}>WhatsApp</button><button className="tg" onClick={telegram}>Telegram</button></div></section>}

function People({person,setPerson,add,members,agents,toggle,canManage}){return <section><h1>People Management</h1><form className="card form" onSubmit={add}><label>Type<select value={person.type} onChange={e=>setPerson({...person,type:e.target.value})}><option value="agent">Agent</option><option value="member">Member/Distributor</option></select></label><label>Name<input required value={person.name} onChange={e=>setPerson({...person,name:e.target.value})}/></label><label>Phone<input value={person.phone} onChange={e=>setPerson({...person,phone:e.target.value})}/></label><button className="primary">Add</button></form><div className="grid2"><List title="Members" items={members.map(m=>({...m,person_type:"member"}))} toggle={toggle} canManage={canManage}/><List title="Agents" items={agents.map(a=>({...a,person_type:"agent"}))} toggle={toggle} canManage={canManage}/></div></section>}
const List=({title,items,toggle,canManage})=><div className="card"><h3>{title}</h3>{items.map(x=><div className="listrow" key={x.id}><b>{x.name}</b><span>{x.phone||""} <span className={"badge "+(x.active?"active":"inactive")}>{x.active?"Active":"Inactive"}</span></span>{canManage&&<button onClick={()=>toggle(x)}>{x.active?"Deactivate":"Activate"}</button>}</div>)}</div>;

function Reports({tx,allTx,name,pdf,excel,filter,setFilter,edit,del,people,allChannelNames,fmt}){return <section><div className="section-head"><div><h1>Reports</h1><p className="muted">Search, edit, delete and export.</p></div><div className="actions"><button onClick={pdf}>PDF</button><button onClick={excel}>Excel</button></div></div><div className="card form"><label>From<input type="date" value={filter.dateFrom} onChange={e=>setFilter({...filter,dateFrom:e.target.value})}/></label><label>To<input type="date" value={filter.dateTo} onChange={e=>setFilter({...filter,dateTo:e.target.value})}/></label><label>Person<select value={filter.person} onChange={e=>setFilter({...filter,person:e.target.value})}><option value="">All</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Channel<select value={filter.channel} onChange={e=>setFilter({...filter,channel:e.target.value})}><option value="">All</option>{allChannelNames.map(c=><option key={c}>{c}</option>)}</select></label><label>Type<select value={filter.type} onChange={e=>setFilter({...filter,type:e.target.value})}><option value="">All</option><option value="collection">Collection</option><option value="fund_given">Fund Given</option><option value="expense">Expense</option></select></label></div><div className="card"><div className="muted">Showing {tx.length} of {allTx.length} transactions</div><Table tx={tx} name={name} edit={edit} del={del} fmt={fmt}/></div></section>}
function Table({tx,name,edit,del,fmt}){return <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Person</th><th>Channel</th><th>Amount</th><th>Receipt</th><th>Note</th><th>Action</th></tr></thead><tbody>{tx.map(t=><tr key={t.id}><td>{t.transaction_date}</td><td>{t.type}</td><td>{name(t.person_id)}</td><td>{t.channel}</td><td>{fmt(t.amount)}</td><td>{t.receipt_url?<a href={t.receipt_url} target="_blank" rel="noreferrer">📎</a>:""}</td><td>{t.note||""}</td><td><button onClick={()=>edit(t)}>Edit</button><button className="danger" onClick={()=>del(t.id)}>Delete</button></td></tr>)}</tbody></table></div>}

function Settings({profile,channelsDb,canManage,canAdmin,newChannel,setNewChannel,addChannel,toggleChannel,reminder,enableReminder,disableReminder,myRole,businesses,businessId,switchBusiness,newBizName,setNewBizName,newBizCurrency,setNewBizCurrency,createBusiness,bizNameEdit,setBizNameEdit,bizCurrencyEdit,setBizCurrencyEdit,updateBusinessInfo,backupReminder,enableBackupReminder,disableBackupReminder,downloadBackup}){
 const weekdays=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
 const [bDay,setBDay]=useState(backupReminder?backupReminder.split("|")[0]:"0");
 const [bTime,setBTime]=useState(backupReminder?backupReminder.split("|")[1]:"09:00");
 const lastBackup=typeof localStorage!=="undefined"&&localStorage.getItem("isf_last_backup");
 return <section><h1>Settings</h1><div className="card"><h3>Role & Security</h3><p>Your role in this business: <b>{myRole}</b></p><p className="muted">Roles: Super Admin, Admin, Manager, Member, Agent. New teammates start as <b>Pending</b> and need approval from a Super Admin/Admin in the Users tab before they can see any data.</p><p className="muted">Every create/update/delete/closing/role-change action is written to the Audit Log.</p></div><div className="card"><h3>Your Businesses</h3>{businesses.map(b=><div className="listrow" key={b.id}><b>{b.name}</b><span className={"badge "+(b.role==="pending"?"pending":"active")}>{b.role}</span>{b.id!==businessId&&b.role!=="pending"&&<button onClick={()=>switchBusiness(b.id)}>Switch</button>}</div>)}<form className="form" onSubmit={createBusiness}><label className="full">Create another business<input value={newBizName} onChange={e=>setNewBizName(e.target.value)} placeholder="Business name"/></label><label>Currency<select value={newBizCurrency} onChange={e=>setNewBizCurrency(e.target.value)}>{currencyList.map(c=><option key={c}>{c}</option>)}</select></label><button className="primary">Create</button></form></div>{canAdmin&&<div className="card"><h3>Business Info</h3><form className="form" onSubmit={updateBusinessInfo}><label>Name<input value={bizNameEdit} onChange={e=>setBizNameEdit(e.target.value)}/></label><label>Currency<select value={bizCurrencyEdit} onChange={e=>setBizCurrencyEdit(e.target.value)}>{currencyList.map(c=><option key={c}>{c}</option>)}</select></label><button className="primary">Save</button></form></div>}<div className="card"><h3>Daily Closing Reminder</h3><p className="muted">Browser notification only — fires while this app is open in a tab on this device. For real SMS/email alerts you'd need a backend function plus a provider (e.g. a Supabase Edge Function + email/SMS API) — not included yet.</p><div className="form"><label>Reminder time<input type="time" defaultValue={reminder} onBlur={e=>e.target.value&&enableReminder(e.target.value)}/></label></div>{reminder&&<div className="actions"><button onClick={disableReminder}>Turn off ({reminder})</button></div>}</div>{canManage&&<div className="card"><h3>Payment Channels</h3><form className="form" onSubmit={addChannel}><label className="full">New channel name<input value={newChannel} onChange={e=>setNewChannel(e.target.value)} placeholder="e.g. Tap, DBBL Nexus"/></label><button className="primary">Add Channel</button></form>{channelsDb.map(c=><div className="listrow" key={c.id}><b>{c.name}</b><span className={"badge "+(c.active?"active":"inactive")}>{c.active?"Active":"Inactive"}</span><button onClick={()=>toggleChannel(c)}>{c.active?"Deactivate":"Activate"}</button></div>)}</div>}<div className="card"><h3>Backup</h3><p className="muted">Downloads every record for this business (transactions, people, closings, channels, audit log) as one file. Not automatic — save it to Google Drive, email it to yourself, or wherever you keep important files.</p>{lastBackup&&<p className="muted">Last downloaded: {lastBackup}</p>}<div className="actions"><button className="primary" onClick={downloadBackup}>Download Backup</button></div><h4>Weekly Reminder</h4><p className="muted">Browser notification only — fires while this app is open in a tab on this device, same as the daily closing reminder above.</p><div className="form"><label>Day<select value={bDay} onChange={e=>setBDay(e.target.value)}>{weekdays.map((d,i)=><option key={i} value={i}>{d}</option>)}</select></label><label>Time<input type="time" value={bTime} onChange={e=>setBTime(e.target.value)}/></label></div><div className="actions"><button onClick={()=>enableBackupReminder(bDay,bTime)}>{backupReminder?"Update Reminder":"Turn On"}</button>{backupReminder&&<button onClick={disableBackupReminder}>Turn off ({weekdays[+backupReminder.split("|")[0]]} {backupReminder.split("|")[1]})</button>}</div></div></section>}

function UsersManagement({bizMembers,addMemberEmail,setAddMemberEmail,addMemberByEmail,updateMemberRole,removeMember,currentUserId}){return <section><h1>User Management</h1><p className="muted">Add teammates to this business by email, approve them, and manage roles. They must have signed in with Google at least once before you can add them.</p><div className="card"><form className="form" onSubmit={addMemberByEmail}><label className="full">Add by email<input type="email" value={addMemberEmail} onChange={e=>setAddMemberEmail(e.target.value)} placeholder="teammate@gmail.com"/></label><button className="primary">Add</button></form></div><div className="card"><div className="table-wrap"><table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Joined</th><th>Change Role</th><th></th></tr></thead><tbody>{bizMembers.map(m=><tr key={m.id}><td>{m.member?.email||""}</td><td>{m.member?.full_name||""}</td><td><span className={"badge "+(m.role==="pending"?"pending":"active")}>{m.role}</span></td><td>{(m.created_at||"").slice(0,10)}</td><td><select defaultValue={m.role} onChange={e=>updateMemberRole(m.id,m.user_id,e.target.value)} disabled={m.user_id===currentUserId}>{roleOptions.map(r=><option key={r} value={r}>{r}</option>)}</select></td><td>{m.user_id!==currentUserId&&<button className="danger" onClick={()=>removeMember(m.id,m.user_id)}>Remove</button>}</td></tr>)}</tbody></table></div>{!bizMembers.length&&<p className="muted">No members yet.</p>}</div></section>}

function AuditLog({auditLog}){return <section><h1>Audit Log</h1><p className="muted">Most recent 300 actions. Visible to Super Admin, Admin and Manager.</p><div className="card"><div className="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Table</th><th>Details</th></tr></thead><tbody>{auditLog.map(a=><tr key={a.id}><td>{(a.created_at||"").replace("T"," ").slice(0,19)}</td><td>{a.user_email||a.user_id}</td><td>{a.action}</td><td>{a.table_name}</td><td>{a.details}</td></tr>)}</tbody></table></div>{!auditLog.length&&<p className="muted">No audit entries yet.</p>}</div></section>}

// ==================== V8: Inventory / Invoices / Recurring / Budgets / Analytics ====================
// Inventory and Invoices are identical in shape for Business Ledger and Cash Book, so
// each is one shared component reused by both (props supply the right data/handlers).
function Inventory({items,movements,form,setForm,save,editing,edit,cancel,del,moveForm,setMoveForm,saveMove,fmt,canManage}){
 return <section><div className="section-head"><div><h1>Inventory</h1><p className="muted">Stock levels, cost &amp; sale price, low-stock alerts.</p></div></div>
 {canManage&&<div className="card"><h3>{editing?"Edit Item":"Add Item"}</h3><form className="form" onSubmit={save}>
  <label>Name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
  <label>SKU<input value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})}/></label>
  <label>Unit<input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} placeholder="pcs, kg, box"/></label>
  <label>Opening Quantity<input type="number" step=".01" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></label>
  <label>Cost Price<input type="number" step=".01" value={form.cost_price} onChange={e=>setForm({...form,cost_price:e.target.value})}/></label>
  <label>Sale Price<input type="number" step=".01" value={form.sale_price} onChange={e=>setForm({...form,sale_price:e.target.value})}/></label>
  <label>Low Stock Alert Below<input type="number" step=".01" value={form.low_stock_threshold} onChange={e=>setForm({...form,low_stock_threshold:e.target.value})}/></label>
  <div className="actions"><button className="primary">{editing?"Update Item":"Add Item"}</button>{editing&&<button type="button" onClick={cancel}>Cancel</button>}</div>
 </form></div>}
 <div className="card"><h3>Items</h3><div className="table-wrap"><table><thead><tr><th>Name</th><th>SKU</th><th>Qty</th><th>Cost</th><th>Sale</th><th>Status</th>{canManage&&<th>Action</th>}</tr></thead><tbody>{items.map(x=><tr key={x.id} className={+x.quantity<=+x.low_stock_threshold?"low-stock":""}><td>{x.name}</td><td>{x.sku||""}</td><td>{x.quantity} {x.unit}</td><td>{fmt(x.cost_price)}</td><td>{fmt(x.sale_price)}</td><td>{+x.quantity<=+x.low_stock_threshold?<span className="badge pending">Low Stock</span>:<span className="badge active">OK</span>}</td>{canManage&&<td><button onClick={()=>edit(x)}>Edit</button><button className="danger" onClick={()=>del(x.id)}>Delete</button></td>}</tr>)}</tbody></table></div>{!items.length&&<p className="muted">No items yet.</p>}</div>
 {canManage&&<div className="card"><h3>Stock Movement</h3><form className="form" onSubmit={saveMove}>
  <label className="full">Item<select value={moveForm.item_id} onChange={e=>setMoveForm({...moveForm,item_id:e.target.value})}><option value="">Select...</option>{items.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
  <label>Type<select value={moveForm.movement_type} onChange={e=>setMoveForm({...moveForm,movement_type:e.target.value})}><option value="in">Stock In</option><option value="out">Stock Out</option><option value="adjustment">Set Exact Quantity</option></select></label>
  <label>Quantity<input required type="number" step=".01" min="0.01" value={moveForm.quantity} onChange={e=>setMoveForm({...moveForm,quantity:e.target.value})}/></label>
  <label className="full">Note<input value={moveForm.note} onChange={e=>setMoveForm({...moveForm,note:e.target.value})}/></label>
  <button className="primary">Save Movement</button>
 </form></div>}
 <div className="card"><h3>Recent Stock Movements</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Qty</th><th>Note</th></tr></thead><tbody>{movements.slice(0,50).map(m=><tr key={m.id}><td>{(m.created_at||"").slice(0,10)}</td><td>{items.find(x=>x.id===m.item_id)?.name||"—"}</td><td>{m.movement_type}</td><td>{m.quantity}</td><td>{m.note||""}</td></tr>)}</tbody></table></div>{!movements.length&&<p className="muted">No stock movements yet.</p>}</div>
 </section>}

function Invoices({invoices,invItems,form,setForm,lineItems,addLine,removeLine,updateLine,save,editing,edit,cancel,del,pdf,fmt,canManage}){
 return <section><div className="section-head"><div><h1>Invoices</h1><p className="muted">Create invoices — pull line items from Inventory or type them freehand.</p></div></div>
 {canManage&&<div className="card"><h3>{editing?"Edit Invoice":"New Invoice"}</h3><form className="form" onSubmit={save}>
  <label>Invoice #<input required value={form.invoice_no} onChange={e=>setForm({...form,invoice_no:e.target.value})}/></label>
  <label>Customer Name<input required value={form.customer_name} onChange={e=>setForm({...form,customer_name:e.target.value})}/></label>
  <label>Customer Phone<input value={form.customer_phone} onChange={e=>setForm({...form,customer_phone:e.target.value})}/></label>
  <label>Issue Date<input type="date" value={form.issue_date} onChange={e=>setForm({...form,issue_date:e.target.value})}/></label>
  <label>Due Date<input type="date" value={form.due_date} onChange={e=>setForm({...form,due_date:e.target.value})}/></label>
  <label>Status<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{invoiceStatuses.map(s=><option key={s}>{s}</option>)}</select></label>
  <label className="full">Notes<input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
  <div className="full"><h4>Line Items</h4>{lineItems.map((l,i)=><div className="ledgerrow" key={i}>
   <select value={l.item_id} onChange={e=>updateLine(i,"item_id",e.target.value)}><option value="">Custom...</option>{invItems.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
   <input placeholder="Description" value={l.description} onChange={e=>updateLine(i,"description",e.target.value)}/>
   <input type="number" step=".01" placeholder="Qty" style={{width:70}} value={l.quantity} onChange={e=>updateLine(i,"quantity",e.target.value)}/>
   <input type="number" step=".01" placeholder="Unit Price" style={{width:90}} value={l.unit_price} onChange={e=>updateLine(i,"unit_price",e.target.value)}/>
   <button type="button" className="danger" onClick={()=>removeLine(i)}>×</button>
  </div>)}<button type="button" onClick={addLine}>+ Add Line</button><p><b>Total: {fmt(lineItems.reduce((s,l)=>s+(+l.quantity||0)*(+l.unit_price||0),0))}</b></p></div>
  <div className="actions"><button className="primary">{editing?"Update Invoice":"Save Invoice"}</button>{editing&&<button type="button" onClick={cancel}>Cancel</button>}</div>
 </form></div>}
 <div className="card"><h3>All Invoices</h3><div className="table-wrap"><table><thead><tr><th>#</th><th>Customer</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>{invoices.map(inv=><tr key={inv.id}><td>{inv.invoice_no}</td><td>{inv.customer_name}</td><td>{inv.issue_date}</td><td><span className={"badge "+(inv.status==="paid"?"active":inv.status==="sent"?"pending":"inactive")}>{inv.status}</span></td><td><button onClick={()=>pdf(inv)}>PDF</button>{canManage&&<><button onClick={()=>edit(inv)}>Edit</button><button className="danger" onClick={()=>del(inv.id)}>Delete</button></>}</td></tr>)}</tbody></table></div>{!invoices.length&&<p className="muted">No invoices yet.</p>}</div>
 </section>}

function Recurring({rows,form,setForm,save,editing,edit,cancel,del,toggle,processDue,members,agents,channelNames,name,fmt,canManage}){
 const ps=(form.person_type==="member"?members:agents).filter(p=>p.active);
 return <section><div className="section-head"><div><h1>Recurring Transactions</h1><p className="muted">Auto-generate a transaction on its due date. Click "Process Due" to run it now.</p></div>{canManage&&<button className="primary" onClick={processDue}>Process Due</button>}</div>
 {canManage&&<div className="card"><h3>{editing?"Edit Rule":"New Recurring Rule"}</h3><form className="form" onSubmit={save}>
  <label>Type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="collection">Collection</option><option value="fund_given">Fund Given</option><option value="expense">Expense</option></select></label>
  <label>Person Type<select value={form.person_type} onChange={e=>setForm({...form,person_type:e.target.value,person_id:""})}><option value="agent">Agent</option><option value="member">Member</option></select></label>
  <label>Person<select value={form.person_id} onChange={e=>setForm({...form,person_id:e.target.value})}><option value="">Select...</option>{ps.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  <label>Channel<select value={form.channel} onChange={e=>setForm({...form,channel:e.target.value})}>{channelNames.map(c=><option key={c}>{c}</option>)}</select></label>
  <label>Amount<input required type="number" step=".01" min="0.01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
  <label>Frequency<select value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value})}>{freqOptions.map(f=><option key={f}>{f}</option>)}</select></label>
  <label>Next Run Date<input type="date" value={form.next_run_date} onChange={e=>setForm({...form,next_run_date:e.target.value})}/></label>
  <label className="full">Note<input value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
  <div className="actions"><button className="primary">{editing?"Update Rule":"Create Rule"}</button>{editing&&<button type="button" onClick={cancel}>Cancel</button>}</div>
 </form></div>}
 <div className="card"><h3>Rules</h3>{rows.map(r=><div className="listrow" key={r.id}><b>{r.type} — {fmt(r.amount)}</b><span>{name(r.person_id)} · {r.channel} · {r.frequency} · next {r.next_run_date}</span><span className={"badge "+(r.active?"active":"inactive")}>{r.active?"Active":"Paused"}</span>{canManage&&<div className="actions"><button onClick={()=>toggle(r)}>{r.active?"Pause":"Resume"}</button><button onClick={()=>edit(r)}>Edit</button><button className="danger" onClick={()=>del(r.id)}>Delete</button></div>}</div>)}{!rows.length&&<p className="muted">No recurring rules yet.</p>}</div>
 </section>}

function CbRecurring({rows,form,setForm,save,editing,edit,cancel,del,toggle,processDue,fmt}){
 return <section><div className="section-head"><div><h1>Recurring Entries</h1><p className="muted">Auto-generate a Cash Book entry on its due date. Click "Process Due" to run it now.</p></div><button className="primary" onClick={processDue}>Process Due</button></div>
 <div className="card"><h3>{editing?"Edit Rule":"New Recurring Rule"}</h3><form className="form" onSubmit={save}>
  <label>Type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option value="in">Cash In</option><option value="out">Cash Out</option></select></label>
  <label>Category<input value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="e.g. Rent"/></label>
  <label>Channel<select value={form.channel} onChange={e=>setForm({...form,channel:e.target.value})}>{defaultChannels.map(c=><option key={c}>{c}</option>)}</select></label>
  <label>Amount<input required type="number" step=".01" min="0.01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
  <label>Frequency<select value={form.frequency} onChange={e=>setForm({...form,frequency:e.target.value})}>{freqOptions.map(f=><option key={f}>{f}</option>)}</select></label>
  <label>Next Run Date<input type="date" value={form.next_run_date} onChange={e=>setForm({...form,next_run_date:e.target.value})}/></label>
  <label className="full">Note<input value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
  <div className="actions"><button className="primary">{editing?"Update Rule":"Create Rule"}</button>{editing&&<button type="button" onClick={cancel}>Cancel</button>}</div>
 </form></div>
 <div className="card"><h3>Rules</h3>{rows.map(r=><div className="listrow" key={r.id}><b>{r.type==="in"?"Cash In":"Cash Out"} — {fmt(r.amount)}</b><span>{r.category} · {r.channel} · {r.frequency} · next {r.next_run_date}</span><span className={"badge "+(r.active?"active":"inactive")}>{r.active?"Active":"Paused"}</span><div className="actions"><button onClick={()=>toggle(r)}>{r.active?"Pause":"Resume"}</button><button onClick={()=>edit(r)}>Edit</button><button className="danger" onClick={()=>del(r.id)}>Delete</button></div></div>)}{!rows.length&&<p className="muted">No recurring rules yet.</p>}</div>
 </section>}

function Budgets({budgets,form,setForm,save,del,channelNames,spent,fmt,canManage}){
 return <section><h1>Budgets &amp; Alerts</h1><p className="muted">Monthly spending limit per channel, checked against Expense transactions.</p>
 {canManage&&<div className="card"><h3>Set Budget</h3><form className="form" onSubmit={save}>
  <label>Channel<select value={form.channel} onChange={e=>setForm({...form,channel:e.target.value})}>{channelNames.map(c=><option key={c}>{c}</option>)}</select></label>
  <label>Month<input type="month" value={form.month} onChange={e=>setForm({...form,month:e.target.value})}/></label>
  <label>Limit<input required type="number" step=".01" min="0.01" value={form.amount_limit} onChange={e=>setForm({...form,amount_limit:e.target.value})}/></label>
  <button className="primary">Save Budget</button>
 </form></div>}
 <div className="card"><h3>Budgets</h3>{budgets.map(b=>{const s=spent(b.channel,b.month);const pct=Math.min(100,Math.round((s/+b.amount_limit)*100));return <div className="listrow" key={b.id}><b>{b.channel} — {b.month}</b><span>{fmt(s)} of {fmt(b.amount_limit)}{s>+b.amount_limit&&<span className="badge pending"> Over Budget</span>}</span><div className="budget-bar"><div className="budget-bar-fill" style={{width:pct+"%",background:s>+b.amount_limit?"#dc2626":"#16a34a"}}/></div>{canManage&&<button className="danger" onClick={()=>del(b.id)}>Delete</button>}</div>})}{!budgets.length&&<p className="muted">No budgets set yet.</p>}</div>
 </section>}

function CbBudgets({budgets,form,setForm,save,del,spent,fmt}){
 return <section><h1>Budgets &amp; Alerts</h1><p className="muted">Monthly spending limit per category, checked against Cash Out entries.</p>
 <div className="card"><h3>Set Budget</h3><form className="form" onSubmit={save}>
  <label>Category<input required value={form.category} onChange={e=>setForm({...form,category:e.target.value})} placeholder="e.g. Rent, Sales"/></label>
  <label>Month<input type="month" value={form.month} onChange={e=>setForm({...form,month:e.target.value})}/></label>
  <label>Limit<input required type="number" step=".01" min="0.01" value={form.amount_limit} onChange={e=>setForm({...form,amount_limit:e.target.value})}/></label>
  <button className="primary">Save Budget</button>
 </form></div>
 <div className="card"><h3>Budgets</h3>{budgets.map(b=>{const s=spent(b.category,b.month);const pct=Math.min(100,Math.round((s/+b.amount_limit)*100));return <div className="listrow" key={b.id}><b>{b.category} — {b.month}</b><span>{fmt(s)} of {fmt(b.amount_limit)}{s>+b.amount_limit&&<span className="badge pending"> Over Budget</span>}</span><div className="budget-bar"><div className="budget-bar-fill" style={{width:pct+"%",background:s>+b.amount_limit?"#dc2626":"#16a34a"}}/></div><button className="danger" onClick={()=>del(b.id)}>Delete</button></div>})}{!budgets.length&&<p className="muted">No budgets set yet.</p>}</div>
 </section>}

// Shared analytics + multi-currency-display screen for both Business Ledger and Cash Book.
// Currency conversion here is display-only — stored amounts never change.
function AnalyticsView({title,monthlyChart,monthlyTitle,byGroupChart,byGroupTitle,lowStock,currencyList,baseCurrency,dispCurrency,setDispCurrency,exRates,exForm,setExForm,saveExRate,deleteExRate,canEditRates,fmt}){
 return <section><div className="section-head"><div><h1>{title}</h1><p className="muted">Trends, breakdowns and low-stock at a glance.</p></div>
 <label>Show amounts in<select value={dispCurrency} onChange={e=>setDispCurrency(e.target.value)}><option value="">{baseCurrency||"Default"} (original)</option>{currencyList.filter(c=>c!==baseCurrency).map(c=><option key={c} value={c}>{c}</option>)}</select></label>
 </div>
 <div className="card"><h3>{monthlyTitle}</h3><BarChart data={monthlyChart} fmt={fmt}/></div>
 <div className="card"><h3>{byGroupTitle}</h3><BarChart data={byGroupChart} fmt={fmt}/></div>
 {!!lowStock.length&&<div className="card"><h3>Low Stock Alerts</h3>{lowStock.map(x=><div className="listrow" key={x.id}><b>{x.name}</b><span className="badge pending">{x.quantity} {x.unit} left (alert below {x.low_stock_threshold})</span></div>)}</div>}
 {canEditRates&&<div className="card"><h3>Exchange Rates (for display only)</h3><p className="muted">1 {baseCurrency} = ? in another currency. Enter manually; nothing is fetched automatically.</p><form className="form" onSubmit={saveExRate}><label>Currency<select value={exForm.currency} onChange={e=>setExForm({...exForm,currency:e.target.value})}>{currencyList.filter(c=>c!==baseCurrency).map(c=><option key={c}>{c}</option>)}</select></label><label>Rate<input required type="number" step="0.000001" min="0.000001" value={exForm.rate} onChange={e=>setExForm({...exForm,rate:e.target.value})}/></label><button className="primary">Save Rate</button></form>{exRates.map(r=><div className="listrow" key={r.id}><b>1 {baseCurrency} = {r.rate} {r.currency}</b><button className="danger" onClick={()=>deleteExRate(r.id)}>Delete</button></div>)}</div>}
 </section>}

createRoot(document.getElementById("root")).render(<App/>);
