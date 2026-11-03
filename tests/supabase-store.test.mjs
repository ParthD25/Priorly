import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStore } from "../server/supabase-store.mjs";
import { createApp } from "../server/app.mjs";

const UUID="11111111-1111-4111-8111-111111111111";
const PROJECT="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVIDENCE="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CLAIM="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const json = (obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{"Content-Type":"application/json"}});
const p={id:PROJECT,title:"Priorly example",problem:"A meaningful specific problem",solution:"An evidence-backed workflow",audience:"Studio",keywords:"patent search",
created_at:"2026-11-02T00:00:00Z",updated_at:"2026-11-02T00:00:00Z"};
const e={id:EVIDENCE,source:"OpenAlex",source_id:"W1",title:"Research paper",url:"https://openalex.org/W1",
classification:"unreviewed",note:"",retrieved_at:"2026-11-02T00:00:00Z",updated_at:"2026-11-02T00:00:00Z"};
const c={id:CLAIM,description:"Novel technical matching procedure",mechanism:"A real algorithm",created_at:"2026-11-02T00:00:00Z",updated_at:"2026-11-02T00:00:00Z"};

function fixture(){
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    const u=new URL(url);
    calls.push({path:u.pathname,query:u.search,auth:opts.headers.Authorization,key:opts.headers.apikey,method:opts.method,body:opts.body?JSON.parse(opts.body):null});
    if(u.pathname==="/auth/v1/signup")return json({user:{id:UUID,email:"a@example.com"},access_token:null},200);
    if(u.pathname==="/auth/v1/token"){
      if(u.searchParams.get("grant_type")==="password")
        return json({user:{id:UUID,email:"a@example.com"},access_token:"access-a",refresh_token:"refresh-a"});
      return json({access_token:"access-b",refresh_token:"refresh-b"});
    }
    if(u.pathname==="/auth/v1/user")
      return opts.headers.Authorization==="Bearer access-a"||opts.headers.Authorization==="Bearer access-b"?
        json({id:UUID,email:"a@example.com"}):json({message:"invalid JWT"},401);
    if(u.pathname==="/auth/v1/logout")return json({});
    const table=u.pathname.split("/").pop();
    if(table==="priorly_projects"){
      if(opts.method==="GET")return json([p]);
      if(opts.method==="POST")return json([p],201);
      if(opts.method==="PATCH")return json([{...p,title:opts.body?JSON.parse(opts.body).title:p.title}]);
      if(opts.method==="DELETE")return new Response(null,{status:204});
    }
    if(table==="priorly_research_runs"){
      if(opts.method==="GET")return json([]);
      if(opts.method==="POST")return json([{id:OTHER,created_at:"2026-11-02T00:00:00Z"}],201);
    }
    if(table==="priorly_evidence"){
      if(opts.method==="GET")return json([e]);
      if(opts.method==="PATCH")return json([{...e,classification:JSON.parse(opts.body).classification}]);
      if(opts.method==="POST")return u.searchParams.has("on_conflict")?new Response(null,{status:204}):json([e],201);
    }
    if(table==="priorly_claims"){
      if(opts.method==="GET")return json([c]);
      if(opts.method==="POST")return json([c],201);
      if(opts.method==="PATCH")return json([c]);
      if(opts.method==="DELETE")return new Response(null,{status:204});
    }
    if(table==="priorly_claim_sources"){
      if(opts.method==="GET")return json([{claim_id:CLAIM,evidence_id:EVIDENCE,project_id:PROJECT,
        relation:"overlap",source_excerpt:"Relevant disclosed feature",rationale:"Relevant mechanism",updated_at:"2026-11-02T00:00:00Z"}]);
      if(opts.method==="POST")return json([{claim_id:CLAIM,evidence_id:EVIDENCE}],201);
      if(opts.method==="DELETE")return json([{claim_id:CLAIM,evidence_id:EVIDENCE}]);
    }
    throw Error("unhandled mock URL "+url);
  };
  const store=createSupabaseStore({url:"https://priorlytest.supabase.co",key:"sb_publishable_test",fetchImpl});
  return {store,calls};
}
test("shared Prysm Supabase requires opt-in and disables registration, while allowing existing login",async()=>{
  const original=process.env.PRIORLY_USE_SHARED_SUPABASE;
  delete process.env.PRIORLY_USE_SHARED_SUPABASE;
  try {
    assert.throws(()=>createSupabaseStore({
      url:"https://dpcpbebiylwozvkjubeq.supabase.co",key:"sb_publishable_test"}),/explicit local opt-in/);
    process.env.PRIORLY_USE_SHARED_SUPABASE="true";
    const calls=[];
    const shared=createSupabaseStore({
      url:"https://dpcpbebiylwozvkjubeq.supabase.co",
      key:"sb_publishable_test",
      fetchImpl:async(url,opts)=>{
        calls.push({url,method:opts.method});
        if(url.includes("/auth/v1/token?grant_type=password"))return json({
          user:{id:UUID,email:"existing@example.com"},access_token:"access-a",refresh_token:"refresh-a"
        });
        throw Error("Only existing-account login should be attempted");
      }
    });
    assert.equal(shared.sharedAuth,true);
    assert.equal(shared.canRegister,false);
    await assert.rejects(shared.signUp("new@example.com","very-long-password"),e=>e.status===403 && e.code==="REGISTRATION_DISABLED");
    const existing=await shared.signIn("existing@example.com","very-long-password");
    assert.equal(existing.user.email,"existing@example.com");
    assert.equal(calls.length,1);
    const server=createApp({store:shared,service:async()=>({papers:[],repos:[]})});
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    try {
      const root="http://127.0.0.1:"+server.address().port;
      const cfg=await fetch(root+"/api/v1/config");
      assert.deepEqual(await cfg.json(),{backend:"supabase",sharedAuth:true,registrationEnabled:false});
      const reg=await fetch(root+"/api/v1/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:"new@example.com",password:"very-long-password"})});
      assert.equal(reg.status,403);
    }finally {await new Promise(resolve=>server.close(resolve));}
  }finally {
    if(original===undefined)delete process.env.PRIORLY_USE_SHARED_SUPABASE;
    else process.env.PRIORLY_USE_SHARED_SUPABASE=original;
  }
});
test("Supabase auth delegates password storage, supports verification, verifies users and refreshes",async()=>{
  const {store,calls}=fixture();
  const pending=await store.signUp("a@example.com","very-long-password");
  assert.equal(pending.verificationRequired,true);
  const logged=await store.signIn("a@example.com","very-long-password");
  assert.equal(logged.user.id,UUID);
  assert.equal(logged.token,"access-a");
  assert.deepEqual(await store.getUser("bad-token"),null);
  assert.equal((await store.getUser("access-a")).id,UUID);
  assert.equal((await store.refreshSession("refresh-a")).token,"access-b");
  await store.signOut("access-a");
  assert.ok(calls.every(x=>x.key==="sb_publishable_test"));
  assert.ok(!calls.some(x=>x.auth==="Bearer service_role"));
});
test("project CRUD and claim evidence queries carry caller JWT; database RLS remains authoritative",async()=>{
  const {store,calls}=fixture(),db=store.forToken("access-a");
  assert.equal((await db.listProjects(UUID))[0].id,PROJECT);
  assert.equal((await db.getProject(UUID,PROJECT)).title,"Priorly example");
  assert.equal((await db.createProject(UUID,{title:"My startup"})).id,PROJECT);
  assert.equal((await db.updateProject(UUID,PROJECT,{title:"Updated company"})).title,"Updated company");
  const evidence=await db.listEvidence(UUID,PROJECT);
  assert.equal(evidence[0].id,EVIDENCE);
  assert.equal((await db.classifyEvidence(UUID,PROJECT,EVIDENCE,{classification:"overlap",note:"Compared"})).classification,"overlap");
  assert.equal((await db.importEvidence(UUID,PROJECT,{source:"Patent publication",title:"Patent document",url:"https://patents.google.com/patent/US1234567A"})).id,EVIDENCE);
  const claims=await db.listClaims(UUID,PROJECT);
  assert.equal(claims[0].links[0].evidenceId,EVIDENCE);
  const link=await db.linkClaimSource(UUID,PROJECT,CLAIM,{evidenceId:EVIDENCE,relation:"overlap",rationale:"Compared"});
  assert.equal(link.relation,"overlap");
  await db.unlinkClaimSource(UUID,PROJECT,CLAIM,EVIDENCE);
  const run={papers:[{id:"W1",title:"Research",url:"https://openalex.org/W1",source:"OpenAlex"}],repos:[]};
  const stored=await db.storeRun(UUID,PROJECT,run);
  assert.equal(stored.id,OTHER);
  await db.deleteProject(UUID,PROJECT);
  assert.ok(calls.filter(x=>x.path.startsWith("/rest/v1/")).every(x=>x.auth==="Bearer access-a"),"Every DB request must carry the user's JWT.");
  assert.ok(calls.filter(x=>x.path==="/rest/v1/priorly_projects"&&x.method==="GET").every(x=>x.query.includes("owner_id=eq.")), "Project lookups are owner-scoped.");
  assert.ok(!calls.some(x=>x.key?.includes("service_role")));
});
test("invalid ids and reviewer assignments cannot reach the database",async()=>{
  const {store,calls}=fixture(),db=store.forToken("access-a");
  await assert.rejects(db.getProject(UUID,"../../admin"),/Not found/);
  await assert.rejects(db.createProject(UUID,{title:"x"}),/Text length/);
  await assert.rejects(db.classifyEvidence(UUID,PROJECT,EVIDENCE,{classification:"patented"}),/Invalid review/);
  await assert.rejects(db.importEvidence(UUID,PROJECT,{source:"Patent publication",title:"invalid link",url:"javascript:alert(1)"}),/HTTPS/);
  const hit=calls.filter(x=>x.path.startsWith("/rest/v1/"));
  assert.ok(hit.every(x=>x.auth==="Bearer access-a"));
});
test("managed session HTTP routes return verification pending and HttpOnly cookie pairs",async t=>{
  const {store}=fixture();
  const server=createApp({store,service:async()=>({papers:[],repos:[],query:"q"})});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin="http://127.0.0.1:"+server.address().port;
  const post=async(path,body)=>{
    const res=await fetch(origin+path,{method:"POST",headers:{"Content-Type":"application/json","Origin":origin},body:JSON.stringify(body)});
    return {status:res.status,data:await res.json(),cookies:res.headers.getSetCookie()};
  };
  let r=await post("/api/v1/auth/register",{email:"a@example.com",password:"secure-long-password"});
  assert.equal(r.status,202);assert.equal(r.data.verificationRequired,true);
  r=await post("/api/v1/auth/login",{email:"a@example.com",password:"secure-long-password"});
  assert.equal(r.status,200);
  assert.equal(r.cookies.length,2);
  assert.ok(r.cookies.every(x=>/HttpOnly/.test(x)&&/SameSite=Strict/.test(x)));
  const pair=r.cookies.map(x=>x.split(";")[0]).join("; ");
  const me=await fetch(origin+"/api/v1/auth/me",{headers:{Cookie:pair}});
  assert.equal(me.status,200);
  assert.equal((await me.json()).user.id,UUID);
});
