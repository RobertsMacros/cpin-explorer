import { api, accountReady, accountStore, SAVED_KEYS } from "../shared/account-state.js";
import { escHtml as esc } from "../shared/citation.js";
import { pinId } from "../shared/pins.js";
import { reviewTargets } from "../shared/review-feedback-core.js";
const root=document.querySelector("#accountContent"), params=new URLSearchParams(location.search);
let view=params.get("view")||"login", resetToken=new URLSearchParams(location.hash.slice(1)).get("token")||"", ownerPage=0;
if(resetToken) history.replaceState(null,"",location.pathname+location.search);
const password=(name="password",confirm=false)=>`<div><label for="${name}">${confirm ? "Confirm password" : "Password"}</label><span class="password-field"><input id="${name}" type="password" name="${name}" autocomplete="${view==="login" ? "current-password" : "new-password"}" required minlength="${view==="login" ? 1 : 12}" maxlength="128"><button type="button" data-reveal="${name}" aria-pressed="false" aria-label="Show ${confirm ? "confirmation password" : "password"}">Show</button></span></div>`;
const back='<a href="../dashboard/">Continue browsing without an account</a>';
function message(text,error=false){const el=document.querySelector("#accountMessage");el.textContent=text;el.classList.toggle("account-error",error);}
function download(){if(!accountStore.state.loaded)throw new Error("Account saves have not loaded. Retry before downloading a copy.");const a=document.createElement("a"),url=URL.createObjectURL(new Blob([JSON.stringify(accountStore.snapshot(),null,2)],{type:"application/json"}));a.href=url;a.download="cpin-account-saves.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function render(){
  const s=accountStore.state;
  if(s.user && view!=="reset" && view!=="password") {
    root.innerHTML=`<p class="eyebrow">Your account</p><h1>${s.user.approved ? "Saved with you" : "Awaiting approval"}</h1><div class="account-card"><p><b>${esc(s.user.name)}</b><br>${esc(s.user.email)}</p>
      <p>${s.user.approved ? "Your highlights, pinned countries and reports, and private review notes are saved to your account. They follow you when you sign in on another device." : "Your account request is pending. The owner must approve access before you can save to this account. You can continue reading without login."}</p>
      <p id="savingStatus">${s.user.approved ? `Saving status: <b>${esc(s.status)}</b>. ${esc(s.error)}` : ""}</p><div class="account-actions">
      ${s.user.approved ? '<a class="btn btn--primary" href="../saved/">Open Saved</a><button class="btn" data-action="import">Copy browser saves to account</button><button class="btn" data-action="download">Download account saves</button><button class="btn" data-action="retry">Retry saving</button><a class="btn" href="?view=password">Change password</a>' : ""}
      <button class="btn" data-action="signout">Sign out</button></div>
      <p class="account-hint">Signing in uses an essential session cookie. Account saves do not depend on optional cookies or browser storage. Browser-only saves are separate and are copied only when you choose.</p>
      <p id="accountMessage" class="account-message" role="status"></p>
      <div id="conflicts">${s.conflicts.map(c=>`<div class="owner-row"><p>${esc(c.kind)} · ${esc(c.id)} changed on another device. Download your copy before resolving.</p><div class="account-actions"><button class="btn" data-resolve="${esc(c.key)}" data-keep="false">Use account copy</button><button class="btn" data-resolve="${esc(c.key)}" data-keep="true">Save this device’s change</button></div></div>`).join("")}</div></div>
      ${s.user.role==="owner" ? '<section id="owner"><h2>Account approvals</h2><p>Check who owns the email address before approving. Approval allows private account saving; it does not mark their source reviews as correct.</p><div id="ownerAccounts">Loading account requests…</div></section><section><h2>AI recheck queue</h2><p>Disagreements and their notes are separate from private saved reviews. A task includes the original AI review and unconfirmed peers; a queued task has not been checked yet.</p><div id="recheckQueue">Loading recheck queue…</div></section>' : ""}`;
    if(s.user.role==="owner"){void loadOwner();void loadRechecks();} bind();return;
  }
  const reset=view==="reset",forgot=view==="forgot",signup=view==="signup",change=view==="password";
  const title=reset ? "Set a new password" : forgot ? "Password help" : signup ? "Request an account" : change ? "Change password" : "Sign in";
  root.innerHTML=`<p class="eyebrow">CPIN Explorer · optional account</p><h1>${title}</h1><div class="account-card">
    <p>${signup ? "Choose a password and request access. Every new account needs the owner’s approval." : forgot ? "Password resets are arranged by the owner. Request a link, then contact them to receive it." : reset ? "This private reset link expires after 30 minutes and can be used once." : change ? "Confirm your current password to choose a new one." : "Keep your highlights, pinned countries and reports, and private notes across devices."}</p>
    ${!s.configured ? '<p class="account-error">Accounts are not available on this installation yet. Public reading and browser-only saves still work.</p>' : ""}
    <form class="account-form" id="accountForm">
      ${signup ? '<label>Name<input name="name" autocomplete="name" required maxlength="120"></label>' : ""}
      ${!reset&&!change ? '<label>Email<input type="email" name="email" autocomplete="username" required maxlength="254" autocapitalize="none" spellcheck="false"></label>' : ""}
      ${change ? '<div><label for="currentPassword">Current password</label><span class="password-field"><input id="currentPassword" type="password" name="currentPassword" autocomplete="current-password" required maxlength="128"><button type="button" data-reveal="currentPassword" aria-pressed="false">Show</button></span></div>' : ""}
      ${!forgot ? password() : ""}${reset||signup||change ? '<p class="account-hint">Use at least 12 characters. A longer passphrase works well.</p>'+password("confirmation",true) : ""}
      <button type="submit" class="btn btn--primary" ${!s.configured ? "disabled" : ""}>${title}</button>
      <p id="accountMessage" class="account-message" role="status"></p></form>
      <div class="account-links">${view!=="login" ? '<a href="?view=login">Sign in</a>' : '<a href="?view=signup">Request an account</a><a href="?view=forgot">Forgot password?</a>'}${back}</div></div>`;
  bind();document.querySelector("#accountForm").addEventListener("submit",async e=>{
    e.preventDefault(); const form=e.currentTarget,data=Object.fromEntries(new FormData(form));
    if(data.confirmation!==undefined && data.password!==data.confirmation){message("The passwords do not match.",true);return;}
    const button=form.querySelector('[type="submit"]');button.disabled=true;message("Please wait…");
    try {
      if(forgot){const r=await api("/api/password-help",{email:data.email});message(r.message);}
      else if(reset){if(!resetToken)throw new Error("This reset link is missing or expired. Request a new link.");await api("/api/auth/reset-password",{newPassword:data.password,token:resetToken});resetToken="";location.replace("?view=login");}
      else if(change){await api("/api/auth/change-password",{currentPassword:data.currentPassword,newPassword:data.password,revokeOtherSessions:true});form.reset();message("Password changed. Other sessions have been signed out.");}
      else {await api(signup ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email",{email:data.email,password:data.password,...(signup ? {name:data.name} : {})});location.replace(location.pathname);}
    } catch(error){message(view==="login" && [400,401].includes(error.status) ? "Email or password is incorrect." : error.message,true);}
    finally{button.disabled=false;}
  });
}
function bind(){
  root.querySelectorAll("[data-reveal]").forEach(b=>b.addEventListener("click",()=>{const input=root.querySelector(`input[name="${b.dataset.reveal}"]`),show=input.type==="password";input.type=show ? "text" : "password";b.textContent=show ? "Hide" : "Show";b.setAttribute("aria-pressed",String(show));b.setAttribute("aria-label",`${show ? "Hide" : "Show"} password`);}));
  root.querySelectorAll("[data-action]").forEach(b=>b.addEventListener("click",async()=>{
    b.disabled=true;
    try {
      const action=b.dataset.action;
      if(action==="download")download();
      if(action==="retry"){if(!accountStore.state.loaded)await accountStore.refresh();await accountStore.flush();message(accountStore.hasPending() ? "Some changes remain unsaved. Resolve conflicts below or download your copy." : "All changes saved to your account.");}
      if(action==="signout"){if(accountStore.hasPending()&&!await accountStore.flush())throw new Error("Download or resolve your unsaved changes before signing out.");await api("/api/auth/sign-out",{});location.replace(location.pathname);}
      if(action==="import"){
        for(const [key,kind] of Object.entries(SAVED_KEYS)){
          const list=JSON.parse(localStorage.getItem(key)||"[]");if(!Array.isArray(list))continue;
          const current=accountStore.values(kind),seen=new Set(current.map(v=>kind==="pins" ? pinId(v) : v.id));
          const extra=list.filter(v=>v && !seen.has(kind==="pins" ? pinId(v) : v.id));
          accountStore.replace(kind,[...current,...extra]);
        }
        await accountStore.flush();message(accountStore.hasPending() ? "Copying is incomplete. Your original browser saves are still retained." : "Browser saves copied. Their originals remain in this browser.");
      }
    }catch(e){message(e.message,true);}finally{b.disabled=false;}
  }));
  root.querySelectorAll("[data-resolve]").forEach(b=>b.addEventListener("click",()=>{accountStore.resolve(b.dataset.resolve,b.dataset.keep==="true");render();}));
}
async function loadOwner(){
  const container=document.querySelector("#ownerAccounts");
  try {const r=await api(`/api/owner/accounts?page=${ownerPage}`);container.innerHTML=`<p>${r.total} accounts · page ${ownerPage+1} of ${Math.max(1,Math.ceil(r.total/50))}</p><div class="account-actions"><button class="btn" data-owner-page="${ownerPage-1}" ${ownerPage===0 ? "disabled" : ""}>Previous</button><button class="btn" data-owner-page="${ownerPage+1}" ${(ownerPage+1)*50>=r.total ? "disabled" : ""}>Next</button></div>`+r.accounts.map(u=>`<article class="owner-row"><strong>${esc(u.name)}</strong><span>${esc(u.email)}</span><p>${u.role==="owner" ? "Owner" : u.approved ? "Approved" : "Pending / access paused"}${u.passwordRequestedAt ? " · Password help requested" : ""}</p><div class="account-actions">${u.role!=="owner" ? `<button class="btn" data-approval="${esc(u.id)}" data-approved="${!u.approved}">${u.approved ? "Pause access" : "Approve account"}</button>` : ""}${u.approved ? `<button class="btn" data-reset-user="${esc(u.id)}">Create password reset link</button>` : ""}</div><div data-reset-result></div></article>`).join("");
    container.querySelectorAll("[data-owner-page]").forEach(b=>b.addEventListener("click",()=>{ownerPage=Number(b.dataset.ownerPage);void loadOwner();}));
    container.querySelectorAll("[data-approval]").forEach(b=>b.addEventListener("click",async()=>{b.disabled=true;try{await api("/api/owner/approval",{userId:b.dataset.approval,approved:b.dataset.approved==="true"});await loadOwner();}catch(e){message(e.message,true);b.disabled=false;}}));
    container.querySelectorAll("[data-reset-user]").forEach(b=>b.addEventListener("click",async()=>{b.disabled=true;try{const r=await api("/api/owner/password-link",{userId:b.dataset.resetUser}),el=b.closest("article").querySelector("[data-reset-result]");el.replaceChildren();const a=document.createElement("a");a.className="reset-link";a.href=r.url;a.textContent=r.url;el.append(document.createTextNode("Private link · expires in 30 minutes. Share only with the verified account holder."),a);b.remove();}catch(e){message(e.message,true);b.disabled=false;}}));
  }catch(e){container.textContent=e.message;}
}
async function loadRechecks(page=0){
  const container=document.querySelector("#recheckQueue");
  try {
    const data=await api(`/api/owner/recheck-queue?page=${page}`);
    container.innerHTML=`<p>${data.total} pending AI recheck${data.total===1 ? "" : "s"}. Processed during Codex review sessions.</p><div class="account-actions"><button type="button" class="btn" data-recheck-refresh>Refresh queue</button><button type="button" class="btn" data-recheck-export ${data.tasks.length ? "" : "disabled"}>Download these AI tasks</button><button class="btn" data-recheck-page="${page-1}" ${page===0 ? "disabled" : ""}>Previous</button><button class="btn" data-recheck-page="${page+1}" ${(page+1)*10>=data.total ? "disabled" : ""}>Next</button></div>`+
      data.tasks.map(task=>`<details class="owner-row"><summary>${esc(task.review.summary)}</summary><p>${task.feedback.length} disagreement${task.feedback.length===1 ? "" : "s"} · ${task.peers.length} unconfirmed peer reviews available; not yet investigated.</p>${task.feedback.map(f=>`<p><b>${esc(f.reason)}</b> — ${esc(f.note || "No explanation added.")}</p>`).join("")}${reviewTargets(task.review).map(t=>`<p><a href="../reader/?${esc(new URLSearchParams({country:t.country,series:t.series,edition:t.editionId}).toString())}">Open the exact ${esc(t.country)} edition</a></p>`).join("")}</details>`).join("");
    container.querySelector('[data-recheck-refresh]').addEventListener('click',()=>void loadRechecks(page));
    container.querySelectorAll('[data-recheck-page]').forEach(b=>b.addEventListener('click',()=>void loadRechecks(Number(b.dataset.recheckPage))));
    container.querySelector('[data-recheck-export]').addEventListener('click',()=>{
      const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      a.href=url;a.download='cpin-ai-recheck-tasks-private.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
  }catch(error){container.textContent=error.message;}
}
await accountReady;
// Session cookies belong to the primary domain. Older public host links take
// readers there before they enter a password, without cross-origin API calls.
if(accountStore.state.authOrigin && new URL(accountStore.state.authOrigin).origin!==location.origin) {
  location.replace(new URL(`/prototypes/account/${location.search}${resetToken ? '#token='+encodeURIComponent(resetToken) : ''}`,accountStore.state.authOrigin).href);
} else render();
addEventListener("cpin-account-change",()=>{
  if(accountStore.state.conflicts.length || document.querySelector("[data-resolve]")) {render();return;}
  const status=document.querySelector("#savingStatus");
  if(status && accountStore.state.user?.approved) status.textContent=`Saving status: ${accountStore.state.status}. ${accountStore.state.error}`;
});
document.querySelector("#theme")?.addEventListener("click",()=>{const dark=document.documentElement.dataset.theme==="dark";document.documentElement.dataset.theme=dark ? "light" : "dark";try{localStorage.setItem("cpin-theme",dark ? "light" : "dark");}catch{}});

const browserSaving=document.querySelector('#browserSaving');
try {browserSaving.checked=localStorage.getItem('cpin-browser-saving')!=='no';} catch {browserSaving.checked=false;}
browserSaving.addEventListener('change',()=>{try{localStorage.setItem('cpin-browser-saving',browserSaving.checked?'yes':'no');}catch{browserSaving.checked=false;message('Browser storage is blocked. Account saving is unaffected.');}});
