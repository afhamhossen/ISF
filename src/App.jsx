import React,{useEffect,useMemo,useState} from "react";
import {supabase} from "./supabase";
import {LayoutDashboard,BookOpen,ArrowDownLeft,ArrowUpRight,FileText,Users,Settings,Plus,Copy,Trash2,LogOut,Download,Search,Filter,ChevronRight,X,HandCoins,CalendarCheck,History,UserPlus,Wallet} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";

const money=n=>new Intl.NumberFormat("en-BD",{style:"currency",currency:"BDT",maximumFractionDigits:2}).format(Number(n||0));
const today=()=>new Date().toISOString().slice(0,10);
// Turns snake_case / enum-style values into clean, professional display labels —
// e.g. "primary_admin" -> "Primary Admin", "client_records" -> "Client Records".
const labelize=s=>(s||"").split("_").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ");
// Turns a quick date preset into a from/to pair. "all"/"range"/"single_day" leave
// whatever the person already picked manually.
function presetRange(preset){
 const now=new Date();const pad=n=>String(n).padStart(2,"0");const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
 if(preset==="today"){const d=iso(now);return{from:d,to:d}}
 if(preset==="yesterday"){const y=new Date(now);y.setDate(y.getDate()-1);const d=iso(y);return{from:d,to:d}}
 if(preset==="this_month")return{from:iso(new Date(now.getFullYear(),now.getMonth(),1)),to:iso(now)};
 if(preset==="last_month")return{from:iso(new Date(now.getFullYear(),now.getMonth()-1,1)),to:iso(new Date(now.getFullYear(),now.getMonth(),0))};
 if(preset==="all")return{from:"",to:""};
 return null;
}

// ---------- Local device preferences (Dark Theme, App Lock/PIN, Language, Amount
// Calculator toggle, Google Drive backup bookkeeping). These are per-device, not synced
// to the database — same model as the reference app's local "settings" block. ----------
const LS_KEY="isf_local_settings";
const DEFAULT_LOCAL_SETTINGS={darkTheme:false,language:"en",appLock:false,pinHash:"",amountCalc:true,gdriveLastBackup:""};
function loadLocalSettings(){try{return {...DEFAULT_LOCAL_SETTINGS,...JSON.parse(localStorage.getItem(LS_KEY)||"{}")}}catch{return {...DEFAULT_LOCAL_SETTINGS}}}
function saveLocalSettingsToDisk(s){try{localStorage.setItem(LS_KEY,JSON.stringify(s))}catch{}}
async function sha256Hex(str){
 const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(str));
 return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

// ---------- Minimal i18n. Covers navigation, page headers and the most common buttons —
// not every string in every modal. Add more keys here as needed; falls back to English. ----------
const STR={
 dashboard:{en:"Dashboard",bn:"ড্যাশবোর্ড"},books:{en:"Books",bn:"বই"},transactions:{en:"Transactions",bn:"লেনদেন"},
 parties:{en:"Parties",bn:"পার্টি"},reports:{en:"Reports",bn:"রিপোর্ট"},settings:{en:"Settings",bn:"সেটিংস"},
 account:{en:"Account",bn:"অ্যাকাউন্ট"},team_access:{en:"Team & Access",bn:"টিম ও অ্যাক্সেস"},
 daily_closing:{en:"Daily Closing",bn:"দৈনিক ক্লোজিং"},activity_log:{en:"Activity Log",bn:"অ্যাক্টিভিটি লগ"},
 business:{en:"Business",bn:"ব্যবসা"},preferences:{en:"Preferences",bn:"পছন্দসমূহ"},
 dashboard_sub:{en:"Your cash position at a glance",bn:"আপনার নগদ অবস্থান এক নজরে"},
 books_sub:{en:"Manage separate business ledgers",bn:"আলাদা আলাদা ব্যবসায়িক লেজার পরিচালনা করুন"},
 settings_sub:{en:"Account, team, closing & activity",bn:"অ্যাকাউন্ট, টিম, ক্লোজিং ও অ্যাক্টিভিটি"},
 select_book:{en:"Select a book",bn:"একটি বই নির্বাচন করুন"},
 entry:{en:"Entry",bn:"এন্ট্রি"},add:{en:"Add",bn:"যোগ করুন"},new:{en:"New",bn:"নতুন"},manage:{en:"Manage",bn:"ম্যানেজ"},
 no_matching:{en:"No matching entries.",bn:"কোনো মিল পাওয়া যায়নি।"},
 recent_entries:{en:"Recent Entries",bn:"সাম্প্রতিক এন্ট্রি"},
 dark_theme:{en:"Dark Theme",bn:"ডার্ক থিম"},dark_theme_desc:{en:"Switch the whole app to a dark color scheme.",bn:"পুরো অ্যাপকে ডার্ক কালারে পরিবর্তন করুন।"},
 language:{en:"Language",bn:"ভাষা"},
 amount_calc:{en:"Amount Calculator",bn:"অ্যামাউন্ট ক্যালকুলেটর"},amount_calc_desc:{en:"Type expressions like 200+150 into the Amount field.",bn:"Amount ফিল্ডে 200+150 এর মতো হিসাব লিখতে পারবেন।"},
 app_lock:{en:"App Lock (PIN)",bn:"অ্যাপ লক (পিন)"},app_lock_desc:{en:"Require a PIN to open the app on this device.",bn:"এই ডিভাইসে অ্যাপ খুলতে PIN লাগবে।"},
 backup_restore:{en:"Backup & Restore",bn:"ব্যাকআপ ও রিস্টোর"},
 save:{en:"Save",bn:"সংরক্ষণ করুন"},
 all_parties:{en:"← All Parties",bn:"← সকল পার্টি"},
 party_ledger:{en:"Distributor / Party Ledger",bn:"ডিস্ট্রিবিউটর / পার্টি লেজার"},
 party_ledger_sub:{en:"fund given vs. collected, per party",bn:"প্রতিটি পার্টির জন্য প্রদত্ত তহবিল বনাম আদায়"},
 new_party:{en:"New Party",bn:"নতুন পার্টি"},
 they_owe_you:{en:"They owe you",bn:"তারা আপনাকে দেনা"},
 you_owe_them:{en:"You owe them",bn:"আপনি তাদের দেনা"},
 owes_you:{en:"Owes you ",bn:"দেনা "},
 you_owe:{en:"You owe ",bn:"আপনি দেনা "},
 no_party_entries:{en:"No entries with this party yet.",bn:"এই পার্টির সাথে এখনো কোনো এন্ট্রি নেই।"},
 no_parties:{en:"No parties yet. Add your distributors, agents or customers to track what's out in the market.",bn:"এখনো কোনো পার্টি নেই। বাজারে কী পাওনা আছে তা ট্র্যাক করতে আপনার ডিস্ট্রিবিউটর, এজেন্ট বা কাস্টমার যোগ করুন।"},
 delete_party:{en:"Delete Party",bn:"পার্টি মুছুন"},
 account_details:{en:"Account Details",bn:"অ্যাকাউন্ট বিবরণ"},
 change_password:{en:"Change Password",bn:"পাসওয়ার্ড পরিবর্তন"},
 full_name:{en:"Full name",bn:"পুরো নাম"},
 email:{en:"Email",bn:"ইমেইল"},
 phone:{en:"Phone",bn:"ফোন"},
 currency:{en:"Currency",bn:"কারেন্সি"},
 access_level:{en:"Access Level",bn:"অ্যাক্সেস লেভেল"},
 your_name:{en:"Your name",bn:"আপনার নাম"},
 saving:{en:"Saving…",bn:"সংরক্ষণ হচ্ছে…"},
 save_changes:{en:"Save Changes",bn:"পরিবর্তন সংরক্ষণ করুন"},
 new_password:{en:"New password",bn:"নতুন পাসওয়ার্ড"},
 confirm_new_password:{en:"Confirm new password",bn:"নতুন পাসওয়ার্ড নিশ্চিত করুন"},
 updating:{en:"Updating…",bn:"আপডেট হচ্ছে…"},
 update_password:{en:"Update Password",bn:"পাসওয়ার্ড আপডেট করুন"},
 pw_min_length:{en:"Password must be at least 6 characters.",bn:"পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।"},
 pw_mismatch:{en:"Passwords don't match.",bn:"পাসওয়ার্ড দুটি মিলছে না।"},
 pw_updated:{en:"Password updated.",bn:"পাসওয়ার্ড আপডেট হয়েছে।"},
 profile_updated:{en:"Profile updated",bn:"প্রোফাইল আপডেট হয়েছে"},
};
function useT(lang){return (key)=>STR[key]?.[lang]||STR[key]?.en||key}

