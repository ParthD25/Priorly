import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, AppError } from "../server/storage.mjs";
import { createApp } from "../server/app.mjs";

const concept={title:"Aquatic compliance assistant",problem:"Aquatic teams struggle with shift coverage.",solution:"Use qualification-aware scheduling evidence and reviews.",audience:"Pool operators",keywords:"aquatic staffing compliance"};
const result={query:"aquatic staffing compliance",retrievedAt:"2026-11-02T12:00:00Z",sourceErrors:[],sourceStatus:{OpenAlex:"ok",GitHub:"ok"},
  papers:[{id:"https://openalex.org/W123",title:"Some research",source:"OpenAlex",retrievedAt:"2026-11-02T12:00:00Z",url:"https://openalex.org/W123"}],
  repos:[{id:"test/repo",title:"test/repo",source:"GitHub",retrievedAt:"2026-11-02T12:00:00Z",url:"https://github.com/test/repo"}]};

test("passwords, sessions, persistence and per-user evidence isolation",()=>{
  const root=mkdtempSync(join(tmpdir(),"priorly-test-"));
  const path=join(root,"workspace.sqlite");
  try{
    let db=createStore({path});
    const a=db.signUp(" Founder@Example.com ","very-secure-password"),b=db.signUp("other@example.com","another-strong-password");
    assert.equal(a.user.email,"founder@example.com");
    assert.equal(db.userForToken(a.token).id,a.user.id);
    assert.throws(()=>db.signUp("founder@example.com","very-secure-password"),e=>e instanceof AppError&&e.status===409);
    assert.throws(()=>db.signIn("founder@example.com","bad password"),e=>e.status===401);
    assert.ok(db.signIn("founder@example.com","very-secure-password").token);
    const p=db.createProject(a.user.id,concept);
    assert.equal(db.listProjects(a.user.id).length,1);
    assert.equal(db.listProjects(b.user.id).length,0);
    assert.throws(()=>db.getProject(b.user.id,p.id),e=>e.status===404);
    assert.throws(()=>db.updateProject(b.user.id,p.id,{...concept,title:"Stolen"}),e=>e.status===404);
    assert.throws(()=>db.deleteProject(b.user.id,p.id),e=>e.status===404);
    db.storeRun(a.user.id,p.id,result);
    assert.equal(db.listRuns(a.user.id,p.id).length,1);
    assert.equal(db.listEvidence(a.user.id,p.id).length,2);
    assert.throws(()=>db.listEvidence(b.user.id,p.id),e=>e.status===404);
    const ev=db.listEvidence(a.user.id,p.id)[0];
    db.classifyEvidence(a.user.id,p.id,ev.id,{classification:"overlap",note:"Verified with source"});
    db.storeRun(a.user.id,p.id,result);
    assert.equal(db.listEvidence(a.user.id,p.id).length,2);
    assert.equal(db.listEvidence(a.user.id,p.id).find(x=>x.id===ev.id).classification,"overlap");
    db.db.close();
    db=createStore({path});
    assert.equal(db.listRuns(a.user.id,p.id).length,2);
    assert.equal(db.listEvidence(a.user.id,p.id).find(x=>x.id===ev.id).note,"Verified with source");
    db.signOut(a.token);
    assert.equal(db.userForToken(a.token),null);
    db.deleteProject(a.user.id,p.id);
    assert.equal(db.listProjects(a.user.id).length,0);
    db.db.close();
  }finally{rmSync(root,{recursive:true,force:true})}
});
test("sessions expire and reviewer inputs are validated",()=>{
  let now=1000000;
  const db=createStore({path:":memory:",now:()=>now});
  try{
    assert.throws(()=>db.signUp("bad","123456789012"),/valid email/);
    assert.throws(()=>db.signUp("ok@example.org","tiny"),/12/);
    const a=db.signUp("ok@example.org","strong-password-123");
    assert.ok(db.userForToken(a.token));
    const p=db.createProject(a.user.id,concept);
    db.storeRun(a.user.id,p.id,result);
    const ev=db.listEvidence(a.user.id,p.id)[0];
    assert.throws(()=>db.classifyEvidence(a.user.id,p.id,ev.id,{classification:"patent-approved"}),/Invalid/);
    assert.throws(()=>db.classifyEvidence(a.user.id,p.id,ev.id,{classification:"overlap",note:"x".repeat(2000)}),/exceeds/);
    now+=8*24*60*60*1000;
    assert.equal(db.userForToken(a.token),null);
  }finally{db.db.close()}
});
test("HTTP registration, authentication, source review and cross-account denials",async t=>{
  const store=createStore({path:":memory:"});
  const server=createApp({store,service:async()=>result});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.db.close()});
  const base="http://127.0.0.1:"+server.address().port;
  async function request(path,method="GET",body,cookie="",headers={}){
    const res=await fetch(base+path,{method,headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:res.status,data:await res.json(),cookie:res.headers.get("set-cookie")};
  }
  let r=await request("/api/v1/projects");assert.equal(r.status,401);
  r=await request("/api/v1/auth/register","POST",{email:"a@example.org",password:"valid-password-123"});
  assert.equal(r.status,200);assert.match(r.cookie,/HttpOnly/);assert.match(r.cookie,/SameSite=Strict/);
  const a=r.cookie.split(";")[0];
  r=await request("/api/v1/auth/register","POST",{email:"b@example.org",password:"another-pass-1234"});
  const b=r.cookie.split(";")[0];
  r=await request("/api/v1/projects","POST",concept,a);assert.equal(r.status,201);
  const id=r.data.project.id;
  assert.equal((await request("/api/v1/projects/"+id,"GET",undefined,b)).status,404);
  assert.equal((await request("/api/v1/projects/"+id+"/research","POST",{},b)).status,404);
  r=await request("/api/v1/projects/"+id+"/research","POST",{},a);assert.equal(r.status,201);
  const ev=await request("/api/v1/projects/"+id+"/evidence","GET",undefined,a);
  assert.equal(ev.data.evidence.length,2);
  const evId=ev.data.evidence[0].id;
  assert.equal((await request("/api/v1/projects/"+id+"/evidence/"+evId,"PATCH",{classification:"overlap",note:"No"},b)).status,404);
  r=await request("/api/v1/projects/"+id+"/evidence/"+evId,"PATCH",{classification:"overlap",note:"Compared"},a);
  assert.equal(r.status,200);assert.equal(r.data.evidence.classification,"overlap");
  r=await request("/api/v1/projects/"+id,"PUT",{...concept,title:"Updated title"},a);
  assert.equal(r.data.project.title,"Updated title");
  assert.equal((await request("/api/v1/projects","POST",concept,a,{Origin:"https://evil.example"})).status,403);
  r=await request("/api/v1/auth/logout","POST",{},a);
  assert.match(r.cookie,/Max-Age=0/);
  assert.equal((await request("/api/v1/projects","GET",undefined,a)).status,401);
  assert.equal((await request("/api/v1/projects/"+id,"DELETE",{},b)).status,404);
});