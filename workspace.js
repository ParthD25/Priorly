"use strict";
const byId=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeUrl=s=>{try{const u=new URL(s);return u.protocol==="https:"?u.href:"#"}catch{return "#"}};
let mode="login",user=null,projects=[],selected=null,evidence=[],runs=[],claims=[];
const toast=(message)=>{const box=byId("toast");box.textContent=message;box.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>box.hidden=true,4800)};
async function api(path,{method="GET",body}={}){
  const response=await fetch(path,{method,credentials:"same-origin",headers:body===undefined?{}:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(payload.error?.message||"Request failed (HTTP "+response.status+")");
  return payload;
}
function authView(isAuthenticated){
  byId("auth-screen").hidden=isAuthenticated;
  byId("workspace-screen").hidden=!isAuthenticated;
  byId("logout").hidden=!isAuthenticated;
  byId("current-email").textContent=isAuthenticated?user.email:"";
}
function setMode(next){
  mode=next;
  const signUp=next==="register";
  byId("auth-heading").textContent=signUp?"Start your workspace.":"Welcome back.";
  byId("auth-subheading").textContent=signUp?"Create a local development account.":"Sign in to your Priorly research workspace.";
  byId("auth-submit").textContent=signUp?"Create account →":"Sign in →";
  byId("toggle-auth").textContent=signUp?"Already have an account? Sign in":"New to Priorly? Create an account";
  byId("password").autocomplete=signUp?"new-password":"current-password";
  byId("auth-error").hidden=true;
}
function fillProject(p){
  selected=p?.id||null;
  byId("project-title").value=p?.title||"";
  byId("project-problem").value=p?.problem||"";
  byId("project-solution").value=p?.solution||"";
  byId("project-audience").value=p?.audience||"";
  byId("project-keywords").value=p?.keywords||"";
  byId("delete-project").hidden=!selected;
  byId("run-research").disabled=!selected;
  byId("export-brief").disabled=!selected;
  byId("source-add").disabled=!selected;
  byId("claim-add").disabled=!selected;
  byId("project-status").textContent=selected?"SAVED":"NEW PROJECT";
  drawProjects();
}
function drawProjects(){
  byId("project-count").textContent=String(projects.length);
  byId("project-list").innerHTML=projects.length?projects.map(p=>'<button type="button" class="project-item '+(p.id===selected?"active":"")+'" data-project="'+esc(p.id)+'"><strong>'+esc(p.title)+'</strong><small>Updated '+esc(new Date(p.updatedAt).toLocaleDateString())+'</small></button>').join(""):'<p class="small">No projects yet. Create one to begin.</p>';
}
async function listProjects(preferred){
  const response=await api("/api/v1/projects");
  projects=response.projects||[];
  const next=projects.find(x=>x.id===preferred)||projects.find(x=>x.id===selected)||projects[0];
  fillProject(next||null);
  await loadEvidence();
}
function bodyFromForm(){
  return {title:byId("project-title").value,problem:byId("project-problem").value,
    solution:byId("project-solution").value,audience:byId("project-audience").value,keywords:byId("project-keywords").value};
}
async function loadEvidence(){
  evidence=[];runs=[];claims=[];
  if(!selected){
    byId("research-status").textContent="NO PROJECT";
    byId("research-summary").textContent="Create a project, then run research.";
    byId("evidence-list").innerHTML="";
    drawClaims();
    return;
  }
  const [e,r,c]=await Promise.all([
    api("/api/v1/projects/"+selected+"/evidence"),
    api("/api/v1/projects/"+selected+"/research"),
    api("/api/v1/projects/"+selected+"/claims")
  ]);
  evidence=e.evidence||[];
  runs=r.runs||[];
  claims=c.claims||[];
  drawEvidence();
  drawClaims();
}
const classes=["unreviewed","overlap","differentiated","needs-review","irrelevant"];
function drawEvidence(){
  const reviewed=evidence.filter(x=>x.classification!=="unreviewed").length;
  byId("research-status").textContent=evidence.length+" SOURCES / "+reviewed+" REVIEWED";
  if(!runs.length){byId("research-summary").classList.remove("warn");byId("research-summary").textContent="No research runs yet. Your results will be saved here.";}
  else{
    const recent=runs[0].result;
    const errors=recent.sourceErrors||[];
    byId("research-summary").textContent="Last research: "+new Date(runs[0].createdAt).toLocaleString()+" · "+(recent.papers?.length||0)+" publications · "+(recent.repos?.length||0)+" repositories. "+(errors.length?"Some providers failed: "+errors.join("; "):"All requested sources responded. Results still require review.");
    byId("research-summary").classList.toggle("warn",errors.length>0);
  }
  byId("evidence-list").innerHTML=evidence.length?evidence.map(x=>'<article class="evidence-card" data-evidence="'+esc(x.id)+'"><div class="source-label">'+esc(x.source)+' · RETRIEVED '+esc(new Date(x.retrievedAt).toLocaleDateString())+'</div><a target="_blank" rel="noopener noreferrer" href="'+esc(safeUrl(x.url))+'">'+esc(x.title)+' ↗</a><div class="review-row"><select aria-label="Review classification" data-classification="'+esc(x.id)+'">'+classes.map(s=>'<option value="'+s+'" '+(x.classification===s?"selected":"")+'>'+esc(s.replace(/-/g," "))+'</option>').join("")+'</select><textarea data-note="'+esc(x.id)+' maxlength="1500" rows="2" placeholder="Evidence-specific human review notes…">'+esc(x.note)+'</textarea><button type="button" class="secondary" data-save-review="'+esc(x.id)+'">Save</button></div></article>').join(""):'<p class="small">No evidence collected. Run research to import linked publications and repositories.</p>';
}
function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement("a");link.href=url;link.download=name;document.body.append(link);link.click();
  setTimeout(()=>{URL.revokeObjectURL(url);link.remove()},1000);
}
function exportBrief(){
  const p=projects.find(x=>x.id===selected);
  if(!p)return;
  const md=[
    "# "+p.title+" — Priorly evidence brief",
    "", "**Generated:** "+new Date().toISOString(),"**Research runs:** "+runs.length,
    "", "## Problem",p.problem||"Not provided","", "## Proposed approach",p.solution||"Not provided",
    "", "## Intended customers",p.audience||"Not provided","", "## Search keywords",p.keywords||"Not provided",
    "", "## Reviewed source evidence",
    ...evidence.map(x=>"- **"+x.classification+"** "+x.title+" ("+x.source+") — "+x.url+"\n  - Reviewer notes: "+(x.note||"Not reviewed")),
    "", "## Claim-to-evidence comparisons",
    ...claims.flatMap(c=>["", "### "+c.description, c.mechanism||"Mechanism not documented", ...(c.links||[]).map(l=>"- "+l.relation+": "+l.title+" ("+l.url+") — Excerpt: "+(l.sourceExcerpt||"Not supplied")+" — Reviewer reasoning: "+(l.rationale||"Not supplied"))]),
    "", "## Important limitations",
    "Search hits do not establish novelty, patentability, ownership, freedom to operate or market viability.",
    "Review each source and have qualified counsel evaluate claim-level patent questions and title.",
    ...(runs[0]?.result?.sourceErrors?.length?["", "**Source errors:** "+runs[0].result.sourceErrors.join("; ")]:[])
  ].join("\n");
  download("priorly-"+p.title.toLowerCase().replace(/[^a-z0-9]+/g,"-")+".md",md,"text/markdown;charset=utf-8");
}
const linkRelations=["overlap","possible-difference","background","uncertain"];
function drawClaims(){
  byId("claim-status").textContent=claims.length+" CLAIMS";
  byId("claim-list").innerHTML=claims.length?claims.map(c=>{
    const links=(c.links||[]).map(l=>'<div class="claim-link"><span>'+esc(l.relation.replace(/-/g," "))+'</span><a href="'+esc(safeUrl(l.url))+'" target="_blank" rel="noopener noreferrer">'+esc(l.title)+' ↗</a><p>'+esc(l.sourceExcerpt||"No excerpt recorded")+'</p><p>'+esc(l.rationale||"Reviewer reasoning not recorded")+'</p><button type="button" class="text-action" data-unlink="'+esc(c.id)+'" data-source-id="'+esc(l.evidenceId)+'">Remove comparison</button></div>').join("");
    const options=evidence.map(e=>'<option value="'+esc(e.id)+'">'+esc(e.source+" · "+e.title.slice(0,70))+'</option>').join("");
    return '<article class="claim-item" data-claim="'+esc(c.id)+'"><div class="claim-heading"><div><strong>'+esc(c.description)+'</strong><p>'+esc(c.mechanism||"Technical mechanism not yet described.")+'</p></div><button class="danger" type="button" data-delete-claim="'+esc(c.id)+'">Delete</button></div>'+links+(evidence.length?'<div class="claim-link-form"><label>Attach and compare a source</label><select data-claim-source="'+esc(c.id)+'">'+options+'</select><select data-link-relation="'+esc(c.id)+'">'+linkRelations.map(x=>'<option value="'+x+'">'+esc(x.replace(/-/g," "))+'</option>').join("")+'</select><input data-link-excerpt="'+esc(c.id)+'" maxlength="1000" placeholder="Relevant passage, entered by reviewer"><textarea data-link-rationale="'+esc(c.id)+'" maxlength="1500" rows="2" placeholder="Why is this similar, different, or uncertain?"></textarea><button type="button" class="secondary" data-add-link="'+esc(c.id)+'">Save source comparison</button></div>':'<p class="small">Add a source in the research panel before mapping evidence to this claim.</p>')+'</article>';
  }).join(""):'<p class="small">No technical claims yet. Add a focused claim to start comparing evidence.</p>';
}
byId("source-form").onsubmit=async event=>{
  event.preventDefault();
  if(!selected){toast("Save a project first");return}
  const btn=byId("source-add");btn.disabled=true;
  try{
    await api("/api/v1/projects/"+selected+"/evidence",{method:"POST",body:{
      title:byId("source-title").value,source:byId("source-type").value,url:byId("source-url").value
    }});
    byId("source-form").reset();await loadEvidence();toast("Unverified source attached");
  }catch(e){toast(e.message)}finally{btn.disabled=!selected}
};
byId("claim-form").onsubmit=async event=>{
  event.preventDefault();if(!selected){toast("Save a project first");return}
  const btn=byId("claim-add");btn.disabled=true;
  try{
    await api("/api/v1/projects/"+selected+"/claims",{method:"POST",body:{
      description:byId("claim-description").value,mechanism:byId("claim-mechanism").value
    }});
    byId("claim-form").reset();await loadEvidence();toast("Technical claim saved");
  }catch(e){toast(e.message)}finally{btn.disabled=!selected}
};
byId("claim-list").onclick=async event=>{
  const add=event.target.closest("[data-add-link]");
  const del=event.target.closest("[data-delete-claim]");
  const unlink=event.target.closest("[data-unlink]");
  if(!add&&!del&&!unlink)return;
  const id=(add?.dataset.addLink||del?.dataset.deleteClaim||unlink?.dataset.unlink);
  if(del&&!confirm("Delete this technical claim and its linked evidence comparisons?"))return;
  event.target.disabled=true;
  try{
    const base="/api/v1/projects/"+selected+"/claims/"+id;
    if(add){
      const one=field=>byId("claim-list").querySelector('[data-'+field+'="'+id+'"]').value;
      await api(base+"/sources",{method:"POST",body:{
        evidenceId:one("claim-source"),relation:one("link-relation"),
        sourceExcerpt:one("link-excerpt"),rationale:one("link-rationale")
      }});
    }else if(del){await api(base,{method:"DELETE",body:{}})}
    else{await api(base+"/sources/"+unlink.dataset.sourceId,{method:"DELETE",body:{}})}
    await loadEvidence();toast("Claim evidence updated");
  }catch(e){toast(e.message);event.target.disabled=false}
};
byId("toggle-auth").onclick=()=>setMode(mode==="login"?"register":"login");
byId("auth-form").onsubmit=async e=>{
  e.preventDefault(); const button=byId("auth-submit");button.disabled=true;byId("auth-error").hidden=true;
  try{
    const result=await api("/api/v1/auth/"+(mode==="login"?"login":"register"),{method:"POST",body:{email:byId("email").value,password:byId("password").value}});
    if(result.verificationRequired){byId("password").value="";setMode("login");toast(result.message||"Verify your email, then sign in.");return;}
    user=result.user;authView(true);byId("password").value="";await listProjects();toast("Signed in");
  }catch(err){byId("auth-error").textContent=err.message;byId("auth-error").hidden=false}
  finally{button.disabled=false}
};
byId("logout").onclick=async()=>{
  try{await api("/api/v1/auth/logout",{method:"POST",body:{}});user=null;projects=[];selected=null;authView(false);setMode("login")}catch(err){toast(err.message)}
};
byId("new-project").onclick=()=>{selected=null;fillProject(null);loadEvidence()};
byId("project-list").onclick=async e=>{
  const btn=e.target.closest("[data-project]");if(!btn)return;
  const p=projects.find(x=>x.id===btn.dataset.project);if(!p)return;
  fillProject(p);
  try{await loadEvidence()}catch(err){toast(err.message)}
};
byId("project-form").addEventListener("input",()=>{byId("project-status").textContent="UNSAVED CHANGES";byId("run-research").disabled=true});
byId("project-form").onsubmit=async e=>{
  e.preventDefault();const button=byId("save-project");button.disabled=true;
  try{
    const body=bodyFromForm();
    const result=selected?await api("/api/v1/projects/"+selected,{method:"PUT",body}):await api("/api/v1/projects",{method:"POST",body});
    await listProjects(result.project.id);toast("Project saved");
  }catch(err){toast(err.message)}finally{button.disabled=false}
};
byId("delete-project").onclick=async()=>{
  if(!selected||!confirm("Permanently delete this project, its research runs, and reviews?"))return;
  try{await api("/api/v1/projects/"+selected,{method:"DELETE",body:{}});selected=null;await listProjects();toast("Project deleted")}
  catch(err){toast(err.message)}
};
byId("run-research").onclick=async()=>{
  if(!selected)return;
  const p=projects.find(x=>x.id===selected);
  if(!p.problem||!p.solution){toast("Add a complete problem and proposed solution, then save.");return;}
  const btn=byId("run-research");btn.disabled=true;btn.textContent="Researching…";
  try{await api("/api/v1/projects/"+selected+"/research",{method:"POST",body:{}});await loadEvidence();toast("Research saved with source links")}
  catch(err){toast(err.message)}finally{btn.disabled=false;btn.textContent="Run research on saved project ↗"}
};
byId("export-brief").onclick=exportBrief;
byId("evidence-list").onclick=async e=>{
  const btn=e.target.closest("[data-save-review]");if(!btn)return;
  const id=btn.dataset.saveReview;
  const category=byId("evidence-list").querySelector('[data-classification="'+id+'"]');
  const note=byId("evidence-list").querySelector('[data-note="'+id+'"]');
  btn.disabled=true;
  try{
    await api("/api/v1/projects/"+selected+"/evidence/"+id,{method:"PATCH",body:{classification:category.value,note:note.value}});
    await loadEvidence();toast("Evidence review saved");
  }catch(err){toast(err.message);btn.disabled=false}
};
(async()=>{try{const r=await api("/api/v1/auth/me");user=r.user;authView(true);await listProjects()}
catch{user=null;authView(false)}})();