// ---------- Amount Calculator: lets someone type "500+200-30" into the Amount field.
// Restricted character set before using Function() as the evaluator, so nothing besides
// arithmetic can ever run. ----------
function calcExpr(str){
 if(typeof str!=="string")return null;
 const s=str.trim();
 if(!s||!/^[0-9+\-*/.()\s]+$/.test(s))return null;
 if(!/[+\-*/]/.test(s.slice(1)))return null; // no operator beyond a possible leading "-" => not an expression
 try{
  // eslint-disable-next-line no-new-func
  const val=Function(`"use strict";return (${s})`)();
  return (typeof val==="number"&&isFinite(val))?Math.round(val*100)/100:null;
 }catch{return null}
}

// ---------- Google Drive backup (optional — needs VITE_GOOGLE_CLIENT_ID). Uses Google
// Identity Services for an access token, then talks to the Drive v3 REST API directly. ----------
const GDRIVE_CLIENT_ID=import.meta.env.VITE_GOOGLE_CLIENT_ID||"";
const GDRIVE_FILENAME_PREFIX="isf-ledger-backup-";
function gisReady(){return new Promise((resolve,reject)=>{
 if(window.google?.accounts?.oauth2)return resolve();
 let tries=0;const iv=setInterval(()=>{tries++;if(window.google?.accounts?.oauth2){clearInterval(iv);resolve()}else if(tries>50){clearInterval(iv);reject(new Error("Google Identity Services didn't load."))}},100);
});}
function driveToken(){return new Promise(async(resolve,reject)=>{
 try{
  if(!GDRIVE_CLIENT_ID)return reject(new Error("Google Drive isn't configured for this deployment yet."));
  await gisReady();
  const client=window.google.accounts.oauth2.initTokenClient({
   client_id:GDRIVE_CLIENT_ID,scope:"https://www.googleapis.com/auth/drive.file",
   callback:(resp)=>resp.error?reject(resp):resolve(resp.access_token)
  });
  client.requestAccessToken();
 }catch(e){reject(e)}
});}
async function driveUpload(token,filename,dataObj){
 const boundary="isfboundary";
 const metadata={name:filename,mimeType:"application/json"};
 const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(dataObj)}\r\n--${boundary}--`;
 const r=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",{
  method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":`multipart/related; boundary=${boundary}`},body
 });
 if(!r.ok)throw new Error("Google Drive upload failed ("+r.status+")");
 return r.json();
}
async function driveFindLatestBackup(token){
 const q=encodeURIComponent(`name contains '${GDRIVE_FILENAME_PREFIX}' and trashed=false`);
 const r=await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=1&fields=files(id,name,createdTime)`,{headers:{Authorization:`Bearer ${token}`}});
 if(!r.ok)throw new Error("Couldn't list Google Drive files ("+r.status+")");
 const j=await r.json();return j.files?.[0]||null;
}
async function driveDownload(token,fileId){
 const r=await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,{headers:{Authorization:`Bearer ${token}`}});
 if(!r.ok)throw new Error("Google Drive download failed ("+r.status+")");
 return r.json();
}

function Auth(){
 // mode: "login" | "signup" | "forgot" | "forgot_sent"
 const [mode,setMode]=useState("login"),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[name,setName]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function submit(e){e.preventDefault();setBusy(true);setError("");
  if(mode==="forgot"){
   const r=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});
   if(r.error)setError(r.error.message); else setMode("forgot_sent");
   setBusy(false);return;
  }
  const r=mode==="login"?await supabase.auth.signInWithPassword({email,password}):await supabase.auth.signUp({email,password,options:{data:{full_name:name}}});
  if(r.error)setError(r.error.message); else if(mode==="signup")setError("Account created. Check your email if confirmation is enabled.");
  setBusy(false);
 }
 if(mode==="forgot_sent")return <div className="auth"><div className="auth-card"><div className="logo">ISF</div><h1>Multi-Book Ledger</h1>
  <p className="muted">যদি <b>{email}</b> দিয়ে অ্যাকাউন্ট থাকে, একটা পাসওয়ার্ড রিসেট লিংক পাঠানো হয়েছে। ইমেইল চেক করুন (স্প্যাম ফোল্ডারও দেখুন)।</p>
  <button className="link" onClick={()=>{setMode("login");setError("")}}>Back to sign in</button></div></div>;
 return <div className="auth"><div className="auth-card"><div className="logo">ISF</div><h1>Multi-Book Ledger</h1><p className="muted">Professional cash & business ledger</p>
 {mode==="forgot"?
  <form onSubmit={submit}><input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/>{error&&<div className="error">{error}</div>}<button className="primary wide" disabled={busy}>{busy?"Sending…":"Send reset link"}</button></form>
  :
  <form onSubmit={submit}>{mode==="signup"&&<input placeholder="Full name" value={name} onChange={e=>setName(e.target.value)} required/>}<input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/><input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/>{mode==="login"&&<button type="button" className="link" style={{textAlign:"right"}} onClick={()=>{setMode("forgot");setError("")}}>পাসওয়ার্ড ভুলে গেছেন?</button>}{error&&<div className="error">{error}</div>}<button className="primary wide" disabled={busy}>{busy?"Please wait…":mode==="login"?"Sign in":"Create account"}</button></form>
 }
 <button className="link" onClick={()=>{setMode(mode==="signup"?"login":"signup");setError("")}}>{mode==="signup"?"Back to sign in":"Create a new account"}</button></div></div>
}

// After clicking the reset link in their email, Supabase logs the user into a temporary
// "recovery" session and fires a PASSWORD_RECOVERY auth event (caught in App below). This
// screen intercepts that session so they set a new password before landing in the ledger.
function ResetPassword({onDone}){
 const [password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function submit(e){e.preventDefault();setError("");
  if(password.length<6)return setError("Password must be at least 6 characters.");
  if(password!==confirm)return setError("Passwords do not match.");
  setBusy(true);
  const r=await supabase.auth.updateUser({password});
  setBusy(false);
  if(r.error)setError(r.error.message); else onDone();
 }
 return <div className="auth"><div className="auth-card"><div className="logo">ISF</div><h1>Set a New Password</h1><p className="muted">নতুন পাসওয়ার্ড দিন</p>
 <form onSubmit={submit}><input type="password" placeholder="New password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/><input type="password" placeholder="Confirm new password" value={confirm} onChange={e=>setConfirm(e.target.value)} required minLength={6}/>{error&&<div className="error">{error}</div>}<button className="primary wide" disabled={busy}>{busy?"Saving…":"Save Password"}</button></form>
 </div></div>
}

// Local PIN entry screen shown at app start when App Lock is turned on in Preferences.
// Independent of the Supabase session — this gates the device, not the account.
function PinGate({expectedHash,onUnlock}){
 const [pin,setPin]=useState(""),[error,setError]=useState("");
 async function submit(e){e.preventDefault();const h=await sha256Hex(pin);if(h===expectedHash)onUnlock();else{setError("Incorrect PIN");setPin("")}}
 return <div className="auth"><div className="auth-card"><div className="logo">ISF</div><h1>Enter PIN</h1><p className="muted">অ্যাপ আনলক করতে আপনার PIN দিন</p>
 <form onSubmit={submit}><input type="password" inputMode="numeric" maxLength={6} placeholder="••••" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,""))} autoFocus required/>{error&&<div className="error">{error}</div>}<button className="primary wide">Unlock</button></form>
 </div></div>
}

