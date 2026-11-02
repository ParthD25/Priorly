'use strict';
const KEY='priorly.v1';
const checks=[
['Contributor agreements','Are all founders, employees and contractors covered by appropriate signed assignment agreements?'],
['Prior employment obligations','Could an employer, consulting client or prior contract claim rights in the work?'],
['University resources or sponsorship','Were campus facilities, funding, employment, faculty direction or course arrangements involved?'],
['Open-source licenses','Have code dependencies, copied snippets and their license obligations been reviewed?'],
['Invention disclosure timeline','Have public demos, publications, repositories or sales conversations disclosed the invention?'],
['Founders and inventors','Are contributors, actual inventors and their respective roles documented accurately?'],
['Third-party data and model terms','Do datasets, APIs and AI model terms permit intended development and commercial usage?'],
['Patent counsel and freedom to operate','Has qualified counsel reviewed patentability separately from infringement and freedom-to-operate risks?']
];
const seed={ideaName:'',ideaProblem:'',ideaSolution:'',ideaAudience:'',ideaKeywords:'',ipNotes:'',checked:[],papers:[],repos:[],searchedAt:null,sourceErrors:[],query:''};
let state=load();
function load(){try{const data=JSON.parse(localStorage.getItem(KEY));return {...seed,...data,checked:Array.isArray(data?.checked)?data.checked:[]}}catch{return {...seed}}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}}
const el=id=>document.getElementById(id);
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeUrl(s){try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:'#'}catch{return '#'}}
function navigate(page){for(const t of document.querySelectorAll('.tab'))t.classList.toggle('active',t.id===page);for(const a of document.querySelectorAll('.nav-item')){a.classList.toggle('active',a.dataset.tab===page);a.setAttribute('aria-current',a.dataset.tab===page?'page':'false')}el('crumb').textContent=page.toUpperCase();location.hash=page;window.scrollTo({top:0,behavior:'instant'});if(page==='report')renderReport()}
function bind(){['ideaName','ideaProblem','ideaSolution','ideaAudience','ideaKeywords','ipNotes'].forEach(k=>{el(k).value=state[k]||'';el(k).addEventListener('input',e=>{state[k]=e.target.value;save()})});document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));document.querySelectorAll('.nav-item').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();navigate(a.dataset.tab)}));el('idea-form').addEventListener('submit',research);el('reset').onclick=()=>{if(confirm('Clear all locally saved Priorly concept, research and checklist data?')){state={...seed};save();location.reload()}};el('downloadMarkdown').onclick=()=>download('priorly-report.md','text/markdown',reportMD());el('downloadJSON').onclick=()=>download('priorly-report.json','application/json',JSON.stringify(state,null,2));el('printReport').onclick=()=>{renderReport();window.print()};drawChecks();renderResults();navigate(['overview','research','ownership','report'].includes(location.hash.slice(1))?location.hash.slice(1):'overview')}
function drawChecks(){el('checkProgress').textContent=state.checked.length+' / '+checks.length+' RECORDED';el('checklist').innerHTML=checks.map(([a,b],i)=>'<label class="check-row"><input type="checkbox" data-check="'+i+'" '+(state.checked.includes(i)?'checked':'')+'><span><strong>'+escapeHTML(a)+'</strong><small>'+escapeHTML(b)+'</small></span></label>').join('');document.querySelectorAll('[data-check]').forEach(box=>box.addEventListener('change',e=>{const i=Number(e.target.dataset.check);state.checked=e.target.checked?[...new Set([...state.checked,i])]:state.checked.filter(n=>n!==i);save();el('checkProgress').textContent=state.checked.length+' / '+checks.length+' RECORDED'}))}
function makeQuery(){const explicit=state.ideaKeywords.split(',').map(s=>s.trim()).filter(Boolean);if(explicit.length)return explicit.slice(0,3).join(' ');const raw=(state.ideaProblem+' '+state.ideaSolution).toLowerCase().replace(/[^a-z0-9\s-]/g,' ');const stop=new Set('the and with that this from into will would your their there have using being which where they into over than then when more also very able need solve based platform system software startup users user data their these those across'.split(' '));const words=raw.split(/\s+/).filter(w=>w.length>3&&!stop.has(w));return [...new Set(words)].slice(0,5).join(' ')}
async function fetchJSON(url,timeout=10000){const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),timeout);try{const r=await fetch(url,{signal:ctrl.signal,headers:{Accept:'application/json'}});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(timer)}}
async function research(e){
  e.preventDefault();
  if(!el('idea-form').reportValidity()) return;
  const btn=el('analyzeBtn');
  btn.disabled=true;
  btn.textContent='Researching public sources…';
  el('run-state').textContent='RESEARCHING';
  try{
    const response=await fetch('/api/v1/research',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        ideaName:state.ideaName,
        ideaProblem:state.ideaProblem,
        ideaSolution:state.ideaSolution,
        ideaAudience:state.ideaAudience,
        ideaKeywords:state.ideaKeywords
      })
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error?.message||'Research request failed (HTTP '+response.status+').');
    state.papers=payload.papers||[];
    state.repos=payload.repos||[];
    state.sourceErrors=payload.sourceErrors||[];
    state.searchedAt=payload.retrievedAt;
    state.query=payload.query;
    save();
    renderResults();
  }catch(error){
    const message='Research API unavailable: '+(error?.message||'Network failure')+'. Start the Node server with npm run dev.';
    if(state.searchedAt){
      renderResults();
      el('source-status').classList.add('warning');
      el('source-status').textContent=message+' Previous results remain displayed.';
    }else{
      el('results').hidden=true;
      el('summary-empty').hidden=false;
      el('summary-empty').querySelector('p').textContent=message;
      el('run-state').textContent='UNAVAILABLE';
    }
  }finally{
    btn.disabled=false;
    btn.innerHTML='Run public research <span>↗</span>';
  }
}
function renderResults(){const done=!!state.searchedAt;el('summary-empty').hidden=done;el('results').hidden=!done;el('run-state').textContent=done?'LAST RUN '+new Date(state.searchedAt).toLocaleDateString():'NOT STARTED';if(!done)return;el('source-status').classList.toggle('warning',state.sourceErrors.length>0);el('source-status').textContent=state.sourceErrors.length?'Some sources unavailable: '+state.sourceErrors.join(' | ')+'. No matches in a failed source does not mean the idea is new.':'Public sources searched. Inspect each match before classifying feature overlap.';el('paperCount').textContent=state.papers.length;el('repoCount').textContent=state.repos.length;el('papersLabel').textContent='('+state.papers.length+')';el('reposLabel').textContent='('+state.repos.length+')';el('papers').innerHTML=state.papers.length?state.papers.map(x=>'<div class="hit"><a href="'+escapeHTML(safeUrl(x.url))+'" target="_blank" rel="noopener noreferrer">'+escapeHTML(x.title)+'</a><div class="meta">Publication '+escapeHTML(x.year||'year unknown')+' · '+escapeHTML(x.cited)+' citations in OpenAlex</div></div>').join(''):'<p class="result-disclaimer">No records returned (this is not evidence of novelty).</p>';el('repos').innerHTML=state.repos.length?state.repos.map(x=>'<div class="hit"><a href="'+escapeHTML(safeUrl(x.url))+'" target="_blank" rel="noopener noreferrer">'+escapeHTML(x.title)+'</a><div class="meta">'+escapeHTML(x.description)+' · '+escapeHTML(x.stars)+' stars</div></div>').join(''):'<p class="result-disclaimer">No records returned (this is not evidence of novelty).</p>';const q=encodeURIComponent(state.query||state.ideaName);el('patentLinks').innerHTML='<a rel="noopener noreferrer" target="_blank" href="https://patents.google.com/xhr/query?url='+encodeURIComponent('q='+state.query)+'">Google Patents structured search ↗</a><a rel="noopener noreferrer" target="_blank" href="https://patents.google.com/?q='+q+'">Google Patents browser search ↗</a><a rel="noopener noreferrer" target="_blank" href="https://ppubs.uspto.gov/pubwebapp/">USPTO Patent Public Search ↗</a>'}
function reportMD(){const lines=['# '+(state.ideaName||'Untitled startup')+' — Priorly evidence brief','', '**Generated:** '+new Date().toISOString(),'**Research run:** '+(state.searchedAt||'Not run'),'**Search keywords:** '+(state.query||'Not set'),'', '## Startup hypothesis','', '**Problem:** '+(state.ideaProblem||'Not provided'),'', '**Proposed solution:** '+(state.ideaSolution||'Not provided'),'', '**Target customer:** '+(state.ideaAudience||'Not provided'),'', '## Evidence — published research',''];if(!state.papers.length)lines.push('No verified records in this session. This does not prove novelty.');for(const x of state.papers)lines.push('- '+x.title+' ('+(x.year||'n.d.')+') — '+x.url);lines.push('','## Evidence — public repositories','');if(!state.repos.length)lines.push('No verified records in this session. This does not prove novelty.');for(const x of state.repos)lines.push('- '+x.title+' — '+x.url);lines.push('','## Retrieval limitations','',state.sourceErrors.length?state.sourceErrors.join('; '):'Search is limited to OpenAlex and GitHub query results. Coverage, recall and competitor feature parity have not been independently validated.','', '## Patent follow-up','', '- [Google Patents](https://patents.google.com/?q='+encodeURIComponent(state.query||state.ideaName)+')','- [USPTO Patent Public Search](https://ppubs.uspto.gov/pubwebapp/)','', '## IP ownership evidence (checked means reviewed, not cleared)','');checks.forEach(([a,b],i)=>lines.push('- ['+(state.checked.includes(i)?'x':' ')+'] '+a+' — '+b));lines.push('','### Founder notes','',state.ipNotes||'None provided','', '## Suggested next steps','', '1. Manually compare each closest competitor by feature and implementation.','2. Search patent claims and non-patent literature, including alternate terminology.','3. Obtain written IP assignments and confirm university/employer obligations.','4. Ask qualified IP counsel to review patent eligibility, prior art, ownership and freedom to operate separately.','5. Validate a customer problem and willingness to pay through interviews or pilots.','','---','Research organization only. Priorly does not determine legal ownership, patentability, non-infringement, or business viability.');return lines.join('\n')}
function download(name,type,content){const blob=new Blob([content],{type:type+';charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
function renderReport(){const h=escapeHTML;const list=(items,fmt)=>items.length?'<ul>'+items.map(fmt).join('')+'</ul>':'<p>Not researched. No conclusion can be drawn.</p>';el('reportPreview').innerHTML='<h2>'+h(state.ideaName||'Untitled startup')+' <span class="period">/</span> Evidence brief</h2><p class="report-meta">Generated '+h(new Date().toLocaleDateString())+' · Last researched '+h(state.searchedAt?new Date(state.searchedAt).toLocaleString():'never')+'</p><h3>01 / Your thesis</h3><p><strong>Problem</strong><br>'+h(state.ideaProblem||'Not provided')+'</p><p><strong>Proposed approach</strong><br>'+h(state.ideaSolution||'Not provided')+'</p><p><strong>Buyer</strong><br>'+h(state.ideaAudience||'Not provided')+'</p><h3>02 / Published research ('+state.papers.length+')</h3>'+list(state.papers,x=>'<li><a target="_blank" rel="noopener noreferrer" href="'+h(safeUrl(x.url))+'">'+h(x.title)+'</a> ('+h(x.year||'year unknown')+')</li>')+'<h3>03 / Open-source projects ('+state.repos.length+')</h3>'+list(state.repos,x=>'<li><a target="_blank" rel="noopener noreferrer" href="'+h(safeUrl(x.url))+'">'+h(x.title)+'</a></li>')+'<h3>04 / Ownership evidence</h3><p>'+state.checked.length+' of '+checks.length+' areas marked as reviewed; this does not establish legal ownership.</p><ul>'+checks.map(([label],i)=>'<li>'+(state.checked.includes(i)?'Reviewed: ':'To review: ')+h(label)+'</li>').join('')+'</ul><h3>05 / Notes & limitations</h3><p>'+h(state.ipNotes||'No notes supplied')+'</p><p><strong>Research limitations:</strong> '+h(state.sourceErrors.join('; ')||'Only OpenAlex and GitHub sources were queried. Patent claims, company websites and customer evidence require separate review.')+'</p><p><strong>No legal conclusion:</strong> A source match is not a patent claim chart; lack of matches is not proof of novelty; ownership and freedom to operate require competent legal review.</p>'}
bind();