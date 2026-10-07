import { accountStore, accountReady } from "./account-state.js";
const style=document.createElement("link");style.rel="stylesheet";style.href=new URL("account-ui.css",import.meta.url).href;document.head.append(style);
const link=document.createElement("a");link.className="btn account-link";link.href=new URL("../account/",import.meta.url).href;link.textContent="Sign in";
const status=document.createElement("div");status.className="account-sync";status.setAttribute("role","status");status.hidden=true;
function show(){
  const s=accountStore.state;link.textContent=s.user ? "Account" : "Sign in";
  if(s.authOrigin)link.href=new URL("/prototypes/account/",s.authOrigin).href;
  const labels={saving:"Saving to account…",error:"Account saving needs attention.",unavailable:"Accounts are unavailable. View account for details.",conflict:"An item changed on another device."};
  status.hidden=!labels[s.status]; status.dataset.state=s.status;
  status.replaceChildren(document.createTextNode(labels[s.status]||""));
  if(!status.hidden){const a=document.createElement("a");a.href=link.href;a.textContent="View account";status.append(a);}
}
function mount(){const header=document.querySelector("header.top");if(header){if(!header.hasAttribute("data-account-page"))header.insertBefore(link,header.querySelector(".theme-btn"));document.body.append(status);}show();}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();
addEventListener("cpin-account-change",show);void accountReady.then(show);