function App(){
 const [session,setSession]=useState(null);
 const [recovery,setRecovery]=useState(false);
 const [settings,setSettingsState]=useState(loadLocalSettings);
 const [unlocked,setUnlocked]=useState(false);
 function updateSettings(patch){setSettingsState(s=>{const n={...s,...patch};saveLocalSettingsToDisk(n);return n})}
 useEffect(()=>{document.documentElement.setAttribute("data-theme",settings.darkTheme?"dark":"light")},[settings.darkTheme]);
 useEffect(()=>{
  supabase.auth.getSession().then(({data})=>setSession(data.session));
  const {data}=supabase.auth.onAuthStateChange((event,s)=>{setSession(s);if(event==="PASSWORD_RECOVERY")setRecovery(true)});
  return()=>data.subscription.unsubscribe()
 },[]);
 if(recovery)return <ResetPassword onDone={()=>setRecovery(false)}/>;
 if(!session)return <Auth/>;
 if(settings.appLock&&settings.pinHash&&!unlocked)return <PinGate expectedHash={settings.pinHash} onUnlock={()=>setUnlocked(true)}/>;
 return <Ledger user={session.user} settings={settings} updateSettings={updateSettings}/>;
}

function Ledger({user,settings,updateSettings}){
 const [tab,setTab]=useState("dashboard"),[settingsSub,setSettingsSub]=useState("profile"),[books,setBooks]=useState([]),[book,setBook]=useState(null),[transactions,setTransactions]=useState([]),[parties,setParties]=useState([]),[closings,setClosings]=useState([]),[auditLogs,setAuditLogs]=useState([]),[bookMembers,setBookMembers]=useState([]),[categories,setCategories]=useState([]),[paymentModes,setPaymentModes]=useState([]),[profile,setProfile]=useState(null),[role,setRole]=useState("employee"),[loading,setLoading]=useState(true),[toast,setToast]=useState(""),[business,setBusiness]=useState(null);
 const [showEntry,setShowEntry]=useState(false),[showBook,setShowBook]=useState(false),[showParty,setShowParty]=useState(false),[entryDefaults,setEntryDefaults]=useState(null),[selectedParty,setSelectedParty]=useState(null);
 const canManage=["primary_admin","admin"].includes(role);
 const t=useT(settings.language);
 async function audit(action,entity_type,entity_id,details={}){await supabase.from("audit_logs").insert({user_id:user.id,book_id:book?.id||null,action,entity_type,entity_id,details})}
 async function load(){
  setLoading(true);
  const [p,r,b,biz]=await Promise.all([
   supabase.from("profiles").select("*").eq("id",user.id).single(),
   supabase.from("user_roles").select("role").eq("user_id",user.id).single(),
   supabase.from("books").select("*").order("created_at",{ascending:false}),
   supabase.from("business_profile").select("*").eq("id",true).maybeSingle()
  ]);
  setProfile(p.data);setRole(r.data?.role||"employee");setBooks(b.data||[]);setBusiness(biz.data||null);
  const active=book&&b.data?.find(x=>x.id===book.id) || b.data?.[0] || null; setBook(active);
  if(active){
   const [t,pa,cl,al,bm,cat,pm]=await Promise.all([
    supabase.from("transactions").select("*,categories(name),payment_modes(name),profiles:member_id(full_name),parties(name)").eq("book_id",active.id).order("transaction_date",{ascending:false}).order("created_at",{ascending:false}),
    supabase.from("parties").select("*").eq("book_id",active.id).order("name"),
    supabase.from("daily_closings").select("*").eq("book_id",active.id).order("closing_date",{ascending:false}),
    supabase.from("audit_logs").select("*,profiles:user_id(full_name,email)").eq("book_id",active.id).order("created_at",{ascending:false}).limit(200),
    supabase.from("book_members").select("*,profiles:user_id(full_name,email)").eq("book_id",active.id).order("created_at",{ascending:false}),
    supabase.from("categories").select("*").eq("book_id",active.id).order("name"),
    supabase.from("payment_modes").select("*").eq("book_id",active.id).order("name")
   ]);
   setTransactions(t.data||[]);setParties(pa.data||[]);setClosings(cl.data||[]);setAuditLogs(al.data||[]);setBookMembers(bm.data||[]);setCategories(cat.data||[]);setPaymentModes(pm.data||[]);
  } else {setTransactions([]);setParties([]);setClosings([]);setAuditLogs([]);setBookMembers([]);setCategories([]);setPaymentModes([])}
  setLoading(false);
 }
 useEffect(()=>{load()},[user.id,book?.id]);
 const summary=useMemo(()=>{let tin=0,tout=0;transactions.forEach(t=>{if(t.transaction_type==="cash_in"||t.transaction_type==="collection")tin+=Number(t.amount);if(t.transaction_type==="cash_out"||t.transaction_type==="fund_given")tout+=Number(t.amount)});return {tin,tout,net:Number(book?.opening_balance||0)+tin-tout}},[transactions,book]);
 const partyBalances=useMemo(()=>{const m={};parties.forEach(p=>{const rows=transactions.filter(t=>t.party_id===p.id);const given=rows.filter(t=>t.transaction_type==="fund_given").reduce((s,t)=>s+Number(t.amount),0);const collected=rows.filter(t=>t.transaction_type==="collection").reduce((s,t)=>s+Number(t.amount),0);m[p.id]=given-collected});return m},[parties,transactions]);
 function notify(s){setToast(s);setTimeout(()=>setToast(""),2500)}
 async function signout(){await supabase.auth.signOut()}
 async function updateProfile(fields){const {error}=await supabase.from("profiles").update(fields).eq("id",user.id);if(error)notify(error.message);else{await audit("update","profile",user.id,fields);notify(t("profile_updated"));load()}}
 async function updateBusiness(fields){const {error}=await supabase.from("business_profile").upsert({id:true,...fields,updated_at:new Date().toISOString()});if(error)notify(error.message);else{await audit("update","business_profile",null,fields);notify("Business profile updated");load()}}
 async function changePassword(newPassword){const r=await supabase.auth.updateUser({password:newPassword});if(!r.error)await audit("update","password",user.id);return r}
 async function duplicate(){
  if(!book)return;
  const nb={...book,id:undefined,name:book.name+" Copy",owner_id:user.id,created_at:undefined,updated_at:undefined};
  delete nb.id;delete nb.created_at;delete nb.updated_at;
  const {data,error}=await supabase.from("books").insert(nb).select().single(); if(error)notify(error.message);else{await cloneSettings(book.id,data.id);await audit("duplicate","book",data.id,{from:book.id});notify("Book duplicated");load()}
 }
 async function cloneSettings(from,to){
  const [c,m]=await Promise.all([supabase.from("categories").select("name,type").eq("book_id",from),supabase.from("payment_modes").select("name").eq("book_id",from)]);
  if(c.data?.length)await supabase.from("categories").insert(c.data.map(x=>({...x,book_id:to})));
  if(m.data?.length)await supabase.from("payment_modes").insert(m.data.map(x=>({...x,book_id:to})));
 }
 async function deleteBook(){if(!book||!confirm("Delete this book and its transactions?"))return;const id=book.id;const r=await supabase.from("books").delete().eq("id",id);if(r.error)notify(r.error.message);else{setBook(null);notify("Book deleted");load()}}
 async function saveParty(payload){const {data,error}=await supabase.from("parties").insert({...payload,book_id:book.id,created_by:user.id}).select().single();if(error)notify(error.message);else{await audit("create","party",data.id,{name:payload.name});notify("Party added");load()}}
 async function deleteParty(id){if(!confirm("Delete this party? Their linked entries will keep their history but lose the party link."))return;const r=await supabase.from("parties").delete().eq("id",id);if(r.error)notify(r.error.message);else{await audit("delete","party",id);notify("Party deleted");setSelectedParty(null);load()}}
 async function closeDay(closeDate,vals){
  const {error}=await supabase.from("daily_closings").upsert({book_id:book.id,closing_date:closeDate,opening_balance:vals.opening,total_in:vals.tin,total_out:vals.tout,closing_balance:vals.closing,closed_by:user.id},{onConflict:"book_id,closing_date"});
  if(error)notify(error.message);else{await audit("close","daily_closing",null,{date:closeDate,closing:vals.closing});notify(`Day ${closeDate} closed`);load()}
 }
 async function inviteMember(email,perms){
  const {data:uid,error:e1}=await supabase.rpc("find_user_id_by_email",{lookup_email:email});
  if(e1||!uid)return notify("No account found for that email yet — ask them to sign up once first.");
  const {error}=await supabase.from("book_members").upsert({book_id:book.id,user_id:uid,...perms});
  if(error)notify(error.message);else{await audit("invite","book_member",uid,{email});notify("Member added to this book");load()}
 }
 async function updateMemberPerms(userId,perms){const {error}=await supabase.from("book_members").update(perms).eq("book_id",book.id).eq("user_id",userId);if(error)notify(error.message);else{await audit("update","book_member",userId,perms);notify("Permissions updated");load()}}
 async function removeMember(userId){if(!confirm("Remove this person from the book?"))return;const {error}=await supabase.from("book_members").delete().eq("book_id",book.id).eq("user_id",userId);if(error)notify(error.message);else{await audit("remove","book_member",userId);notify("Removed");load()}}
 function exportExcel(){
  const rows=transactions.map(t=>({Date:t.transaction_date,Type:t.transaction_type,Amount:Number(t.amount),Party:t.parties?.name||"",Member:t.profiles?.full_name||"",Category:t.categories?.name||"",PaymentMode:t.payment_modes?.name||"",Note:t.note||""}));
  const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Transactions");XLSX.writeFile(wb,`${book?.name||"ledger"}-${today()}.xlsx`);
 }
 function exportPDF(){
  const doc=new jsPDF();doc.text(`${book?.name||"Ledger"} Report`,14,16);doc.text(`Balance: ${money(summary.net)}`,14,26);let y=38;
  transactions.slice(0,28).forEach((t,i)=>{doc.text(`${t.transaction_date} | ${t.transaction_type} | ${money(t.amount)} | ${(t.note||"").slice(0,35)}`,14,y);y+=7});doc.save(`${book?.name||"ledger"}-${today()}.pdf`);
 }
 // ---------- Backup & Restore ----------
 // Pulls every book this user can see, with its parties/categories/payment modes/
 // transactions/closings, into one portable JSON snapshot.
 async function buildBackupSnapshot(){
  const {data:allBooks}=await supabase.from("books").select("*");
  const out={exported_at:new Date().toISOString(),app:"ISF Multi-Book Ledger",books:[]};
  for(const b of (allBooks||[])){
   const [tx,pa,cat,pm,cl]=await Promise.all([
    supabase.from("transactions").select("*").eq("book_id",b.id),
    supabase.from("parties").select("*").eq("book_id",b.id),
    supabase.from("categories").select("*").eq("book_id",b.id),
    supabase.from("payment_modes").select("*").eq("book_id",b.id),
    supabase.from("daily_closings").select("*").eq("book_id",b.id)
   ]);
   out.books.push({book:b,transactions:tx.data||[],parties:pa.data||[],categories:cat.data||[],payment_modes:pm.data||[],daily_closings:cl.data||[]});
  }
  return out;
 }
 function exportBackupFile(){
  buildBackupSnapshot().then(snap=>{
   const blob=new Blob([JSON.stringify(snap,null,2)],{type:"application/json"});
   const url=URL.createObjectURL(blob),a=document.createElement("a");
   a.href=url;a.download=`isf-ledger-backup-${today()}.json`;a.click();URL.revokeObjectURL(url);
   notify("Backup downloaded");
  }).catch(e=>notify(e.message));
 }
 // Restore recreates each backed-up book as a brand-new book (suffixed "(Restored)") so
 // it never overwrites existing data, then re-inserts its parties/categories/payment
 // modes/transactions/closings, remapping old IDs to the freshly created rows.
 async function restoreSnapshot(snap){
  if(!snap?.books?.length)return notify("Nothing to restore in that file.");
  for(const entry of snap.books){
   const src=entry.book||{};
   const {data:nb,error:be}=await supabase.from("books").insert({owner_id:user.id,name:(src.name||"Restored Book")+" (Restored)",book_type:src.book_type||"custom",description:src.description||"",opening_balance:Number(src.opening_balance||0),currency:src.currency||"BDT"}).select().single();
   if(be){notify(be.message);continue}
   const partyIdMap={},catIdMap={},pmIdMap={};
   if(entry.parties?.length)for(const p of entry.parties){const {data:np}=await supabase.from("parties").insert({book_id:nb.id,name:p.name,phone:p.phone,party_type:p.party_type,created_by:user.id}).select().single();if(np)partyIdMap[p.id]=np.id}
   if(entry.categories?.length)for(const c of entry.categories){const {data:nc}=await supabase.from("categories").insert({book_id:nb.id,name:c.name,type:c.type}).select().single();if(nc)catIdMap[c.id]=nc.id}
   if(entry.payment_modes?.length)for(const m of entry.payment_modes){const {data:nm}=await supabase.from("payment_modes").insert({book_id:nb.id,name:m.name}).select().single();if(nm)pmIdMap[m.id]=nm.id}
   if(entry.transactions?.length){
    const rows=entry.transactions.map(x=>({book_id:nb.id,created_by:user.id,party_id:partyIdMap[x.party_id]||null,category_id:catIdMap[x.category_id]||null,payment_mode_id:pmIdMap[x.payment_mode_id]||null,transaction_type:x.transaction_type,amount:Number(x.amount),transaction_date:x.transaction_date,note:x.note||""}));
    await supabase.from("transactions").insert(rows);
   }
   if(entry.daily_closings?.length){
    const rows=entry.daily_closings.map(x=>({book_id:nb.id,closing_date:x.closing_date,opening_balance:x.opening_balance,total_in:x.total_in,total_out:x.total_out,closing_balance:x.closing_balance,closed_by:user.id}));
    await supabase.from("daily_closings").insert(rows);
   }
  }
  await audit("restore","backup",null,{books:snap.books.length});
  notify("Backup restored as new book(s)");load();
 }
 function importBackupFile(file){
  const reader=new FileReader();
  reader.onload=()=>{try{restoreSnapshot(JSON.parse(reader.result))}catch{notify("That doesn't look like a valid backup file.")}};
  reader.readAsText(file);
 }
 async function backupToDrive(){
  try{
   notify("Connecting to Google Drive…");
   const token=await driveToken();
   const snap=await buildBackupSnapshot();
   await driveUpload(token,`isf-ledger-backup-${today()}.json`,snap);
   updateSettings({gdriveLastBackup:new Date().toISOString()});
   await audit("backup","google_drive",null,{});
   notify("Backed up to Google Drive");
  }catch(e){notify(e.message)}
 }
 async function restoreFromDrive(){
  try{
   notify("Connecting to Google Drive…");
   const token=await driveToken();
   const file=await driveFindLatestBackup(token);
   if(!file)return notify("No ISF backup found in Google Drive yet.");
   const snap=await driveDownload(token,file.id);
   await restoreSnapshot(snap);
  }catch(e){notify(e.message)}
 }
 return <div className="app">
  <header className="topbar"><div className="brand"><div className="logo">ISF</div><div><b>ISF Ledger</b><small>Multi-Book Cash Management</small></div><span className="role">{labelize(role)}</span></div><div className="top-actions"><button className="icon-btn" onClick={()=>setTab("settings")}><Settings size={19}/></button><button className="icon-btn" onClick={signout}><LogOut size={19}/></button></div></header>
  <main className="content">
   {loading?<div className="loading">Loading…</div>:<>
   {tab==="dashboard"&&<Dashboard t={t} book={book} books={books} summary={summary} transactions={transactions} setBook={setBook} onEntry={()=>{setEntryDefaults(null);setShowEntry(true)}} onBooks={()=>setShowBook(true)}/>}
   {tab==="books"&&<Books t={t} books={books} setBook={setBook} active={book} onNew={()=>setShowBook(true)} canManage={canManage} duplicate={duplicate} deleteBook={deleteBook}/>}
   {tab==="transactions"&&<Transactions t={t} transactions={transactions} book={book} parties={parties} paymentModes={paymentModes} onEntry={()=>{setEntryDefaults(null);setShowEntry(true)}}/>}
   {tab==="parties"&&<Parties t={t} parties={parties} balances={partyBalances} transactions={transactions} book={book} onNew={()=>setShowParty(true)} selected={selectedParty} setSelected={setSelectedParty} onEntry={pid=>{setEntryDefaults({transaction_type:"fund_given",party_id:pid});setShowEntry(true)}} deleteParty={deleteParty}/>}
   {tab==="reports"&&<Reports transactions={transactions} summary={summary} book={book} exportExcel={exportExcel} exportPDF={exportPDF}/>}
   {tab==="settings"&&<SettingsHub t={t} sub={settingsSub} setSub={setSettingsSub} profile={profile} role={role} canManage={canManage} user={user} book={book} bookMembers={bookMembers} inviteMember={inviteMember} updateMemberPerms={updateMemberPerms} removeMember={removeMember} closings={closings} transactions={transactions} closeDay={closeDay} auditLogs={auditLogs} updateProfile={updateProfile} changePassword={changePassword} settings={settings} updateSettings={updateSettings} business={business} updateBusiness={updateBusiness} exportBackupFile={exportBackupFile} importBackupFile={importBackupFile} backupToDrive={backupToDrive} restoreFromDrive={restoreFromDrive} gdriveConfigured={!!GDRIVE_CLIENT_ID}/>}
   </>}
  </main>
  <nav className="bottom-nav">{[["dashboard",LayoutDashboard,t("dashboard")],["books",BookOpen,t("books")],["transactions",FileText,t("transactions")],["parties",HandCoins,t("parties")],["reports",Download,t("reports")]].map(([k,I,l])=><button key={k} className={tab===k?"active":""} onClick={()=>setTab(k)}><I size={20}/><span>{l}</span></button>)}</nav>
  {showEntry&&<EntryModal book={book} user={user} parties={parties} defaults={entryDefaults} amountCalc={settings.amountCalc} onClose={()=>setShowEntry(false)} onSaved={async(tx)=>{setShowEntry(false);await audit("create","transaction",tx?.id,{type:tx?.transaction_type,amount:tx?.amount});load();notify("Transaction saved")}}/>}
  {showBook&&<BookModal user={user} onClose={()=>setShowBook(false)} onSaved={async(b)=>{setShowBook(false);await audit("create","book",b?.id,{name:b?.name});load();notify("Book created")}}/>}
  {showParty&&<PartyModal onClose={()=>setShowParty(false)} onSave={async(p)=>{setShowParty(false);await saveParty(p)}}/>}
  {toast&&<div className="toast">{toast}</div>}
 </div>
}

