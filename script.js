/* ═══════════════════════════════════════════════════
   WhisperRoom v2 — script.js
═══════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  getDatabase, ref, push, onValue,
  get, remove, update, set
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";
import {
  getStorage, ref as sRef,
  uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";

/* ── Config ── */
const firebaseConfig = {
  apiKey: "AIzaSyBtmebDPMTc6E453JQS03nBZiP26O_z0aE",
  authDomain: "whisper-room-2d13b.firebaseapp.com",
  databaseURL: "https://whisper-room-2d13b-default-rtdb.firebaseio.com",
  projectId: "whisper-room-2d13b",
  storageBucket: "whisper-room-2d13b.firebasestorage.app",
  messagingSenderId: "739497134518",
  appId: "1:739497134518:web:528b4a089c4186bd285917"
};

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getDatabase(app);
const storage = getStorage(app);

/* ═══════ PROFANITY FILTER ═══════ */
const BAD_WORDS = ["fuck","shit","bitch","asshole","bastard","cunt","dick","pussy","crap","idiot","moron","retard","whore","slut","nigger","faggot"];
const hasProfanity = t => BAD_WORDS.some(w => new RegExp(`\\b${w}\\b`,"i").test(t));

/* ═══════ STATE ═══════ */
let currentUser = null;
let currentUID  = null;
let userProfile = {};
let activeListeners = [];
let pendingFile = null;

/* ═══════ HELPERS ═══════ */
const $ = id => document.getElementById(id);
const initials = n => (n||"?")[0].toUpperCase();

function timeAgo(ts) {
  const d = Date.now() - ts, m = Math.floor(d/60000);
  if (m<1) return "just now";
  if (m<60) return m+"m";
  const h = Math.floor(m/60);
  if (h<24) return h+"h";
  return Math.floor(h/24)+"d";
}

function formatTimer(ms) {
  if (ms<=0) return "00:00";
  const s=Math.floor(ms/1000);
  return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
}

function readingTime(t) {
  const w = t.trim().split(/\s+/).length;
  const m = Math.ceil(w/200);
  return m<1 ? "< 1 min read" : m+" min read";
}

function clearListeners() { activeListeners.forEach(u=>u()); activeListeners=[]; }
function track(u) { activeListeners.push(u); }

function toast(msg, ms=2500) {
  const el=$("toast"); el.textContent=msg; el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"),ms);
}

function openModal(html) { $("modal-box").innerHTML=html; $("modal-overlay").style.display="flex"; }
function closeModal() { $("modal-overlay").style.display="none"; }
window.closeModal = closeModal;
$("modal-overlay").addEventListener("click", e=>{ if(e.target===$("modal-overlay")) closeModal(); });

function avatarHtml(nick, photo, cls="p-avatar") {
  return photo
    ? `<div class="${cls}"><img src="${photo}" alt="${nick}"/></div>`
    : `<div class="${cls}">${initials(nick)}</div>`;
}

async function uploadFile(file, path) {
  const r = sRef(storage, path);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}

function attachmentHtml(url, name, small=false) {
  if (!url) return "";
  const isImg = /\.(jpg|jpeg|png|gif|webp)/i.test(name||url);
  if (isImg) return `<img src="${url}" style="border-radius:10px;max-width:100%;display:block;margin-top:8px;" alt="attachment"/>`;
  return `<div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:${small?"12":"13"}px;color:var(--txt-2);">
    <i class="ph ph-file-text" style="color:var(--blue);font-size:18px;"></i>
    <a href="${url}" target="_blank" style="color:var(--blue);text-decoration:none;">${name||"View file"}</a>
  </div>`;
}

/* ═══════ DARK MODE ═══════ */
function applyTheme(dark) {
  document.documentElement.setAttribute("data-theme", dark?"dark":"light");
  const icon=$("themeIcon");
  if(icon) icon.className = dark?"ph ph-sun":"ph ph-moon";
  localStorage.setItem("wr-theme", dark?"dark":"light");
}
applyTheme(localStorage.getItem("wr-theme")==="dark");
$("themeToggle").onclick = () => applyTheme(document.documentElement.getAttribute("data-theme")!=="dark");

/* ═══════ AUTH ═══════ */
$("tab-signin").onclick = () => {
  ["tab-signin"].forEach(id=>$(id).classList.add("active"));
  $("tab-signup").classList.remove("active");
  $("signin-form").style.display="flex";
  $("signup-form").style.display="none";
};
$("tab-signup").onclick = () => {
  $("tab-signup").classList.add("active");
  $("tab-signin").classList.remove("active");
  $("signup-form").style.display="flex";
  $("signin-form").style.display="none";
};

$("btn-signin").onclick = async () => {
  const email=$("si-email").value.trim(), pass=$("si-password").value.trim();
  if(!email||!pass) return toast("Fill all fields");
  $("btn-signin").textContent="Signing in…";
  try {
    const c = await signInWithEmailAndPassword(auth,email,pass);
    currentUID=c.user.uid;
    const s = await get(ref(db,`users/${currentUID}`));
    userProfile=s.val()||{};
    currentUser=userProfile.nickname||email.split("@")[0];
    startApp();
  } catch(e){ toast(e.message); $("btn-signin").textContent="Sign In →"; }
};

$("btn-signup").onclick = async () => {
  const email=$("su-email").value.trim(), pass=$("su-password").value.trim(), nick=$("su-nick").value.trim();
  if(!email||!pass||!nick) return toast("Fill all fields");
  $("btn-signup").textContent="Creating…";
  try {
    const c = await createUserWithEmailAndPassword(auth,email,pass);
    currentUID=c.user.uid; currentUser=nick; userProfile={nickname:nick};
    await set(ref(db,`users/${currentUID}`),{nickname:nick,email});
    startApp();
  } catch(e){ toast(e.message); $("btn-signup").textContent="Create Account →"; }
};

window.logout = () => { signOut(auth); location.reload(); };

/* ═══════ APP START ═══════ */
function startApp() {
  $("landing-view").style.display="none";
  $("app-view").style.display="grid";
  const sa=$("s-avatar");
  if(userProfile.photoURL) sa.innerHTML=`<img src="${userProfile.photoURL}" alt="${currentUser}"/>`;
  else sa.textContent=initials(currentUser);
  $("s-name").textContent=currentUser;
  setupNav(); seedDemoPosts(); showHome(); watchNotifs(); loadRightPanel();
}

/* ═══════ NAV ═══════ */
function setupNav() {
  const map={
    "nav-home":showHome,"nav-explore":showExplore,
    "nav-trending":showTrending,"nav-rooms":showRooms,
    "nav-saved":showSaved,"nav-activity":showActivity,"nav-profile":showProfile
  };
  Object.entries(map).forEach(([id,fn])=>{
    $(id).onclick=()=>{
      document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));
      $(id).classList.add("active");
      clearListeners(); fn();
    };
  });
  $("btn-create").onclick=openComposer;
}

