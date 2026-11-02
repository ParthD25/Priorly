import test from "node:test";
import assert from "node:assert/strict";
import { createStore, AppError } from "../server/storage.mjs";
import { createApp } from "../server/app.mjs";

const hypothesis={title:"Novel aquatics workflow",problem:"Coverage failures cause safety risk",solution:"Check certifications before requesting coverage",audience:"Pool managers",keywords:"certification scheduling"};

test("technical claims and source mappings enforce project identity",()=>{
  const s=createStore({path:":memory:"});
  try{
    const a=s.signUp("a@example.org","very-long-passphrase-a").user;
    const b=s.signUp("b@example.org","very-long-passphrase-b").user;
    const project=s.createProject(a.id,hypothesis);
    const others=s.createProject(b.id,hypothesis);
    const src=s.importEvidence(a.id,project.id,{source:"Patent publication",title:"Example published patent",url:"https://patents.google.com/patent/US1234567A/en"});
    assert.equal(src.classification,"unreviewed");
    assert.match(src.note,/not independently verified/);
    assert.throws(()=>s.importEvidence(a.id,project.id,{source:"Patent publication",title:"Duplicate patent",url:src.url}),e=>e.status===409);
    assert.throws(()=>s.importEvidence(a.id,project.id,{source:"Patent publication",title:"Bad source",url:"javascript:alert(1)"}),/HTTPS/);
    const c=s.createClaim(a.id,project.id,{description:"Specific certification-aware shift matching",mechanism:"A constraint-checking scheduling engine"});
    assert.equal(s.listClaims(a.id,project.id).length,1);
    assert.throws(()=>s.listClaims(b.id,project.id),e=>e.status===404);
    assert.throws(()=>s.createClaim(b.id,project.id,{description:"Cannot create here"}),e=>e.status===404);
    assert.throws(()=>s.linkClaimSource(b.id,project.id,c.id,{evidenceId:src.id,relation:"overlap"}),e=>e.status===404);
    assert.throws(()=>s.linkClaimSource(a.id,project.id,c.id,{evidenceId:src.id,relation:"patentable"}),/Invalid/);
    const link=s.linkClaimSource(a.id,project.id,c.id,{evidenceId:src.id,relation:"overlap",sourceExcerpt:"Source excerpt",rationale:"Same constraints"});
    assert.equal(link.relation,"overlap");
    s.linkClaimSource(a.id,project.id,c.id,{evidenceId:src.id,relation:"possible-difference",sourceExcerpt:"New excerpt",rationale:"More detailed distinction"});
    assert.equal(s.listClaimLinks(a.id,project.id,c.id).length,1);
    assert.equal(s.listClaimLinks(a.id,project.id,c.id)[0].relation,"possible-difference");
    assert.throws(()=>s.linkClaimSource(b.id,others.id,c.id,{evidenceId:src.id,relation:"uncertain"}),e=>e.status===404);
    const otherSource=s.importEvidence(b.id,others.id,{source:"Other documentation",title:"Other company source",url:"https://example.org/doc"});
    assert.throws(()=>s.linkClaimSource(a.id,project.id,c.id,{evidenceId:otherSource.id,relation:"uncertain"}),e=>e.status===404);
    s.updateClaim(a.id,project.id,c.id,{description:"Revised technical claim with a mechanism",mechanism:"New algorithm"});
    assert.equal(s.listClaims(a.id,project.id)[0].description,"Revised technical claim with a mechanism");
    s.unlinkClaimSource(a.id,project.id,c.id,src.id);
    assert.equal(s.listClaimLinks(a.id,project.id,c.id).length,0);
    assert.throws(()=>s.unlinkClaimSource(a.id,project.id,c.id,src.id),e=>e.status===404);
    s.deleteClaim(a.id,project.id,c.id);
    assert.equal(s.listClaims(a.id,project.id).length,0);
  }finally{s.db.close()}
});

test("HTTP claim-evidence flow and cross-user authorization",async t=>{
  const store=createStore({path:":memory:"});
  const srv=createApp({store,service:async()=>({query:"q",papers:[],repos:[],sourceErrors:[],sourceStatus:{}})});
  await new Promise(r=>srv.listen(0,"127.0.0.1",r));
  t.after(async()=>{await new Promise(r=>srv.close(r));store.db.close()});
  const base="http://127.0.0.1:"+srv.address().port;
  async function call(path,method="GET",body,cookie){
    const response=await fetch(base+path,{method,headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),cookie:response.headers.get("set-cookie")};
  }
  let res=await call("/api/v1/auth/register","POST",{email:"founder@example.org",password:"founder-password-xyz"});
  const a=res.cookie.split(";")[0];
  res=await call("/api/v1/auth/register","POST",{email:"other@example.org",password:"other-password-xyz"});
  const b=res.cookie.split(";")[0];
  res=await call("/api/v1/projects","POST",hypothesis,a);const id=res.data.project.id;
  res=await call("/api/v1/projects/"+id+"/evidence","POST",{source:"Company documentation",title:"Competitor documentation",url:"https://example.com/features"},a);
  assert.equal(res.status,201);const evidenceId=res.data.evidence.id;
  res=await call("/api/v1/projects/"+id+"/claims","POST",{description:"Staff optimization with certification constraints",mechanism:"Specific validation model"},a);
  assert.equal(res.status,201);const claimId=res.data.claim.id;
  assert.equal((await call("/api/v1/projects/"+id+"/claims","GET",undefined,b)).status,404);
  assert.equal((await call("/api/v1/projects/"+id+"/evidence","POST",{source:"Other documentation",title:"Intrusion attempt",url:"https://example.com"},b)).status,404);
  res=await call("/api/v1/projects/"+id+"/claims/"+claimId+"/sources","POST",{evidenceId,relation:"uncertain",sourceExcerpt:"A public description",rationale:"Scope unclear"},a);
  assert.equal(res.status,201);
  res=await call("/api/v1/projects/"+id+"/claims","GET",undefined,a);
  assert.equal(res.data.claims[0].links.length,1);
  assert.equal((await call("/api/v1/projects/"+id+"/claims/"+claimId+"/sources/"+evidenceId,"DELETE",{},b)).status,404);
  assert.equal((await call("/api/v1/projects/"+id+"/claims/"+claimId+"/sources/"+evidenceId,"DELETE",{},a)).status,200);
  assert.equal((await call("/api/v1/projects/"+id+"/claims/"+claimId,"DELETE",{},a)).status,200);
  assert.equal((await call("/api/v1/projects/"+id+"/claims","GET",undefined,a)).data.claims.length,0);
});