function Dashboard({t,book,books,summary,transactions,setBook,onEntry,onBooks}){
 return <section><div className="page-head"><div><h2>{t("dashboard")}</h2><p className="muted">{t("dashboard_sub")}</p></div><button className="primary" onClick={onEntry}><Plus size={17}/> {t("entry")}</button></div>
 <div className="book-picker"><BookOpen size={18}/><select value={book?.id||""} onChange={e=>setBook(books.find(x=>x.id===e.target.value))}>{books.length?books.map(b=><option key={b.id} value={b.id}>{b.name}</option>):<option>No books</option>}</select><button onClick={onBooks}>{t("manage")}</button></div>
 {!book?<div className="empty"><h3>Create your first book</h3><p>Start with a Day Book, Investment, Project or Client Record.</p><button className="primary" onClick={onBooks}>Create Book</button></div>:<>
 <div className="cards"><div className="stat"><span>Opening Balance</span><strong>{money(book.opening_balance)}</strong></div><div className="stat in"><span>Cash In + Collection</span><strong>{money(summary.tin)}</strong></div><div className="stat out"><span>Cash Out + Fund Given</span><strong>{money(summary.tout)}</strong></div><div className="stat net"><span>Net Balance</span><strong>{money(summary.net)}</strong></div></div>
 <div className="section-title"><h3>{t("recent_entries")}</h3></div><div className="list">{transactions.slice(0,8).map(tx=><Txn key={tx.id} t={tx}/>)}</div></>}
 </section>
}