/* ═══════ NOTIFICATIONS ═══════ */
function watchNotifs() {
  const nr=ref(db,`notifications/${currentUID}`);
  const u=onValue(nr,snap=>{
    const count=Object.values(snap.val()||{}).filter(n=>!n.read).length;
    const dot=$("notif-dot"); if(dot) dot.style.display=count>0?"inline-block":"none";
  });
  track(u);
}

async function addNotif(uid,type,message,postId) {
  if(!uid||uid===currentUID) return;
  await push(ref(db,`notifications/${uid}`),{type,message,postId:postId||null,read:false,timestamp:Date.now()});
}

async function getOwnerUID(nick) {
  const s=await get(ref(db,"users")); if(!s.exists()) return null;
  return Object.entries(s.val()).find(([,u])=>u.nickname===nick)?.[0]||null;
}

/* ═══════ RIGHT PANEL ═══════ */
async function loadRightPanel() {
  const snap=await get(ref(db,"posts")); if(!snap.exists()) return;
  const posts=Object.entries(snap.val());
  const sorted=posts.sort((a,b)=>(b[1].likes||0)-(a[1].likes||0));

  // Post of the day
  if(sorted[0]) {
    const [,p]=sorted[0];
    $("rp-potd").innerHTML=`
      <div class="potd-card">
        <div class="potd-label"><i class="ph ph-star"></i> Post of the Day</div>
        <div class="potd-text">"${p.text.slice(0,100)}${p.text.length>100?"…":""}"</div>
        <div class="potd-author">— ${p.author}</div>
      </div>`;
  }

  // Suggested
  const sugg=posts.filter(([,p])=>p.owner!==currentUser)
    .sort((a,b)=>(b[1].likes||0)-(a[1].likes||0)).slice(0,5);
  $("rp-suggested").innerHTML=sugg.map(([,p])=>`
    <div class="sugg-item">
      <div class="sugg-author">${p.author}</div>
      <div class="sugg-snippet">${p.text.slice(0,65)}${p.text.length>65?"…":""}</div>
    </div>`).join("");
}

/* ═══════ HOME ═══════ */
function showHome() {
  $("main-content").innerHTML=`<div class="page-hd"><h2>Home</h2><p>Your personalised feed</p></div><div id="feed"></div>`;
  const pr=ref(db,"posts");
  const u=onValue(pr,snap=>{
    const all=Object.entries(snap.val()||{});
    const likedCats=all.filter(([id])=>localStorage.getItem(`like_${id}_${currentUID}`)==="1").map(([,p])=>p.category).filter(Boolean);
    const myCats=all.filter(([,p])=>p.owner===currentUser).map(([,p])=>p.category).filter(Boolean);
    const pref=new Set([...likedCats,...myCats]);
    let feed = pref.size===0
      ? all.sort((a,b)=>(b[1].likes||0)-(a[1].likes||0)).slice(0,20)
      : [...all.filter(([,p])=>pref.has(p.category)),...all.filter(([,p])=>!pref.has(p.category))].slice(0,30);
    renderPosts(feed,"feed");
  });
  track(u);
}

/* ═══════ EXPLORE ═══════ */
function showExplore() {
  $("main-content").innerHTML=`
    <div class="page-hd"><h2>Explore</h2><p>Discover the community</p></div>
    <div class="search-bar"><i class="ph ph-magnifying-glass"></i><input id="sq" placeholder="Search…"/></div>
    <div class="filter-pills" id="type-pills">
      <button class="filter-pill active" data-v="">All</button>
      <button class="filter-pill" data-v="doubt">Doubts</button>
      <button class="filter-pill" data-v="experience">Experiences</button>
    </div>
    <div class="filter-pills" id="cat-pills">
      <button class="filter-pill active" data-v="">All Categories</button>
      ${["Academic","Coding","Career","Personal","Mental"].map(c=>`<button class="filter-pill" data-v="${c}">${c}</button>`).join("")}
    </div>
    <div id="feed"></div>`;

  let all=[],tf="",cf="",sf="";
  const apply=()=>renderPosts(all.filter(([,p])=>
    (!tf||p.type===tf)&&(!cf||p.category===cf)&&
    (!sf||p.text.toLowerCase().includes(sf)||(p.author||"").toLowerCase().includes(sf))
  ),"feed");

  const u=onValue(ref(db,"posts"),snap=>{ all=Object.entries(snap.val()||{}); apply(); });
  track(u);

  setTimeout(()=>{
    $("sq")?.addEventListener("input",e=>{sf=e.target.value.toLowerCase();apply();});
    document.querySelectorAll("#type-pills .filter-pill").forEach(b=>b.onclick=()=>{
      document.querySelectorAll("#type-pills .filter-pill").forEach(x=>x.classList.remove("active"));
      b.classList.add("active"); tf=b.dataset.v; apply();
    });
    document.querySelectorAll("#cat-pills .filter-pill").forEach(b=>b.onclick=()=>{
      document.querySelectorAll("#cat-pills .filter-pill").forEach(x=>x.classList.remove("active"));
      b.classList.add("active"); cf=b.dataset.v; apply();
    });
  },0);
}

/* ═══════ TRENDING ═══════ */
function showTrending() {
  $("main-content").innerHTML=`<div class="page-hd"><h2>Trending</h2><p>Most liked posts</p></div><div id="feed"></div>`;
  const u=onValue(ref(db,"posts"),snap=>{
    const posts=Object.entries(snap.val()||{})
      .filter(([,p])=>(p.likes||0)>0)
      .sort((a,b)=>(b[1].likes||0)-(a[1].likes||0)).slice(0,15);
    renderPosts(posts,"feed",{showRank:true});
  });
  track(u);
}

/* ═══════ SAVED ═══════ */
function showSaved() {
  $("main-content").innerHTML=`<div class="page-hd"><h2>Saved</h2><p>Your bookmarks</p></div><div id="feed"></div>`;
  get(ref(db,`saved/${currentUID}`)).then(ss=>{
    const ids=Object.keys(ss.val()||{});
    if(!ids.length){ $("feed").innerHTML=`<div class="empty-state"><i class="ph ph-bookmark-simple"></i><p>Nothing saved yet</p></div>`; return; }
    get(ref(db,"posts")).then(ps=>{
      const all=ps.val()||{};
      renderPosts(ids.filter(id=>all[id]).map(id=>[id,all[id]]),"feed");
    });
  });
}

