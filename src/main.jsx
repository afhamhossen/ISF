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

 useEffect(()=>{if(!supabase){setLoading(false);return} supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)});const {data:l}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>l.subscription.unsubscribe()},[]);
 useEffect(()=>{if(session)loadBusinesses()},[session]);
 useEffect(()=>{const b=businesses.find(x=>x.id===businessId);if(b){setBizNameEdit(b.name);setBizCurrencyEdit(b.currency)}},[businessId,businesses]);

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
  if(cur&&cur.role!=="pending")await loadData(chosen);
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
 function switchBusiness(id){if(!id)return;setBusinessId(id);if(typeof localStorage!=="undefined")localStorage.setItem("isf_business_id",id);const b=businesses.find(x=>x.id===id);if(b&&b.role!=="pending")loadData(id)}
 async function createBusiness(e){e.preventDefault();if(!newBizName.trim())return setMsg("Enter a business name.");const {data,error}=await supabase.from("businesses").insert({name:newBizName.trim(),currency:newBizCurrency,created_by:session.user.id}).select().single();setMsg(friendly(error?.message)||"Business created.");if(!error){setNewBizName("");await loadBusinesses();setBusinessId(data.id);if(typeof localStorage!=="undefined")localStorage.setItem("isf_business_id",data.id);loadData(data.id)}}
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

 if(!supabase)return <Setup/>;
 if(loading)return <div className="center">Loading...</div>;
 if(!session)return <Login login={login} message={msg}/>;
 if(!bizLoaded)return <div className="center">Loading...</div>;
 if(!businesses.length)return <CreateBusinessScreen name={newBizName} setName={setNewBizName} currency={newBizCurrency} setCurrency={setNewBizCurrency} create={createBusiness} logout={logout} message={msg}/>;
 if(!currentBiz||currentBiz.role==="pending")return <PendingScreen email={session.user.email} businesses={businesses} currentId={businessId} switchBusiness={switchBusiness} createBusiness={createBusiness} newBizName={newBizName} setNewBizName={setNewBizName} newBizCurrency={newBizCurrency} setNewBizCurrency={setNewBizCurrency} refresh={loadBusinesses} logout={logout} message={msg}/>;

 const tabs=["dashboard","transactions","ledger","closing","people","reports","settings",...(canManage?["audit"]:[]),...(canAdmin?["users"]:[])];
 return <div className="app"><header className="topbar"><b>ISF Business Ledger <span>V5</span></b><div className="user"><select value={businessId} onChange={e=>switchBusiness(e.target.value)}>{businesses.filter(b=>b.role!=="pending").map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>{session.user.email}<button onClick={logout}>Logout</button></div></header><div className="layout"><aside>{tabs.map(x=><button className={tab===x?"active":""} onClick={()=>setTab(x)} key={x}>{x[0].toUpperCase()+x.slice(1)}</button>)}</aside><main>{msg&&<div className="notice">{msg}<button onClick={()=>setMsg("")}>×</button></div>}
 {tab==="dashboard"&&<Dashboard totals={totals} dayStats={dayStats} date={closeDate} people={people} tx={tx} channelClosing={channelClosing} fmt={fmt}/>}
 {tab==="transactions"&&<Transactions form={form} setForm={setForm} submit={saveTx} members={members} agents={agents} editing={editing} cancel={()=>{setEditing(null);setForm({...form,person_id:"",amount:"",note:"",receipt_url:""});setReceiptFile(null)}} channelNames={channelNames} receiptFile={receiptFile} setReceiptFile={setReceiptFile}/>}
 {tab==="ledger"&&<Ledger agents={agents} members={members} ledger={personLedger} date={closeDate} setDate={setCloseDate} fmt={fmt}/>}
 {tab==="closing"&&<Closing date={closeDate} setDate={setCloseDate} stats={dayStats} close={dailyClose} openings={opening} setOpening={setOpening} addOpening={addOpening} channelClosing={channelClosing} channelNames={channelNames} share={shareText} whatsapp={shareWhatsApp} telegram={shareTelegram} pdf={sharePDF} fmt={fmt}/>}
 {tab==="people"&&<People person={person} setPerson={setPerson} add={addPerson} members={members} agents={agents} toggle={togglePerson} canManage={canManage}/>}
 {tab==="reports"&&<Reports tx={filtered} allTx={tx} name={name} pdf={exportPDF} excel={exportExcel} filter={filter} setFilter={setFilter} edit={editTx} del={deleteTx} people={people} allChannelNames={allChannelNames} fmt={fmt}/>}
 {tab==="settings"&&<Settings profile={profile} channelsDb={channelsDb} canManage={canManage} canAdmin={canAdmin} newChannel={newChannel} setNewChannel={setNewChannel} addChannel={addChannel} toggleChannel={toggleChannel} reminder={reminder} enableReminder={enableReminder} disableReminder={disableReminder} myRole={myRole} businesses={businesses} businessId={businessId} switchBusiness={switchBusiness} newBizName={newBizName} setNewBizName={setNewBizName} newBizCurrency={newBizCurrency} setNewBizCurrency={setNewBizCurrency} createBusiness={createBusiness} bizNameEdit={bizNameEdit} setBizNameEdit={setBizNameEdit} bizCurrencyEdit={bizCurrencyEdit} setBizCurrencyEdit={setBizCurrencyEdit} updateBusinessInfo={updateBusinessInfo} backupReminder={backupReminder} enableBackupReminder={enableBackupReminder} disableBackupReminder={disableBackupReminder} downloadBackup={downloadBackup}/>}
 {tab==="audit"&&canManage&&<AuditLog auditLog={auditLog}/>}
 {tab==="users"&&canAdmin&&<UsersManagement bizMembers={bizMembers} addMemberEmail={addMemberEmail} setAddMemberEmail={setAddMemberEmail} addMemberByEmail={addMemberByEmail} updateMemberRole={updateMemberRole} removeMember={removeMember} currentUserId={session.user.id}/>}
 </main></div></div>
}