function Txn({t}){
 const inflow=t.transaction_type==="cash_in"||t.transaction_type==="collection";
 const label=t.transaction_type==="fund_given"?"Fund Given":t.transaction_type==="collection"?"Collection":t.transaction_type==="cash_in"?"Cash In":"Cash Out";
 return <div className="txn"><div className={"txn-icon "+(inflow?"green":"red")}>{inflow?<ArrowDownLeft size={18}/>:<ArrowUpRight size={18}/>}</div><div className="txn-main"><b>{t.categories?.name||label}</b><small>{t.transaction_date} · {t.parties?.name||t.profiles?.full_name||"Unassigned"}{t.note?" · "+t.note:""}</small></div><strong className={inflow?"green-text":"red-text"}>{inflow?"+":"-"}{money(t.amount)}</strong></div>
}

function Books({t,books,setBook,active,onNew,canManage,duplicate,deleteBook}){return <section><div className="page-head"><div><h2>{t("books")}</h2><p className="muted">{t("books_sub")}</p></div><button className="primary" onClick={onNew}><Plus size={17}/> {t("new")}</button></div><div className="book-grid">{books.map(b=><div className={"book-card "+(active?.id===b.id?"selected":"")} key={b.id} onClick={()=>setBook(b)}><div className="book-cover"><BookOpen/></div><div><h3>{b.name}</h3><span>{labelize(b.book_type)}</span><p>{money(b.opening_balance)} opening</p></div><ChevronRight className="chev"/></div>)}</div>{active&&canManage&&<div className="toolbar"><button onClick={duplicate}><Copy size={16}/> Duplicate Book</button><button className="danger" onClick={deleteBook}><Trash2 size={16}/> Delete</button></div>}</section>}

function Transactions({t,transactions,book,parties,paymentModes,onEntry}){
 const [q,setQ]=useState(""),[type,setType]=useState("all"),[party,setParty]=useState(""),[pmode,setPmode]=useState(""),[preset,setPreset]=useState("all"),[from,setFrom]=useState(""),[to,setTo]=useState("");
 const setP=p=>{setPreset(p);const r=presetRange(p);if(r){setFrom(r.from);setTo(r.to)}};
 const clear=()=>{setQ("");setType("all");setParty("");setPmode("");setP("all")};
 const filtered=transactions.filter(row=>(!q||`${row.note} ${row.categories?.name||""} ${row.profiles?.full_name||""} ${row.parties?.name||""}`.toLowerCase().includes(q.toLowerCase()))&&(type==="all"||row.transaction_type===type)&&(!party||row.party_id===party)&&(!pmode||row.payment_mode_id===pmode)&&(!from||row.transaction_date>=from)&&(!to||row.transaction_date<=to));
 return <section><div className="page-head"><div><h2>{t("transactions")}</h2><p className="muted">{book?.name||t("select_book")}</p></div><button className="primary" onClick={onEntry}><Plus size={17}/> {t("add")}</button></div>
 <div className="filters"><div className="search"><Search size={17}/><input placeholder="Search notes, member, category…" value={q} onChange={e=>setQ(e.target.value)}/></div>
  <select value={preset} onChange={e=>setP(e.target.value)}><option value="all">All Time</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="this_month">This Month</option><option value="last_month">Last Month</option><option value="single_day">Single Day</option><option value="range">Date Range</option></select>
  {preset==="single_day"&&<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setTo(e.target.value)}}/>}
  {preset==="range"&&<><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></>}
  <select value={type} onChange={e=>setType(e.target.value)}><option value="all">All types</option><option value="cash_in">Cash In</option><option value="cash_out">Cash Out</option><option value="fund_given">Fund Given</option><option value="collection">Collection</option></select>
  <select value={party} onChange={e=>setParty(e.target.value)}><option value="">All parties</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
  <select value={pmode} onChange={e=>setPmode(e.target.value)}><option value="">All payment modes</option>{paymentModes.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
  <button className="link" onClick={clear}>✕ Clear</button>
 </div>
 <div className="list">{filtered.map(row=><Txn key={row.id} t={row}/>)}</div>{!filtered.length&&<div className="empty">{t("no_matching")}</div>}</section>}