/* ═══════ ACTIVITY ═══════ */
function showActivity() {
  $("main-content").innerHTML=`<div class="page-hd"><h2>Activity</h2><p>Notifications about your posts</p></div><div id="act-list"></div>`;
  const u=onValue(ref(db,`notifications/${currentUID}`),snap=>{
    const list=$("act-list"); if(!list) return;
    const items=Object.entries(snap.val()||{}).sort((a,b)=>b[1].timestamp-a[1].timestamp);
    if(!items.length){ list.innerHTML=`<div class="empty-state"><i class="ph ph-bell-slash"></i><p>Nothing yet</p></div>`; return; }
    list.innerHTML=items.map(([,n])=>`
      <div class="activity-item">
        <div class="act-icon ${n.type}">
          <i class="ph ph-${n.type==="comment"?"chat-circle":n.type==="like"?"heart":"sparkle"}"></i>
        </div>
        <div><div class="act-text">${n.message}</div><div class="act-time">${timeAgo(n.timestamp)}</div></div>
      </div>`).join("");
    const upd={};
    items.forEach(([nid])=>{ upd[`notifications/${currentUID}/${nid}/read`]=true; });
    update(ref(db),upd);
  });
  track(u);
}

/* ═══════ PROFILE ═══════ */
function showProfile(tab="posts") {
  const photo=userProfile.photoURL;
  $("main-content").innerHTML=`
    <div class="profile-hero">
      <div class="profile-pic" id="ppBtn">
        ${photo?`<img src="${photo}" alt="${currentUser}"/>`:initials(currentUser)}
        <div class="pic-overlay"><i class="ph ph-camera"></i></div>
        <input type="file" id="ppFile" accept="image/*" style="display:none;"/>
      </div>
      <div class="profile-info">
        <h2>${currentUser}</h2>
        <p>WhisperRoom member</p>
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button class="btn-ghost" onclick="logout()">Log out</button>
        </div>
      </div>
    </div>
    <div class="profile-tabs">
      <button class="profile-tab ${tab==="posts"?"active":""}" onclick="showProfile('posts')">My Posts</button>
      <button class="profile-tab ${tab==="rooms"?"active":""}" onclick="showProfile('rooms')">My Rooms</button>
      <button class="profile-tab ${tab==="settings"?"active":""}" onclick="showProfile('settings')">Activity</button>
    </div>
    <div id="ptab"></div>`;

  $("ppBtn").onclick=()=>$("ppFile").click();
  $("ppFile").onchange=async e=>{
    const f=e.target.files[0]; if(!f) return;
    toast("Uploading…");
    try {
      const url=await uploadFile(f,`avatars/${currentUID}`);
      userProfile.photoURL=url;
      await update(ref(db,`users/${currentUID}`),{photoURL:url});
      $("s-avatar").innerHTML=`<img src="${url}" alt="${currentUser}"/>`;
      toast("Photo updated!"); showProfile(tab);
    } catch{ toast("Upload failed — check Firebase Storage rules"); }
  };

  const content=$("ptab");

  if(tab==="posts") {
    clearListeners();
    const u=onValue(ref(db,"posts"),snap=>{
      renderPosts(Object.entries(snap.val()||{}).filter(([,p])=>p.owner===currentUser),"ptab");
    });
    track(u);
  } else if(tab==="rooms") {
    get(ref(db,"rooms")).then(snap=>{
      const mine=Object.entries(snap.val()||{}).filter(([,r])=>r.host===currentUser);
      content.innerHTML=mine.length===0
        ? `<div class="empty-state"><i class="ph ph-chats-circle"></i><p>No rooms yet</p></div>`
        : mine.map(([id,r])=>roomCardHtml(id,r,true)).join("");
    });
  } else {
    get(ref(db,"posts")).then(async ps=>{
      const all=ps.val()||{};
      const likedIds=Object.keys(all).filter(id=>localStorage.getItem(`like_${id}_${currentUID}`)==="1");
      const cs=await get(ref(db,"comments")); const ca=cs.val()||{};
      const commentedIds=Object.keys(ca).filter(pid=>Object.values(ca[pid]||{}).some(c=>c.authorId===currentUID));
      content.innerHTML=`
        <div class="section-lbl">Posts You Liked</div>
        ${likedIds.length===0?`<p style="color:var(--txt-3);font-size:13px;margin-bottom:16px;">None yet</p>`:
          likedIds.map(id=>all[id]?`
            <div class="activity-setting-item">
              <div class="asi-icon" style="background:var(--red-soft);color:var(--red);"><i class="ph ph-heart-fill"></i></div>
              <div><div style="font-weight:600;">${all[id].author}</div>
              <div style="color:var(--txt-2);font-size:12px;">${all[id].text.slice(0,70)}…</div></div>
            </div>`:"").join("")}
        <div class="section-lbl" style="margin-top:24px;">Posts You Commented On</div>
        ${commentedIds.length===0?`<p style="color:var(--txt-3);font-size:13px;">None yet</p>`:
          commentedIds.map(id=>all[id]?`
            <div class="activity-setting-item">
              <div class="asi-icon" style="background:var(--blue-soft);color:var(--blue);"><i class="ph ph-chat-circle"></i></div>
              <div><div style="font-weight:600;">${all[id].author}</div>
              <div style="color:var(--txt-2);font-size:12px;">${all[id].text.slice(0,70)}…</div></div>
            </div>`:"").join("")}`;
    });
  }
}
window.showProfile=showProfile;