const Stat=({title,value,fmt})=><div className="card stat"><span>{title}</span><strong>{fmt(value)}</strong></div>;
function Login({login,message}){return <div className="login"><div className="card login-card"><h1>ISF Business Ledger V5</h1><p>Multi-Business • Distributor • Agent • Daily Settlement</p><button className="primary wide" onClick={login}>Continue with Google</button>{message&&<p className="error">{message}</p>}<small>Cloud saved • Mobile friendly • Secure per-business roles • New accounts require admin approval</small></div></div>}
function CreateBusinessScreen({name,setName,currency,setCurrency,create,logout,message}){return <div className="login"><div className="card login-card"><h1>ISF Business Ledger V5</h1><p><b>Create your first business</b></p><p className="muted">You'll become its Super Admin. You can add teammates afterward from the Users tab.</p><form className="form" onSubmit={create}><label>Business name<input required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. ISF Distribution"/></label><label>Currency<select value={currency} onChange={e=>setCurrency(e.target.value)}>{currencyList.map(c=><option key={c}>{c}</option>)}</select></label><button className="primary wide">Create Business</button></form>{message&&<p className="error">{message}</p>}<div className="center-actions"><button onClick={logout}>Logout</button></div></div></div>}
function PendingScreen({email,businesses,currentId,switchBusiness,createBusiness,newBizName,setNewBizName,newBizCurrency,setNewBizCurrency,refresh,logout,message}){const approved=businesses.filter(b=>b.role!=="pending");return <div className="login"><div className="card login-card"><h1>ISF Business Ledger V5</h1><p><b>Waiting for approval</b></p><p className="muted">Signed in as {email}. An admin of this business needs to approve you before you can see or enter any data.</p>{approved.length>0&&<div className="form"><label>Switch to a business you're already approved in<select value={currentId} onChange={e=>switchBusiness(e.target.value)}>{approved.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>}<div className="center-actions"><button className="primary" onClick={refresh}>Refresh</button><button onClick={logout}>Logout</button></div><hr/><p className="muted">Or create your own new business instead:</p><form className="form" onSubmit={createBusiness}><label>Business name<input value={newBizName} onChange={e=>setNewBizName(e.target.value)}/></label><label>Currency<select value={newBizCurrency} onChange={e=>setNewBizCurrency(e.target.value)}>{currencyList.map(c=><option key={c}>{c}</option>)}</select></label><button className="primary">Create Business</button></form>{message&&<p className="error">{message}</p>}</div></div>}
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

createRoot(document.getElementById("root")).render(<App/>);