// Distributor / Party Ledger — money given to distributors in the market and collected
// back from them. Each party's balance is Fund Given minus Collection: what they still owe.
function Parties({t,parties,balances,transactions,book,onNew,selected,setSelected,onEntry,deleteParty}){
 if(selected){
  const p=parties.find(x=>x.id===selected);
  const rows=transactions.filter(tx=>tx.party_id===selected);
  return <section><div className="page-head"><div><button className="link" onClick={()=>setSelected(null)}>{t("all_parties")}</button><h2>{p?.name}</h2><p className="muted">{labelize(p?.party_type)} {p?.phone?"· "+p.phone:""}</p></div><button className="primary" onClick={()=>onEntry(selected)}><Plus size={17}/> {t("entry")}</button></div>
  <div className="cards"><div className={"stat "+(balances[selected]>=0?"out":"in")}><span>{balances[selected]>=0?t("they_owe_you"):t("you_owe_them")}</span><strong>{money(Math.abs(balances[selected]||0))}</strong></div></div>
  <div className="list">{rows.map(tx=><Txn key={tx.id} t={tx}/>)}</div>{!rows.length&&<div className="empty">{t("no_party_entries")}</div>}
  <div className="toolbar"><button className="danger" onClick={()=>deleteParty(selected)}><Trash2 size={16}/> {t("delete_party")}</button></div>
  </section>
 }
 return <section><div className="page-head"><div><h2>{t("party_ledger")}</h2><p className="muted">{book?.name||t("select_book")} — {t("party_ledger_sub")}</p></div><button className="primary" onClick={onNew}><Plus size={17}/> {t("new_party")}</button></div>
 <div className="list">{parties.map(p=>{const b=balances[p.id]||0;return <div className="txn" key={p.id} onClick={()=>setSelected(p.id)} style={{cursor:"pointer"}}><div className={"txn-icon "+(b>=0?"red":"green")}><Wallet size={18}/></div><div className="txn-main"><b>{p.name}</b><small>{labelize(p.party_type)}{p.phone?" · "+p.phone:""}</small></div><strong className={b>=0?"red-text":"green-text"}>{b>=0?t("owes_you"):t("you_owe")}{money(Math.abs(b))}</strong></div>})}</div>
 {!parties.length&&<div className="empty">{t("no_parties")}</div>}
 </section>
}

function Reports({transactions,summary,book,exportExcel,exportPDF}){return <section><div className="page-head"><div><h2>Reports</h2><p className="muted">Export and review your current book</p></div><div className="row"><button onClick={exportExcel}><Download size={16}/> Excel</button><button onClick={exportPDF}><Download size={16}/> PDF</button></div></div><div className="cards"><div className="stat in"><span>Total In</span><strong>{money(summary.tin)}</strong></div><div className="stat out"><span>Total Out</span><strong>{money(summary.tout)}</strong></div><div className="stat net"><span>Net</span><strong>{money(summary.net)}</strong></div></div><div className="report-box"><h3>Report scope</h3><p>Book: <b>{book?.name||"—"}</b></p><p>Entries: <b>{transactions.length}</b></p><p>Formula: Opening Balance + (Cash In + Collection) − (Cash Out + Fund Given)</p></div></section>}

// Settings hub: Profile is open to everyone; Team, Daily Closing and Audit Log are the
// same tables the README always claimed existed — this is the UI that actually uses them.
function SettingsHub({t,sub,setSub,profile,role,canManage,user,book,bookMembers,inviteMember,updateMemberPerms,removeMember,closings,transactions,closeDay,auditLogs,updateProfile,changePassword,settings,updateSettings,business,updateBusiness,exportBackupFile,importBackupFile,backupToDrive,restoreFromDrive,gdriveConfigured}){
 return <section><div className="page-head"><div><h2>{t("settings")}</h2><p className="muted">{t("settings_sub")}</p></div></div>
 <div className="subnav">{[["profile",t("account")],["team",t("team_access")],["closing",t("daily_closing")],["audit",t("activity_log")],["business",t("business")],["preferences",t("preferences")]].map(([k,l])=><button key={k} className={sub===k?"on":""} onClick={()=>setSub(k)}>{l}</button>)}</div>
 {sub==="profile"&&<ProfilePanel t={t} profile={profile} role={role} updateProfile={updateProfile} changePassword={changePassword}/>}
 {sub==="team"&&<TeamPanel role={role} canManage={canManage} user={user} book={book} bookMembers={bookMembers} inviteMember={inviteMember} updateMemberPerms={updateMemberPerms} removeMember={removeMember}/>}
 {sub==="closing"&&<ClosingPanel book={book} closings={closings} transactions={transactions} closeDay={closeDay}/>}
 {sub==="audit"&&<AuditPanel auditLogs={auditLogs}/>}
 {sub==="business"&&<BusinessPanel business={business} canManage={canManage} updateBusiness={updateBusiness}/>}
 {sub==="preferences"&&<PreferencesPanel t={t} settings={settings} updateSettings={updateSettings} exportBackupFile={exportBackupFile} importBackupFile={importBackupFile} backupToDrive={backupToDrive} restoreFromDrive={restoreFromDrive} gdriveConfigured={gdriveConfigured}/>}
 </section>
}

// Business Profile — shared across the whole app (one row), same fields as the reference
// app's business card. Anyone can view it; only Admin/Primary Admin can edit.
function BusinessPanel({business,canManage,updateBusiness}){
 const [name,setName]=useState(business?.name||""),[address,setAddress]=useState(business?.address||""),
  [employees,setEmployees]=useState(business?.employees||""),[category,setCategory]=useState(business?.category||""),
  [subcategory,setSubcategory]=useState(business?.subcategory||""),[bizType,setBizType]=useState(business?.biz_type||""),
  [regNo,setRegNo]=useState(business?.reg_no||""),[mobile,setMobile]=useState(business?.mobile||""),
  [bizEmail,setBizEmail]=useState(business?.email||""),[busy,setBusy]=useState(false);
 useEffect(()=>{setName(business?.name||"");setAddress(business?.address||"");setEmployees(business?.employees||"");setCategory(business?.category||"");setSubcategory(business?.subcategory||"");setBizType(business?.biz_type||"");setRegNo(business?.reg_no||"");setMobile(business?.mobile||"");setBizEmail(business?.email||"")},[business?.id]);
 async function save(e){e.preventDefault();setBusy(true);await updateBusiness({name,address,employees,category,subcategory,biz_type:bizType,reg_no:regNo,mobile,email:bizEmail});setBusy(false)}
 return <div className="form-card"><h3>Business Profile</h3>
 <form onSubmit={save}>
  <label>Business name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Pay2local" disabled={!canManage} required/></label>
  <label>Address<input value={address} onChange={e=>setAddress(e.target.value)} disabled={!canManage}/></label>
  <label>Employees<input value={employees} onChange={e=>setEmployees(e.target.value)} placeholder="e.g. 20+" disabled={!canManage}/></label>
  <label>Category<input value={category} onChange={e=>setCategory(e.target.value)} disabled={!canManage}/></label>
  <label>Sub-category<input value={subcategory} onChange={e=>setSubcategory(e.target.value)} disabled={!canManage}/></label>
  <label>Business type<input value={bizType} onChange={e=>setBizType(e.target.value)} disabled={!canManage}/></label>
  <label>Registration no.<input value={regNo} onChange={e=>setRegNo(e.target.value)} disabled={!canManage}/></label>
  <label>Business mobile<input value={mobile} onChange={e=>setMobile(e.target.value)} disabled={!canManage}/></label>
  <label>Business email<input type="email" value={bizEmail} onChange={e=>setBizEmail(e.target.value)} disabled={!canManage}/></label>
  {canManage?<button className="primary wide" disabled={busy}>{busy?"Saving…":"Save Business Profile"}</button>:<p className="muted">Only Admins can edit the business profile.</p>}
 </form></div>
}