/* ═══════ RENDER POSTS ═══════ */
function renderPosts(posts,containerId,opts={}) {
  const feed=$(containerId); if(!feed) return;
  const sorted=[...posts].sort((a,b)=>b[1].timestamp-a[1].timestamp);
  if(!sorted.length){ feed.innerHTML=`<div class="empty-state"><i class="ph ph-note-blank"></i><p>Nothing here yet</p></div>`; return; }

  feed.innerHTML=sorted.map(([id,p],idx)=>{
    const isOwner=p.owner===currentUser;
    const hasLiked=localStorage.getItem(`like_${id}_${currentUID}`)==="1";
    const hasSaved=localStorage.getItem(`save_${id}_${currentUID}`)==="1";
    const agreed=localStorage.getItem(`agree_${id}_${currentUID}`)==="1";
    const myReact=localStorage.getItem(`react_${id}_${currentUID}`)||"";
    const reacts=[
      {key:"felt",emoji:"🤝",label:"I felt this"},
      {key:"helpful",emoji:"💡",label:"Helpful"},
      {key:"same",emoji:"🙋",label:"Same doubt"}
    ];

    return `
    <article class="post-card" id="post-${id}" style="animation-delay:${idx*.04}s">
      ${opts.showRank?`<div style="display:flex;gap:12px;align-items:flex-start;"><div class="rank-num">${idx+1}</div><div style="flex:1;">`:``}

      <div class="post-hd">
        ${avatarHtml(p.author,p.authorPhoto||"")}
        <div class="p-meta">
          <div class="p-author">${p.author}</div>
          <div class="p-time">${timeAgo(p.timestamp)} · ${readingTime(p.text)}</div>
        </div>
        ${isOwner?`
          <button class="icon-btn" onclick="editPost('${id}')"><i class="ph ph-pencil"></i></button>
          <button class="icon-btn" onclick="deletePost('${id}')"><i class="ph ph-trash"></i></button>`:""}
      </div>

      <div class="post-tags">
        ${p.type?`<span class="tag tag-${p.type}">${p.type}</span>`:""}
        ${p.category?`<span class="tag tag-cat">${p.category}</span>`:""}
        ${p.edited?`<span class="tag" style="background:var(--surface-2);color:var(--txt-3);">edited</span>`:""}
      </div>

      <div class="post-body">${p.text}</div>
      ${p.fileURL?attachmentHtml(p.fileURL,p.fileName):""}

      ${p.type==="doubt"?`
        <div class="agree-bar">
          <button class="agree-btn ${agreed?"active":""}" onclick="agreePost('${id}',${p.agrees||0})">
            🙋 Same doubt · ${p.agrees||0}
          </button>
        </div>`:""}

      <div class="reactions-row">
        ${reacts.map(r=>`
          <button class="reaction-btn ${myReact===r.key?"active":""}" onclick="reactPost('${id}','${r.key}')">
            ${r.emoji} ${r.label} <span style="opacity:0.6;font-size:11px;margin-left:3px;">${p["react_"+r.key]||0}</span>
          </button>`).join("")}
      </div>

      <div class="post-actions">
        <button class="action-btn ${hasLiked?"liked":""}" onclick="likePost('${id}',${p.likes||0})">
          <i class="ph ph-heart${hasLiked?"-fill":""}"></i> ${p.likes||0}
        </button>
        <button class="action-btn" onclick="toggleComments('${id}')">
          <i class="ph ph-chat-circle"></i> <span id="cc-${id}">${p.commentCount||0}</span>
        </button>
        <button class="action-btn ${hasSaved?"saved":""}" onclick="savePost('${id}')">
          <i class="ph ph-bookmark${hasSaved?"-fill":""}"></i>
        </button>
        <button class="action-btn" onclick="sharePost('${id}')">
          <i class="ph ph-share-network"></i>
        </button>
      </div>

      <div id="cw-${id}" style="display:none;"></div>

      ${opts.showRank?`</div></div>`:""}
    </article>`;
  }).join("");

  // Live comment counts
  sorted.forEach(([id])=>{
    const u=onValue(ref(db,`commentCount/${id}`),snap=>{
      const el=$(`cc-${id}`); if(el) el.textContent=snap.val()||0;
    });
    track(u);
  });
}

/* ═══════ LIKE ═══════ */
window.likePost=async function(id,cur){
  const key=`like_${id}_${currentUID}`;
  if(localStorage.getItem(key)==="1"){toast("Already liked!"); return;}
  await update(ref(db,`posts/${id}`),{likes:cur+1});
  localStorage.setItem(key,"1");
  const s=await get(ref(db,`posts/${id}`));
  const p=s.val();
  if(p?.owner&&p.owner!==currentUser){
    const uid=await getOwnerUID(p.owner);
    if(uid) await addNotif(uid,"like",`${currentUser} liked your post`,id);
  }
};

/* ═══════ AGREE (doubt) ═══════ */
window.agreePost=async function(id,cur){
  const key=`agree_${id}_${currentUID}`;
  if(localStorage.getItem(key)==="1"){toast("Already agreed!"); return;}
  await update(ref(db,`posts/${id}`),{agrees:cur+1});
  localStorage.setItem(key,"1");
};

/* ═══════ REACTIONS ═══════ */
window.reactPost=async function(id,type){
  const key=`react_${id}_${currentUID}`;
  const prev=localStorage.getItem(key);
  if(prev===type){toast("Already reacted!"); return;}
  const s=await get(ref(db,`posts/${id}`)); const p=s.val()||{};
  const upd={};
  if(prev) upd[`react_${prev}`]=Math.max(0,(p[`react_${prev}`]||0)-1);
  upd[`react_${type}`]=(p[`react_${type}`]||0)+1;
  await update(ref(db,`posts/${id}`),upd);
  localStorage.setItem(key,type);
};

/* ═══════ SAVE ═══════ */
window.savePost=async function(id){
  const key=`save_${id}_${currentUID}`;
  if(localStorage.getItem(key)==="1"){
    await remove(ref(db,`saved/${currentUID}/${id}`));
    localStorage.removeItem(key); toast("Removed from saved");
  } else {
    await set(ref(db,`saved/${currentUID}/${id}`),true);
    localStorage.setItem(key,"1"); toast("Saved!");
  }
};

/* ═══════ SHARE ═══════ */
window.sharePost=function(id){
  const url=`${location.origin}${location.pathname}#post-${id}`;
  navigator.clipboard.writeText(url).then(()=>toast("Link copied!")).catch(()=>toast("Link: "+url));
};

/* ═══════ DELETE / EDIT POST ═══════ */
window.deletePost=async function(id){
  if(!confirm("Delete this post?")) return;
  await remove(ref(db,`posts/${id}`));
  await remove(ref(db,`comments/${id}`));
  await remove(ref(db,`commentCount/${id}`));
  toast("Deleted");
};

window.editPost=async function(id){
  const s=await get(ref(db,`posts/${id}`)); if(!s.exists()) return;
  const p=s.val();
  openModal(`
    <button class="modal-close" onclick="closeModal()">✕</button>
    <h2>Edit Post</h2>
    <div class="form-section">
      <label class="form-label">Type</label>
      <select class="form-select" id="et">
        <option value="doubt" ${p.type==="doubt"?"selected":""}>Doubt</option>
        <option value="experience" ${p.type==="experience"?"selected":""}>Experience</option>
      </select>
    </div>
    <div class="form-section">
      <label class="form-label">Category</label>
      <select class="form-select" id="ec">
        ${["Academic","Coding","Career","Personal","Mental"].map(c=>`<option ${p.category===c?"selected":""}>${c}</option>`).join("")}
      </select>
    </div>
    <div class="form-section">
      <label class="form-label">Content</label>
      <textarea class="form-textarea" id="etext">${p.text}</textarea>
    </div>
    <div class="form-footer">
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveEdit('${id}')">Save</button>
    </div>`);
};

window.saveEdit=async function(id){
  const text=$("etext").value.trim(); if(!text) return;
  await update(ref(db,`posts/${id}`),{text,type:$("et").value,category:$("ec").value,edited:true,editedAt:Date.now()});
  closeModal(); toast("Updated!");
};

