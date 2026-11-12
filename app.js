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
const seed={ideaName:'',ideaProblem:'',ideaSolution:'',ideaAudience:'',ideaKeywords:'',ipNotes:'',checked:[],papers:[],repos:[],searchedAt:null,sourceErrors:[],query:'',reportRef:'',capabilityReviews:{}};
const classifications=[['insufficient-evidence','Insufficient evidence'],['known-overlap','Known overlap'],['potential-differentiation','Potential differentiation']];
const NOT_CHECKED=[
'Patent publications, patent families and claim text: no patent database connector is configured in this build. No patent search was run or recorded; the handoff links in the search tab open patent sources for a manual search.',
'Company and product web search: no web-search connector is configured. Competitor products and their features were not searched.',
'Trademark registers, recorded assignments and chain-of-title records: not searched.',
'Full-text claim charts and claim-by-claim comparison: not produced. Priorly does not compare claim language.',
'Alternate terminology, synonyms and non-English literature: one combined English query was used per run.',
'Results beyond the first 8 records per provider per query, and paywalled full texts: titles and metadata only were retrieved, and the full text was not reviewed.',
'Customer evidence, market size, pricing and willingness to pay: not researched.',
'Any human or counsel review of the sources: not recorded unless a reviewer has filled in the capability matrix and notes below.'
];
let state=load();
function load(){try{const data=JSON.parse(localStorage.getItem(KEY));return {...seed,...data,checked:Array.isArray(data?.checked)?data.checked:[],capabilityReviews:(data?.capabilityReviews&&typeof data.capabilityReviews==='object')?data.capabilityReviews:{}}}catch{return {...seed}}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}}
const el=id=>document.getElementById(id);
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeUrl(s){try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:'#'}catch{return '#'}}
function navigate(page){for(const t of document.querySelectorAll('.tab'))t.classList.toggle('active',t.id===page);for(const a of document.querySelectorAll('.nav-item')){a.classList.toggle('active',a.dataset.tab===page);a.setAttribute('aria-current',a.dataset.tab===page?'page':'false')}el('crumb').textContent=page.toUpperCase();location.hash=page;window.scrollTo({top:0,behavior:'instant'});if(page==='report')renderReport()}
function bind(){['ideaName','ideaProblem','ideaSolution','ideaAudience','ideaKeywords','ipNotes'].forEach(k=>{el(k).value=state[k]||'';el(k).addEventListener('input',e=>{state[k]=e.target.value;save()})});document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));document.querySelectorAll('.nav-item').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();navigate(a.dataset.tab)}));el('idea-form').addEventListener('submit',research);el('reset').onclick=()=>{if(confirm('Clear all locally saved Priorly concept, research and checklist data?')){state={...seed};save();location.reload()}};el('downloadMarkdown').onclick=()=>download('priorly-report.md','text/markdown',reportMD());el('downloadJSON').onclick=()=>download('priorly-report.json','application/json',JSON.stringify(state,null,2));el('printReport').onclick=()=>{renderReport();window.print()};el('reportPreview').addEventListener('change',e=>{const s=e.target.closest('[data-capability-classification]');if(!s)return;const c=s.dataset.capabilityClassification;state.capabilityReviews[c]={...review(c),classification:s.value};save();const out=s.parentElement.querySelector('.print-only');if(out)out.textContent=label(s.value)});el('reportPreview').addEventListener('input',e=>{const t=e.target.closest('[data-capability-note]');if(!t)return;const c=t.dataset.capabilityNote;state.capabilityReviews[c]={...review(c),note:t.value};save();const out=t.parentElement.querySelector('.print-only');if(out)out.textContent=t.value||'No reviewer note recorded'});drawChecks();renderResults();navigate(['overview','research','ownership','report'].includes(location.hash.slice(1))?location.hash.slice(1):'overview')}
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
function reportMD(){const lines=['# '+(state.ideaName||'Untitled matter')+' — Priorly preliminary landscape','', '**Report reference:** '+reportRef(),'**Generated:** '+new Date().toISOString(),'**Research run:** '+(state.searchedAt||'Not run'),'**Search keywords:** '+(state.query||'Not set'),'', '## Client intake','', '**Problem:** '+(state.ideaProblem||'Not provided'),'', '**Proposed approach:** '+(state.ideaSolution||'Not provided'),'', '**Intended customer:** '+(state.ideaAudience||'Not provided'),'', '## Capability matrix','', 'One combined query was used; sources are not attributed to individual capabilities in this build.','', '| Capability | Classification | Reviewer note |','| --- | --- | --- |'];for(const c of capabilities()){const r=review(c);lines.push('| '+c+' | '+label(r.classification)+' | '+(r.note||'No reviewer note recorded')+' |')}lines.push('','## Sources retrieved ('+(state.papers.length+state.repos.length)+')','');if(!state.papers.length&&!state.repos.length)lines.push('No records returned in this run. This is not evidence of novelty.');for(const x of state.papers)lines.push('- ['+x.title+']('+x.url+') — '+x.url+'\n  - Type: Research publication · Venue: '+(x.venue||'Not recorded in retrieved metadata')+' · Date: '+(x.year||'Year not recorded')+' · Retrieved: '+(x.retrievedAt||state.searchedAt||'not recorded'));for(const x of state.repos)lines.push('- ['+x.title+']('+x.url+') — '+x.url+'\n  - Type: Software repository · Venue: GitHub · Date: '+(x.created||'Creation date not retrieved')+' · Retrieved: '+(x.retrievedAt||state.searchedAt||'not recorded'));lines.push('','## What we did not check','');for(const item of NOT_CHECKED)lines.push('- '+item);if(state.sourceErrors.length)lines.push('- Provider errors in this run: '+state.sourceErrors.join('; '));lines.push('','## IP and ownership document checklist','','Requires qualified legal review. Priorly does not determine ownership, inventorship or chain of title.','');checks.forEach(([a,b],i)=>lines.push('- ['+(state.checked.includes(i)?'x':' ')+'] '+a+' — '+b));lines.push('','**Documents counsel will need:** '+DOCUMENTS.join('; '),'','### Reviewer notes','',state.ipNotes||'None provided','','---','Preliminary research, not legal advice. Priorly does not provide an opinion on patentability, freedom to operate or ownership. A source match is not a claim chart, and no match is not proof of novelty.');return lines.join('\n')}
function download(name,type,content){const blob=new Blob([content],{type:type+';charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
const DOCUMENTS=['Founder, employee and contractor IP assignment agreements','Employment and consulting agreements with IP, confidentiality and non-compete clauses','University or sponsor IP policy and any sponsored-research terms','Open-source dependency and licence inventory','Invention disclosure records and their dates','Third-party data, API and model terms','Any earlier patent applications or provisional filings'];
function reportRef(){if(!state.reportRef){state.reportRef='PRL-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+Math.random().toString(36).slice(2,6).toUpperCase();save()}return state.reportRef}
function capabilities(){const named=String(state.ideaKeywords||'').split(',').map(s=>s.trim()).filter(Boolean);return named.length?named:['Whole workflow as described in the intake']}
function review(capability){const r=state.capabilityReviews[capability];return {classification:r?.classification||'insufficient-evidence',note:r?.note||''}}
function label(value){return (classifications.find(c=>c[0]===value)||classifications[0])[1]}
function fmtStamp(value,withTime){if(!value)return 'Not recorded';const d=new Date(value);return Number.isNaN(d.getTime())?'Not recorded':(withTime?d.toLocaleString():d.toLocaleDateString())}
function renderReport(){
  const h=escapeHTML,ref=reportRef();
  const caps=capabilities();
  const rows=caps.map(c=>{
    const r=review(c);
    return '<tr><td>'+h(c)+'</td><td><select class="screen-only" data-capability-classification="'+h(c)+'" aria-label="Classification for '+h(c)+'">'+classifications.map(([v,t])=>'<option value="'+v+'" '+(r.classification===v?'selected':'')+'>'+h(t)+'</option>').join('')+'</select><span class="print-only">'+h(label(r.classification))+'</span></td><td><textarea class="screen-only" rows="2" maxlength="600" data-capability-note="'+h(c)+'" placeholder="Reviewer note…">'+h(r.note)+'</textarea><span class="print-only">'+h(r.note||'No reviewer note recorded')+'</span></td></tr>';
  }).join('');
  const sourceRow=(x,type,venue,date)=>'<tr><td>'+h(x.title)+'</td><td>'+h(type)+'</td><td>'+h(venue)+'</td><td>'+h(date)+'</td><td>'+h(fmtStamp(x.retrievedAt||state.searchedAt))+'</td><td class="url-cell"><a href="'+h(safeUrl(x.url))+'" target="_blank" rel="noopener noreferrer">'+h(safeUrl(x.url))+'</a></td></tr>';
  const sourceRows=state.papers.map(x=>sourceRow(x,'Research publication',x.venue||'Venue not recorded in retrieved metadata',x.year?String(x.year):'Year not recorded')).join('')+state.repos.map(x=>sourceRow(x,'Software repository','GitHub',x.created||'Creation date not retrieved')).join('');
  const total=state.papers.length+state.repos.length;
  el('reportPreview').innerHTML=
  '<header class="doc-head"><div class="doc-kicker">PRIORLY · PRELIMINARY RESEARCH FILE</div><h2>'+h(state.ideaName||'Untitled matter')+' <span class="period">/</span> Landscape brief</h2><dl class="doc-meta"><div><dt>Report reference</dt><dd>'+h(ref)+'</dd></div><div><dt>Generated</dt><dd>'+h(fmtStamp(new Date().toISOString(),true))+'</dd></div><div><dt>Last research run</dt><dd>'+h(fmtStamp(state.searchedAt,true))+'</dd></div><div><dt>Providers queried</dt><dd>OpenAlex, GitHub</dd></div></dl><p class="doc-note">This preview stores the report in this browser only; the reference above is a local record, not a server record ID.</p></header>'+
  '<h3>01 / Client intake</h3><dl class="doc-fields"><div><dt>Problem</dt><dd>'+h(state.ideaProblem||'Not provided')+'</dd></div><div><dt>Proposed approach</dt><dd>'+h(state.ideaSolution||'Not provided')+'</dd></div><div><dt>Intended customer</dt><dd>'+h(state.ideaAudience||'Not provided')+'</dd></div><div><dt>Capabilities / search terms</dt><dd>'+h(state.ideaKeywords||'Not provided')+'</dd></div></dl>'+
  '<h3>02 / Capability matrix</h3><p class="doc-note">Every capability was searched with one combined query ('+h(state.query||'not recorded')+'). Individual sources are not attributed to individual capabilities in this build; that attribution is the reviewer\'s work. “Insufficient evidence” is the default and is not a finding.</p><table class="matrix"><thead><tr><th scope="col">Capability</th><th scope="col">Classification</th><th scope="col">Reviewer note</th></tr></thead><tbody>'+rows+'</tbody></table>'+
  '<h3>03 / Sources retrieved ('+total+')</h3><p class="doc-note">Listed as returned by the providers. Priorly has not verified the content of these sources; open each URL and check the date before relying on it.</p>'+(total?'<table class="sources"><thead><tr><th scope="col">Title</th><th scope="col">Type</th><th scope="col">Venue</th><th scope="col">Date</th><th scope="col">Retrieved</th><th scope="col">URL</th></tr></thead><tbody>'+sourceRows+'</tbody></table>':'<p>No records were returned in this run. That is not evidence of novelty.</p>')+
  '<h3>04 / What we did not check</h3><ul class="not-checked">'+NOT_CHECKED.map(item=>'<li>'+h(item)+'</li>').join('')+(state.sourceErrors.length?'<li><strong>Provider errors in this run:</strong> '+h(state.sourceErrors.join('; '))+'</li>':'')+'</ul>'+
  '<h3>05 / IP and ownership document checklist</h3><p class="legal-review"><strong>Requires qualified legal review.</strong> Priorly does not determine ownership, inventorship or chain of title. A recorded document means it was received and considered, not that a risk is cleared.</p><ul class="checklist-print">'+checks.map(([name],i)=>'<li><span class="tick">'+(state.checked.includes(i)?'[received]':'[outstanding]')+'</span> '+h(name)+'</li>').join('')+'</ul><p><strong>Documents counsel will need:</strong></p><ul class="documents">'+DOCUMENTS.map(d=>'<li>'+h(d)+'</li>').join('')+'</ul><p><strong>Reviewer notes</strong><br>'+h(state.ipNotes||'None recorded')+'</p>'+
  '<h3>06 / Disclaimer</h3><p class="disclaimer-print">Preliminary research, not legal advice. Priorly does not provide an opinion on patentability, freedom to operate or ownership. A source match is not a patent claim chart; the absence of a match is not proof of novelty. Qualified counsel must review every finding.</p>';
}
bind();