// Preferences — device-local (Dark Theme, Language, App Lock/PIN, Amount Calculator)
// plus Backup & Restore (local file, and optional Google Drive if configured).
function PreferencesPanel({t,settings,updateSettings,exportBackupFile,importBackupFile,backupToDrive,restoreFromDrive,gdriveConfigured}){
 const [pinStep,setPinStep]=useState(null); // null | "new1" | "new2"
 const [pinDraft,setPinDraft]=useState(""),[pinFirst,setPinFirst]=useState(""),[pinError,setPinError]=useState("");
 async function toggleLock(on){
  if(!on){updateSettings({appLock:false,pinHash:""});return}
  setPinStep("new1");setPinDraft("");setPinFirst("");setPinError("");
 }
 async function submitPinStep(e){
  e.preventDefault();
  if(pinDraft.length<4)return setPinError("PIN must be at least 4 digits.");
  if(pinStep==="new1"){setPinFirst(pinDraft);setPinDraft("");setPinStep("new2");setPinError("");return}
  if(pinDraft!==pinFirst){setPinError("PINs didn't match — try again.");setPinDraft("");setPinStep("new1");setPinFirst("");return}
  const hash=await sha256Hex(pinDraft);
  updateSettings({appLock:true,pinHash:hash});
  setPinStep(null);setPinDraft("");setPinFirst("");
 }
 return <div>
 <div className="form-card"><h3>{t("preferences")}</h3>
  <label className="full row" style={{justifyContent:"space-between"}}><span>{t("dark_theme")}<br/><small className="muted">{t("dark_theme_desc")}</small></span><input type="checkbox" checked={settings.darkTheme} onChange={e=>updateSettings({darkTheme:e.target.checked})}/></label>
  <label className="full row" style={{justifyContent:"space-between"}}><span>{t("amount_calc")}<br/><small className="muted">{t("amount_calc_desc")}</small></span><input type="checkbox" checked={settings.amountCalc} onChange={e=>updateSettings({amountCalc:e.target.checked})}/></label>
  <label>{t("language")}<select value={settings.language} onChange={e=>updateSettings({language:e.target.value})}><option value="en">English</option><option value="bn">বাংলা</option></select></label>
 </div>
 <div className="form-card"><h3>{t("app_lock")}</h3><p className="muted">{t("app_lock_desc")}</p>
  {!pinStep?
   <label className="full row" style={{justifyContent:"space-between"}}><span>{settings.appLock?"Enabled":"Disabled"}</span><input type="checkbox" checked={settings.appLock} onChange={e=>toggleLock(e.target.checked)}/></label>
   :
   <form onSubmit={submitPinStep}>
    <label>{pinStep==="new1"?"Choose a PIN (4–6 digits)":"Confirm your PIN"}<input type="password" inputMode="numeric" maxLength={6} value={pinDraft} onChange={e=>setPinDraft(e.target.value.replace(/\D/g,""))} autoFocus required/></label>
    {pinError&&<div className="error">{pinError}</div>}
    <div className="row"><button className="primary">{pinStep==="new1"?"Next":"Confirm"}</button><button type="button" className="link" onClick={()=>setPinStep(null)}>Cancel</button></div>
   </form>
  }
 </div>
 <div className="form-card"><h3>{t("backup_restore")}</h3>
  <div className="toolbar" style={{marginTop:0}}>
   <button onClick={exportBackupFile}><Download size={16}/> Export Backup (.json)</button>
   <label className="link" style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer"}}>
    Import Backup
    <input type="file" accept="application/json" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)importBackupFile(f);e.target.value=""}}/>
   </label>
  </div>
  <hr style={{border:"none",borderTop:"1px solid var(--isf-line)",margin:"14px 0"}}/>
  {gdriveConfigured?<>
   <div className="toolbar" style={{marginTop:0}}>
    <button onClick={backupToDrive}>Backup to Google Drive</button>
    <button onClick={restoreFromDrive}>Restore from Google Drive</button>
   </div>
   {settings.gdriveLastBackup&&<p className="muted">Last Drive backup: {new Date(settings.gdriveLastBackup).toLocaleString()}</p>}
  </>:<p className="muted">Google Drive backup isn't set up for this deployment yet — add <code>VITE_GOOGLE_CLIENT_ID</code> to enable it (see README).</p>}
 </div>
 </div>
}

function ProfilePanel({t,profile,role,updateProfile,changePassword}){
 const [fullName,setFullName]=useState(profile?.full_name||"");
 const [phone,setPhone]=useState(profile?.phone||"");
 const [savingProfile,setSavingProfile]=useState(false);
 const [pw1,setPw1]=useState(""),[pw2,setPw2]=useState(""),[pwBusy,setPwBusy]=useState(false),[pwMsg,setPwMsg]=useState(""),[pwOk,setPwOk]=useState(false);
 useEffect(()=>{setFullName(profile?.full_name||"");setPhone(profile?.phone||"")},[profile?.id]);
 async function saveProfile(e){e.preventDefault();setSavingProfile(true);await updateProfile({full_name:fullName.trim(),phone:phone.trim()});setSavingProfile(false)}
 async function savePassword(e){e.preventDefault();setPwMsg("");setPwOk(false);if(pw1.length<6)return setPwMsg(t("pw_min_length"));if(pw1!==pw2)return setPwMsg(t("pw_mismatch"));setPwBusy(true);const r=await changePassword(pw1);setPwBusy(false);if(r?.error)setPwMsg(r.error.message);else{setPwMsg(t("pw_updated"));setPwOk(true);setPw1("");setPw2("")}}
 return <div>
 <div className="form-card"><h3>{t("account_details")}</h3><form onSubmit={saveProfile}>
  <label>{t("full_name")}<input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder={t("your_name")}/></label>
  <label>{t("email")}<input value={profile?.email||""} readOnly/></label>
  <label>{t("phone")}<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="01XXXXXXXXX"/></label>
  <label>{t("currency")}<input value="BDT" readOnly/></label>
  <label>{t("access_level")}<input value={labelize(role)} readOnly/></label>
  <button className="primary wide" disabled={savingProfile}>{savingProfile?t("saving"):t("save_changes")}</button>
 </form></div>
 <div className="form-card"><h3>{t("change_password")}</h3><form onSubmit={savePassword}>
  <label>{t("new_password")}<input type="password" value={pw1} onChange={e=>setPw1(e.target.value)} minLength={6} required/></label>
  <label>{t("confirm_new_password")}<input type="password" value={pw2} onChange={e=>setPw2(e.target.value)} minLength={6} required/></label>
  {pwMsg&&<p className={pwOk?"muted":"error"}>{pwMsg}</p>}
  <button className="primary wide" disabled={pwBusy}>{pwBusy?t("updating"):t("update_password")}</button>
 </form></div>
 </div>
}

function TeamPanel({role,canManage,user,book,bookMembers,inviteMember,updateMemberPerms,removeMember}){
 const [email,setEmail]=useState("");
 const [perms,setPerms]=useState({can_view:true,can_create:true,can_edit:false,can_delete:false});
 return <div>
 <div className="role-card"><Users/><div><h3>Your access</h3><p>{user.email}</p><b>{labelize(role)}</b></div></div>
 <div className="report-box"><h3>Permission levels</h3><ul><li><b>Primary Admin:</b> full control — roles, all books, deletion.</li><li><b>Admin:</b> manages books, members and transactions.</li><li><b>Employee:</b> only sees the books listed below, with whatever's checked for them.</li></ul></div>
 {!book?<p className="muted">Select a book to manage its team.</p>:<>
 {canManage&&<div className="form-card"><h3>Invite to "{book.name}"</h3><form onSubmit={e=>{e.preventDefault();if(!email.trim())return;inviteMember(email.trim(),perms);setEmail("")}}><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="teammate@example.com" required/></label>
  <label className="full"><input type="checkbox" checked={perms.can_view} onChange={e=>setPerms({...perms,can_view:e.target.checked})}/> Can view</label>
  <label className="full"><input type="checkbox" checked={perms.can_create} onChange={e=>setPerms({...perms,can_create:e.target.checked})}/> Can create entries</label>
  <label className="full"><input type="checkbox" checked={perms.can_edit} onChange={e=>setPerms({...perms,can_edit:e.target.checked})}/> Can edit</label>
  <label className="full"><input type="checkbox" checked={perms.can_delete} onChange={e=>setPerms({...perms,can_delete:e.target.checked})}/> Can delete</label>
  <button className="primary wide"><UserPlus size={16}/> Add to Book</button></form></div>}
 <div className="list">{bookMembers.map(m=><div className="txn" key={m.user_id}><div className="txn-main"><b>{m.profiles?.full_name||m.profiles?.email}</b><small>{m.profiles?.email}</small></div>{canManage&&m.user_id!==user.id?<div className="row"><label><input type="checkbox" checked={m.can_view} onChange={e=>updateMemberPerms(m.user_id,{can_view:e.target.checked})}/> View</label><label><input type="checkbox" checked={m.can_create} onChange={e=>updateMemberPerms(m.user_id,{can_create:e.target.checked})}/> Create</label><label><input type="checkbox" checked={m.can_edit} onChange={e=>updateMemberPerms(m.user_id,{can_edit:e.target.checked})}/> Edit</label><label><input type="checkbox" checked={m.can_delete} onChange={e=>updateMemberPerms(m.user_id,{can_delete:e.target.checked})}/> Delete</label><button className="danger" onClick={()=>removeMember(m.user_id)}><Trash2 size={14}/></button></div>:<span className="muted">you</span>}</div>)}</div>
 {!bookMembers.length&&<p className="muted">No teammates added to this book yet.</p>}
 </>}
 </div>
}