/* ═══════ COMMENTS ═══════ */
window.toggleComments=function(id){
  const wrap=$(`cw-${id}`); if(!wrap) return;
  const open=wrap.style.display!=="none";
  wrap.style.display=open?"none":"block";
  if(!open) loadComments(id,wrap);
};

function loadComments(postId,container) {
  container.innerHTML=`
    <div style="padding-top:12px;border-top:1px solid var(--border);">
      <div id="clist-${postId}"></div>
      <div class="comment-input-row" style="margin-top:10px;">
        ${avatarHtml(currentUser,userProfile.photoURL||"","c-avatar")}
        <input id="ci-${postId}" placeholder="Add a comment…"/>
        <label class="c-upload-btn">
          <i class="ph ph-paperclip"></i>
          <input type="file" id="cf-${postId}" accept="image/*,.pdf,.doc,.docx" style="display:none;"/>
        </label>
        <button class="icon-btn" onclick="submitComment('${postId}',null)"><i class="ph ph-paper-plane-right"></i></button>
      </div>
      <div id="cfp-${postId}" style="font-size:12px;color:var(--txt-3);margin-top:4px;"></div>
    </div>`;

  $(`ci-${postId}`).onkeypress=e=>{ if(e.key==="Enter") submitComment(postId,null); };
  $(`cf-${postId}`).onchange=e=>{ const f=e.target.files[0]; if(f) $(`cfp-${postId}`).textContent="📎 "+f.name; };

  const u=onValue(ref(db,`comments/${postId}`),snap=>{
    const data=Object.entries(snap.val()||{});
    const top=data.filter(([,c])=>!c.parentId).sort((a,b)=>a[1].timestamp-b[1].timestamp);
    const list=$(`clist-${postId}`); if(!list) return;
    list.innerHTML=top.map(([cid,c])=>{
      const children=data.filter(([,r])=>r.parentId===cid);
      return commentHtml(postId,cid,c,false,children);
    }).join("");
  });
  track(u);
}

function commentHtml(postId,cid,c,isReply,children=[]) {
  const vk=`cv_${postId}_${cid}_${currentUID}`;
  const mv=parseInt(localStorage.getItem(vk)||"0");
  return `
    <div class="comment-node">
      ${avatarHtml(c.author,c.authorPhoto||"","c-avatar")}
      <div style="flex:1;">
        <div class="c-body">
          <div class="c-author">${c.author}</div>
          <div class="c-text">${c.text}</div>
          ${c.fileURL?attachmentHtml(c.fileURL,c.fileName,true):""}
          <div class="c-actions">
            <button class="c-vote-btn ${mv===1?"up":""}" onclick="voteComment('${postId}','${cid}',1)">▲</button>
            <span class="c-vote-count" title="Upvotes">${c.upvotes||0}</span>
            <span style="color:var(--border-2);font-size:10px;padding:0 2px;">·</span>
            <span class="c-vote-count" title="Downvotes">${c.downvotes||0}</span>
            <button class="c-vote-btn ${mv===-1?"down":""}" onclick="voteComment('${postId}','${cid}',-1)">▼</button>
            ${!isReply?`<button class="c-reply-btn" onclick="showReplyBox('${postId}','${cid}')">Reply</button>`:""}
            <span style="font-size:11px;color:var(--txt-3);margin-left:4px;">${timeAgo(c.timestamp)}</span>
          </div>
          <div id="rb-${cid}"></div>
        </div>
        ${children.length?`
          <button class="replies-toggle" onclick="toggleReplies('${cid}')">
            <i class="ph ph-arrow-bend-down-right"></i> View ${children.length} repl${children.length===1?"y":"ies"}
          </button>
          <div id="rep-${cid}" style="display:none;" class="replies-container">
            ${children.map(([rcid,rc])=>commentHtml(postId,rcid,rc,true,[])).join("")}
          </div>`:""}
      </div>
    </div>`;
}

window.toggleReplies=function(cid){
  const r=$(`rep-${cid}`); if(!r) return;
  r.style.display=r.style.display==="none"?"block":"none";
};

window.voteComment=async function(postId,cid,delta){
  const key=`cv_${postId}_${cid}_${currentUID}`;
  const prev=parseInt(localStorage.getItem(key)||"0");
  if(prev===delta) return;
  const s=await get(ref(db,`comments/${postId}/${cid}`)); const c=s.val()||{};
  const upd={};
  if(delta===1){
    upd.upvotes=(c.upvotes||0)+(prev!==1?1:-1);
    if(prev===-1) upd.downvotes=Math.max(0,(c.downvotes||0)-1);
  } else {
    upd.downvotes=(c.downvotes||0)+(prev!==-1?1:-1);
    if(prev===1) upd.upvotes=Math.max(0,(c.upvotes||0)-1);
  }
  await update(ref(db,`comments/${postId}/${cid}`),upd);
  localStorage.setItem(key,prev===delta?"0":String(delta));
};

window.showReplyBox=function(postId,pcid){
  const box=$(`rb-${pcid}`); if(!box) return;
  if(box.innerHTML){box.innerHTML=""; return;}
  box.innerHTML=`
    <div class="comment-input-row" style="margin-top:8px;">
      <input id="ri-${pcid}" placeholder="Reply…"/>
      <button class="icon-btn" onclick="submitComment('${postId}','${pcid}')"><i class="ph ph-paper-plane-right"></i></button>
    </div>`;
  const i=$(`ri-${pcid}`); if(i) i.onkeypress=e=>{if(e.key==="Enter") submitComment(postId,pcid);};
};

window.submitComment=async function(postId,parentId){
  const inputId=parentId?`ri-${parentId}`:`ci-${postId}`;
  const inp=$(inputId); if(!inp) return;
  const text=inp.value.trim();
  const fi=$(`cf-${postId}`);
  const file=fi?.files?.[0];
  if(!text&&!file) return;

  let fileURL=null,fileName=null;
  if(file){ toast("Uploading…"); fileURL=await uploadFile(file,`comments/${postId}/${Date.now()}_${file.name}`); fileName=file.name; }

  await push(ref(db,`comments/${postId}`),{
    text:text||"",author:currentUser,authorId:currentUID,
    authorPhoto:userProfile.photoURL||null,
    upvotes:0,downvotes:0,parentId:parentId||null,
    timestamp:Date.now(),fileURL:fileURL||null,fileName:fileName||null
  });

  const cc=await get(ref(db,`commentCount/${postId}`));
  await set(ref(db,`commentCount/${postId}`),(cc.val()||0)+1);

  inp.value="";
  if(fi){fi.value=""; const fp=$(`cfp-${postId}`); if(fp) fp.textContent="";}

  // Notify post owner
  const ps=await get(ref(db,`posts/${postId}`)); const p=ps.val();
  if(p?.owner&&p.owner!==currentUser){
    const uid=await getOwnerUID(p.owner);
    if(uid) await addNotif(uid,"comment",`${currentUser} commented on your post`,postId);
  }
};

/* ═══════ COMPOSER ═══════ */
function openComposer(){
  pendingFile=null;
  openModal(`
    <button class="modal-close" onclick="closeModal()">✕</button>
    <h2>New Post</h2>
    <div class="form-section">
      <div class="form-row-2">
        <div><label class="form-label">Type</label>
          <select class="form-select" id="pt"><option value="doubt">Doubt</option><option value="experience">Experience</option></select>
        </div>
        <div><label class="form-label">Category</label>
          <select class="form-select" id="pc">
            ${["Academic","Coding","Career","Personal","Mental"].map(c=>`<option>${c}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>
    <div class="form-section">
      <label class="form-label">Your thought</label>
      <textarea class="form-textarea" id="ptext" placeholder="Share something on your mind…"></textarea>
    </div>
    <div class="upload-zone" onclick="document.getElementById('pfile').click()">
      <i class="ph ph-paperclip"></i>
      Attach image, PDF, or document (optional)
      <input type="file" id="pfile" accept="image/*,.pdf,.doc,.docx" style="display:none;"/>
    </div>
    <div id="upa"></div>
    <div class="form-footer">
      <label class="anon-toggle"><input type="checkbox" id="panon"/> Post anonymously</label>
      <div style="flex:1;"></div>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="psub">Whisper →</button>
    </div>`);

  $("pfile").onchange=e=>{
    pendingFile=e.target.files[0]; if(!pendingFile) return;
    const isImg=pendingFile.type.startsWith("image/");
    $("upa").innerHTML=`
      <div class="upload-preview">
        ${isImg?`<img src="${URL.createObjectURL(pendingFile)}" alt="preview"/>`:`<i class="ph ph-file-text"></i>`}
        <span>${pendingFile.name}</span>
        <button class="upload-clear" onclick="clearPF()">✕</button>
      </div>`;
  };

  $("psub").onclick=async()=>{
    const text=$("ptext").value.trim();
    if(!text&&!pendingFile) return;
    $("psub").textContent="Posting…"; $("psub").disabled=true;
    let fileURL=null,fileName=null;
    if(pendingFile){ fileURL=await uploadFile(pendingFile,`posts/${currentUID}_${Date.now()}_${pendingFile.name}`); fileName=pendingFile.name; }
    const anon=$("panon").checked;
    await push(ref(db,"posts"),{
      author:anon?"Anonymous":currentUser,
      authorPhoto:anon?null:(userProfile.photoURL||null),
      owner:currentUser,text:text||"",
      type:$("pt").value,category:$("pc").value,
      likes:0,agrees:0,commentCount:0,
      fileURL:fileURL||null,fileName:fileName||null,
      timestamp:Date.now()
    });
    pendingFile=null; closeModal(); toast("Posted!");
  };
}

window.clearPF=function(){ pendingFile=null; $("upa").innerHTML=""; $("pfile").value=""; };

/* ═══════ ROOMS ═══════ */
function showRooms(){
  $("main-content").innerHTML=`
    <div class="page-hd"><h2>Rooms</h2><p>Live sessions & discussion forums</p></div>
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
      <button class="btn-primary" id="crBtn"><i class="ph ph-plus"></i> Create Room</button>
      <button class="btn-ghost"   id="jrBtn"><i class="ph ph-sign-in"></i> Join Room</button>
    </div>
    <div class="section-lbl">Public Discussion Rooms</div>
    <div id="pub-rooms"></div>
    <div class="section-lbl">My Rooms</div>
    <div id="my-rooms"></div>
    <div class="section-lbl">Joined Rooms</div>
    <div id="joined-rooms"></div>`;

  $("crBtn").onclick=openCreateRoom;
  $("jrBtn").onclick=openJoinRoom;

  const u=onValue(ref(db,"rooms"),snap=>{
    const all=Object.entries(snap.val()||{});
    const pub=all.filter(([,r])=>r.type==="discussion");
    $("pub-rooms").innerHTML=pub.length===0
      ?`<p style="color:var(--txt-3);font-size:13px;">No public rooms yet</p>`
      :pub.map(([id,r])=>roomCardHtml(id,r,r.host===currentUser)).join("");

    const mine=all.filter(([,r])=>r.host===currentUser);
    $("my-rooms").innerHTML=mine.length===0
      ?`<p style="color:var(--txt-3);font-size:13px;">None</p>`
      :mine.map(([id,r])=>roomCardHtml(id,r,true)).join("");

    get(ref(db,`userRooms/${currentUID}`)).then(js=>{
      const jIds=Object.keys(js.val()||{});
      const rv=snap.val()||{};
      const joined=jIds.filter(id=>rv[id]&&rv[id].host!==currentUser).map(id=>[id,rv[id]]);
      $("joined-rooms").innerHTML=joined.length===0
        ?`<p style="color:var(--txt-3);font-size:13px;">None</p>`
        :joined.map(([id,r])=>roomCardHtml(id,r,false)).join("");
    });
  });
  track(u);
}

function roomCardHtml(id,r,isHost){
  const isSess=r.type==="session";
  const expired=isSess&&r.endsAt&&Date.now()>r.endsAt;
  const badge=isSess
    ?`<span class="room-badge ${expired?"ended":"live"}">${expired?"Ended":"● Live"}</span>`
    :`<span class="room-badge forum">Forum</span>`;
  return `
    <div class="room-card" onclick="openRoom('${id}')">
      <div class="room-icon ${r.type||"discussion"}">
        <i class="ph ph-${isSess?"broadcast":"chat-circle-dots"}"></i>
      </div>
      <div class="room-info">
        <div class="room-name">${r.name}</div>
        <div class="room-meta">${isSess?"Session":"Forum"} · ${r.host}</div>
      </div>
      ${badge}
      ${isHost?`<button class="icon-btn" onclick="event.stopPropagation();deleteRoom('${id}')"><i class="ph ph-trash"></i></button>`:""}
    </div>`;
}

window.deleteRoom=async function(id){
  if(!confirm("Delete this room?")) return;
  await remove(ref(db,`rooms/${id}`)); await remove(ref(db,`roomMessages/${id}`));
  await remove(ref(db,`polls/${id}`)); toast("Room deleted"); showRooms();
};

function openCreateRoom(){
  openModal(`
    <button class="modal-close" onclick="closeModal()">✕</button>
    <h2>Create Room</h2>
    <div class="form-section">
      <label class="form-label">Type</label>
      <select class="form-select" id="rt" onchange="$('tfield').style.display=this.value==='session'?'block':'none'">
        <option value="session">Session Room (Timed Live Q&A)</option>
        <option value="discussion">Discussion Forum (Permanent)</option>
      </select>
    </div>
    <div class="form-section">
      <label class="form-label">Room Name</label>
      <input class="form-input" id="rn" placeholder="e.g. React Workshop Q&A"/>
    </div>
    <div class="form-section">
      <label class="form-label">Password</label>
      <input class="form-input" type="password" id="rp" placeholder="Share with your audience"/>
    </div>
    <div class="form-section" id="tfield">
      <label class="form-label">Duration</label>
      <select class="form-select" id="rdur" onchange="$('cdur').style.display=this.value==='custom'?'block':'none'">
        <option value="900000">15 minutes</option>
        <option value="1800000">30 minutes</option>
        <option value="3600000">1 hour</option>
        <option value="7200000">2 hours</option>
        <option value="custom">Custom…</option>
      </select>
      <input class="form-input" id="cdur" type="number" min="1" placeholder="Minutes" style="display:none;margin-top:8px;"/>
    </div>
    <div class="form-footer">
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="crsub">Create</button>
    </div>`);

  window.$=id=>document.getElementById(id); // local alias for inline onclick
  $("crsub").onclick=async()=>{
    const name=$("rn").value.trim(),pass=$("rp").value.trim(),type=$("rt").value;
    if(!name||!pass) return toast("Fill all fields");
    let dur=parseInt($("rdur").value);
    if($("rdur").value==="custom"){ const m=parseInt($("cdur").value); if(!m) return toast("Enter duration"); dur=m*60000; }
    const data={name,pass,type,host:currentUser,hostUID:currentUID,createdAt:Date.now()};
    if(type==="session") data.endsAt=Date.now()+dur;
    const nr=await push(ref(db,"rooms"),data);
    await set(ref(db,`userRooms/${currentUID}/${nr.key}`),true);
    closeModal(); openRoom(nr.key);
  };
}

function openJoinRoom(){
  openModal(`
    <button class="modal-close" onclick="closeModal()">✕</button>
    <h2>Join Room</h2>
    <div class="form-section"><label class="form-label">Room Name</label><input class="form-input" id="jn" placeholder="Exact room name"/></div>
    <div class="form-section"><label class="form-label">Password</label><input class="form-input" type="password" id="jp" placeholder="Room password"/></div>
    <div class="form-footer">
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="jrsub">Enter</button>
    </div>`);

  $("jrsub").onclick=async()=>{
    const name=$("jn").value.trim(),pass=$("jp").value.trim();
    const s=await get(ref(db,"rooms")); if(!s.exists()) return toast("No rooms found");
    for(const [id,r] of Object.entries(s.val())){
      if(r.name===name&&r.pass===pass){
        await set(ref(db,`userRooms/${currentUID}/${id}`),true);
        closeModal(); openRoom(id); return;
      }
    }
    toast("Room not found or wrong password");
  };
}

/* ═══════ OPEN ROOM ═══════ */
window.openRoom=async function(roomId){
  clearListeners();
  const s=await get(ref(db,`rooms/${roomId}`)); if(!s.exists()) return toast("Room not found");
  const room=s.val();
  const isHost=room.host===currentUser;
  const isSess=room.type==="session";
  const anon=isSess&&!isHost;

  $("main-content").innerHTML=`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
      <button class="icon-btn" onclick="showRooms()"><i class="ph ph-arrow-left"></i></button>
      <div><div style="font-weight:700;font-size:18px;">${room.name}</div>
      <div style="font-size:12px;color:var(--txt-2);">${isSess?"Session":"Forum"} · ${room.host}</div></div>
    </div>

    ${isHost?`
      <div class="speaker-bar">
        <span>🎙 ${isSess?"Speaker":"Host"} Controls</span>
        ${isSess?`<button class="btn-secondary" onclick="extendRoom('${roomId}',900000)">+15 min</button>
          <button class="btn-secondary" onclick="extendRoom('${roomId}',1800000)">+30 min</button>
          <button class="btn-danger" onclick="endRoom('${roomId}')">End Session</button>`:""}
        <button class="btn-secondary" onclick="createPoll('${roomId}')"><i class="ph ph-chart-bar"></i> Poll</button>
      </div>`:""}

    ${isSess?`
      <div class="timer-bar">
        <div class="timer-label">Session ends in</div>
        <div class="timer-val" id="rtimer">--:--</div>
      </div>`:""}

    <div id="polls-container"></div>
    <div class="chat-feed" id="chatFeed"></div>
    <div class="blocked-msg" id="blk">⚠️ Inappropriate language detected.</div>
    <div class="chat-input-row">
      <input id="chatIn" placeholder="${anon?"Ask anonymously…":"Say something…"}"/>
      <label class="c-upload-btn"><i class="ph ph-paperclip"></i>
        <input type="file" id="chatfile" accept="image/*,.pdf" style="display:none;"/>
      </label>
      <button class="btn-primary" id="sendBtn">Send</button>
    </div>
    <div id="cfp" style="font-size:12px;color:var(--txt-3);margin-top:4px;"></div>`;

  // Timer
  if(isSess&&room.endsAt){
    const te=$("rtimer");
    const tick=()=>{
      const rem=room.endsAt-Date.now(); if(!te) return;
      if(rem<=0){te.textContent="Ended";te.classList.add("expiring");$("chatIn").disabled=true;$("sendBtn").disabled=true;return;}
      te.textContent=formatTimer(rem); te.classList.toggle("expiring",rem<120000); setTimeout(tick,1000);
    };
    tick();
  }

  $("chatfile").onchange=e=>{ const f=e.target.files[0]; $("cfp").textContent=f?"📎 "+f.name:""; };

  loadPolls(roomId,isHost);

  const chatRef=ref(db,`roomMessages/${roomId}`);
  const u=onValue(chatRef,snap=>{
    const feed=$("chatFeed"); if(!feed) return;
    const msgs=Object.entries(snap.val()||{}).sort((a,b)=>a[1].time-b[1].time);
    feed.innerHTML=msgs.map(([mid,m])=>{
      const mine=m.senderUID===currentUID;
      const author=isHost?(m.realNick||m.displayName):m.displayName;
      return `
        <div class="bubble ${mine?"mine":""}">
          ${!mine?`<div class="b-author">${author}</div>`:""}
          ${m.text?`<div class="b-text">${m.text}</div>`:""}
          ${m.fileURL?(m.fileURL.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)
            ?`<img class="b-img" src="${m.fileURL}" alt="img"/>`
            :`<a href="${m.fileURL}" target="_blank" style="${mine?"color:#fff":"color:var(--blue)"};font-size:12px;">📎 ${m.fileName||"File"}</a>`):""}
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div class="b-time">${timeAgo(m.time)}</div>
            ${isHost&&!mine?`<button class="icon-btn" style="color:rgba(255,255,255,0.4);font-size:12px;" onclick="delMsg('${roomId}','${mid}')"><i class="ph ph-trash"></i></button>`:""}
          </div>
        </div>`;
    }).join("");
    feed.scrollTop=feed.scrollHeight;
  });
  track(u);

  const sendFn=async()=>{
    const text=$("chatIn").value.trim();
    const file=$("chatfile").files?.[0];
    if(!text&&!file) return;
    if(isSess&&room.endsAt&&Date.now()>room.endsAt){toast("Session ended");return;}
    if(isSess&&!isHost&&hasProfanity(text)){
      const b=$("blk"); if(b){b.style.display="block";setTimeout(()=>b.style.display="none",3000);} return;
    }
    let fu=null,fn=null;
    if(file){toast("Uploading…");fu=await uploadFile(file,`rooms/${roomId}/${Date.now()}_${file.name}`);fn=file.name;}
    await push(chatRef,{text,displayName:anon?"Anonymous":currentUser,realNick:currentUser,senderUID:currentUID,fileURL:fu||null,fileName:fn||null,time:Date.now()});
    $("chatIn").value=""; $("chatfile").value=""; $("cfp").textContent="";
  };

  $("sendBtn").onclick=sendFn;
  $("chatIn").onkeypress=e=>{if(e.key==="Enter")sendFn();};
};

window.delMsg=async(rid,mid)=>remove(ref(db,`roomMessages/${rid}/${mid}`));
window.extendRoom=async(rid,extra)=>{
  const s=await get(ref(db,`rooms/${rid}/endsAt`));
  await update(ref(db,`rooms/${rid}`),{endsAt:Math.max(s.val()||Date.now(),Date.now())+extra});
  toast("Extended!"); openRoom(rid);
};
window.endRoom=async(rid)=>{if(!confirm("End session?"))return;await update(ref(db,`rooms/${rid}`),{endsAt:Date.now()});openRoom(rid);};

/* ═══════ POLLS ═══════ */
function createPoll(roomId){
  openModal(`
    <button class="modal-close" onclick="closeModal()">✕</button>
    <h2>Create Poll</h2>
    <div class="form-section"><label class="form-label">Question</label><input class="form-input" id="pq" placeholder="What do you want to ask?"/></div>
    <div class="form-section"><label class="form-label">Option 1</label><input class="form-input" id="po1" placeholder="Option A"/></div>
    <div class="form-section"><label class="form-label">Option 2</label><input class="form-input" id="po2" placeholder="Option B"/></div>
    <div class="form-section"><label class="form-label">Option 3 (optional)</label><input class="form-input" id="po3" placeholder="Option C"/></div>
    <div class="form-section"><label class="form-label">Duration in minutes (0 = no limit)</label><input class="form-input" id="pdur" type="number" min="0" value="30"/></div>
    <div class="form-footer">
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="psub2">Launch Poll</button>
    </div>`);

  $("psub2").onclick=async()=>{
    const q=$("pq").value.trim(),o1=$("po1").value.trim(),o2=$("po2").value.trim(),o3=$("po3").value.trim();
    const dur=parseInt($("pdur").value)||0;
    if(!q||!o1||!o2) return toast("Fill question and 2 options");
    const opts=[o1,o2,...(o3?[o3]:[])];
    await push(ref(db,`polls/${roomId}`),{question:q,options:opts,votes:{},endsAt:dur>0?Date.now()+dur*60000:null,createdAt:Date.now()});
    closeModal(); toast("Poll launched!");
  };
}
window.createPoll=createPoll;

function loadPolls(roomId,isHost){
  const u=onValue(ref(db,`polls/${roomId}`),snap=>{
    const c=$("polls-container"); if(!c) return;
    const polls=Object.entries(snap.val()||{});
    if(!polls.length){c.innerHTML="";return;}
    c.innerHTML=polls.map(([pid,poll])=>{
      const expired=poll.endsAt&&Date.now()>poll.endsAt;
      const myVote=(poll.votes||{})[currentUID];
      const total=Object.values(poll.votes||{}).length;
      const counts=poll.options.map((_,i)=>Object.values(poll.votes||{}).filter(v=>v===i).length);
      return `
        <div class="poll-card">
          <div class="poll-title">📊 ${poll.question}</div>
          ${poll.options.map((opt,i)=>{
            const pct=total>0?Math.round((counts[i]/total)*100):0;
            return `<div class="poll-option">
              <div class="poll-bar" style="width:${pct}%;"></div>
              <button class="poll-opt-btn ${myVote===i?"voted":""}" onclick="votePoll('${roomId}','${pid}',${i})" ${expired||myVote!==undefined?"disabled":""}>
                <span>${opt}</span>
                <span class="poll-pct">${myVote!==undefined?`${pct}% (${counts[i]})`:"vote"}</span>
              </button>
            </div>`;
          }).join("")}
          <div class="poll-expires">
            ${expired?"Poll ended":poll.endsAt?`Ends in ${formatTimer(poll.endsAt-Date.now())}`:"No time limit"} · ${total} vote${total!==1?"s":""}
            ${isHost?`<button class="btn-danger" style="margin-left:10px;padding:3px 8px;font-size:11px;" onclick="delPoll('${roomId}','${pid}')">Delete</button>`:""}
          </div>
        </div>`;
    }).join("");
  });
  track(u);
}
window.votePoll=async(rid,pid,i)=>update(ref(db,`polls/${rid}/${pid}/votes`),{[currentUID]:i});
window.delPoll=async(rid,pid)=>remove(ref(db,`polls/${rid}/${pid}`));

/* ═══════ SEED ═══════ */
async function seedDemoPosts(){
  const s=await get(ref(db,"posts")); if(s.exists()) return;
  const demos=[
    {text:"I feel completely lost choosing between a job offer and pursuing a master's degree. Has anyone navigated this?",type:"doubt",category:"Career",likes:24},
    {text:"Spoke up in class today after months of anxious silence. Small win but it felt like climbing Everest.",type:"experience",category:"Personal",likes:41},
    {text:"Can someone explain the difference between async/await and raw Promises? Every article confuses me more.",type:"doubt",category:"Coding",likes:17},
    {text:"Failed my first technical interview. Cried a bit. Then wrote down everything I learned. Worth it.",type:"experience",category:"Career",likes:33},
    {text:"Does anyone else feel like they understand concepts in class but blank during exams?",type:"doubt",category:"Academic",likes:28}
  ];
  for(const d of demos){
    await push(ref(db,"posts"),{author:"Someone",owner:"Someone",authorPhoto:null,text:d.text,type:d.type,category:d.category,
      likes:d.likes,agrees:0,commentCount:0,fileURL:null,fileName:null,timestamp:Date.now()-Math.random()*86400000*5});
  }
}