// Daily Closing — pick a date, see what moved, close it. Closing balance becomes the
// next day's opening automatically (falls back to the book's opening balance for day one).
function ClosingPanel({book,closings,transactions,closeDay}){
 const [date,setDate]=useState(today());
 const dayTx=transactions.filter(t=>t.transaction_date===date);
 const tin=dayTx.filter(t=>t.transaction_type==="cash_in"||t.transaction_type==="collection").reduce((s,t)=>s+Number(t.amount),0);
 const tout=dayTx.filter(t=>t.transaction_type==="cash_out"||t.transaction_type==="fund_given").reduce((s,t)=>s+Number(t.amount),0);
 const prior=closings.filter(c=>c.closing_date<date).sort((a,b)=>b.closing_date.localeCompare(a.closing_date))[0];
 const opening=prior?Number(prior.closing_balance):Number(book?.opening_balance||0);
 const closing=opening+tin-tout;
 const already=closings.find(c=>c.closing_date===date);
 if(!book)return <p className="muted">Select a book first.</p>;
 return <div>
 <div className="form-card"><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></div>
 <div className="cards"><div className="stat"><span>Opening</span><strong>{money(opening)}</strong></div><div className="stat in"><span>Total In</span><strong>{money(tin)}</strong></div><div className="stat out"><span>Total Out</span><strong>{money(tout)}</strong></div><div className="stat net"><span>Closing</span><strong>{money(closing)}</strong></div></div>
 {already?<div className="report-box"><h3>Already closed</h3><p>Closing balance: <b>{money(already.closing_balance)}</b></p><p className="muted">Closed {new Date(already.closed_at).toLocaleString()}</p></div>:<button className="primary wide" onClick={()=>closeDay(date,{opening,tin,tout,closing})}><CalendarCheck size={17}/> Close {date}</button>}
 <div className="section-title"><h3>Recent Closings</h3></div>
 <div className="list">{closings.slice(0,15).map(c=><div className="txn" key={c.id}><div className="txn-main"><b>{c.closing_date}</b><small>In {money(c.total_in)} · Out {money(c.total_out)}</small></div><strong>{money(c.closing_balance)}</strong></div>)}</div>{!closings.length&&<p className="muted">No days closed yet.</p>}
 </div>
}

function AuditPanel({auditLogs}){
 return <div className="list">{auditLogs.map(a=><div className="txn" key={a.id}><div className="txn-icon"><History size={16}/></div><div className="txn-main"><b>{a.action} · {a.entity_type}</b><small>{a.profiles?.full_name||a.profiles?.email||a.user_id} · {new Date(a.created_at).toLocaleString()}</small></div></div>)}{!auditLogs.length&&<p className="muted">No activity recorded yet for this book.</p>}</div>
}

function EntryModal({book,user,parties,defaults,amountCalc,onClose,onSaved}){
 const [type,setType]=useState(defaults?.transaction_type||"cash_in"),[partyId,setPartyId]=useState(defaults?.party_id||""),[amount,setAmount]=useState(""),[date,setDate]=useState(today()),[note,setNote]=useState(""),[category,setCategory]=useState(""),[mode,setMode]=useState("Cash"),[busy,setBusy]=useState(false);
 const needsParty=type==="fund_given"||type==="collection";
 // Amount Calculator: if the field holds an expression like "500+200-30", evaluate it
 // in place (on blur, or via the = button) instead of trying to save it as-is.
 const amountResult=amountCalc?calcExpr(amount):null;
 function evalAmount(){if(amountResult!==null)setAmount(String(amountResult))}
 async function save(e){e.preventDefault();if(!book)return;if(needsParty&&!partyId)return alert("Select a party for Fund Given / Collection.");
 const finalAmount=amountCalc&&calcExpr(amount)!==null?calcExpr(amount):Number(amount);
 if(!finalAmount||finalAmount<=0)return alert("Enter a valid amount.");
 setBusy(true);let cat=null;const c=await supabase.from("categories").select("id").eq("book_id",book.id).eq("name",category||"General").maybeSingle();if(c.data)cat=c.data.id;else{const n=await supabase.from("categories").insert({book_id:book.id,name:category||"General",type:needsParty?null:type}).select("id").single();cat=n.data?.id}
 let pm=null;const m=await supabase.from("payment_modes").select("id").eq("book_id",book.id).eq("name",mode).maybeSingle();if(m.data)pm=m.data.id;else{const n=await supabase.from("payment_modes").insert({book_id:book.id,name:mode}).select("id").single();pm=n.data?.id}
 const {data,error}=await supabase.from("transactions").insert({book_id:book.id,created_by:user.id,party_id:needsParty?partyId:null,transaction_type:type,amount:finalAmount,transaction_date:date,note,category_id:cat,payment_mode_id:pm}).select().single();
 setBusy(false);if(error)alert(error.message);else onSaved(data)
 }
 return <div className="modal-bg"><div className="modal"><div className="modal-head"><h3>New Entry</h3><button onClick={onClose}><X/></button></div><div className="seg wrap"><button className={type==="cash_in"?"on in-btn":""} onClick={()=>setType("cash_in")}><ArrowDownLeft/> Cash In</button><button className={type==="cash_out"?"on out-btn":""} onClick={()=>setType("cash_out")}><ArrowUpRight/> Cash Out</button><button className={type==="fund_given"?"on out-btn":""} onClick={()=>setType("fund_given")}><HandCoins/> Fund Given</button><button className={type==="collection"?"on in-btn":""} onClick={()=>setType("collection")}><Wallet/> Collection</button></div><form onSubmit={save}>{needsParty&&<label>Party<select value={partyId} onChange={e=>setPartyId(e.target.value)} required><option value="">Select...</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<label>Amount{amountCalc?
   <div className="row" style={{gap:6}}>
    <input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} onBlur={evalAmount} placeholder="0.00 or 500+200" required style={{flex:1}}/>
    {amountResult!==null&&<button type="button" className="link" onClick={evalAmount}>= {amountResult}</button>}
   </div>
   :
   <input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" required min="0.01" step="0.01"/>
  }</label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label><label>Category<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="General"/></label><label>Payment Mode<input value={mode} onChange={e=>setMode(e.target.value)} placeholder="Cash / bKash / Bank"/></label><label>Note<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional note"/></label><button className="primary wide" disabled={busy}>{busy?"Saving…":"Save Transaction"}</button></form></div></div>
}

function BookModal({user,onClose,onSaved}){const [name,setName]=useState(""),[type,setType]=useState("day_book"),[opening,setOpening]=useState("0"),[desc,setDesc]=useState("");
 async function save(e){e.preventDefault();const r=await supabase.from("books").insert({owner_id:user.id,name,book_type:type,opening_balance:Number(opening),description:desc}).select().single();if(r.error)alert(r.error.message);else onSaved(r.data)}
 return <div className="modal-bg"><div className="modal"><div className="modal-head"><h3>New Book</h3><button onClick={onClose}><X/></button></div><form onSubmit={save}><label>Book name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Main Day Book" required/></label><label>Type<select value={type} onChange={e=>setType(e.target.value)}><option value="day_book">Day Book</option><option value="investment">Investments</option><option value="project">Project Book</option><option value="client_records">Client Records</option><option value="custom">Custom</option></select></label><label>Opening Balance<input inputMode="decimal" value={opening} onChange={e=>setOpening(e.target.value)} /></label><label>Description<textarea value={desc} onChange={e=>setDesc(e.target.value)}/></label><button className="primary wide">Create Book</button></form></div></div>
}

function PartyModal({onClose,onSave}){const [name,setName]=useState(""),[phone,setPhone]=useState(""),[party_type,setType]=useState("distributor");
 function save(e){e.preventDefault();if(!name.trim())return;onSave({name:name.trim(),phone:phone.trim(),party_type})}
 return <div className="modal-bg"><div className="modal"><div className="modal-head"><h3>New Party</h3><button onClick={onClose}><X/></button></div><form onSubmit={save}><label>Name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Rahim Distribution" required/></label><label>Phone<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="01XXXXXXXXX"/></label><label>Type<select value={party_type} onChange={e=>setType(e.target.value)}><option value="distributor">Distributor</option><option value="customer">Customer</option><option value="supplier">Supplier</option><option value="other">Other</option></select></label><button className="primary wide">Add Party</button></form></div></div>
}

export default App;
