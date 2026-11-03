// Managed Supabase Auth + PostgREST adapter. All rows are accessed with the
// end user's verified bearer token; no service_role credentials are used.
// Do not point this at another product's Auth instance in production.
import { AppError } from "./storage.mjs";

function fail(status, code, message) { return new AppError(status, code, message); }
function text(value, max, min=0) {
  if (typeof value !== "string") throw fail(400,"INVALID_INPUT","Expected text.");
  const s=value.trim();
  if (s.length<min || s.length>max) throw fail(400,"INVALID_INPUT","Text length must be "+min+"–"+max+".");
  return s;
}
function projectFields(payload) {
  if (!payload || typeof payload!=="object" || Array.isArray(payload)) throw fail(400,"INVALID_INPUT","Expected project.");
  return {
    title:text(payload.title,90,2),
    problem:text(payload.problem||"",1800),
    solution:text(payload.solution||"",2400),
    audience:text(payload.audience||"",180),
    keywords:text(payload.keywords||"",300)
  };
}
function claimFields(payload) {
  if (!payload || typeof payload!=="object") throw fail(400,"INVALID_INPUT","Expected claim.");
  return {description:text(payload.description,350,10), mechanism:text(payload.mechanism||"",1800)};
}
function toProject(row) {
  return {id:row.id,title:row.title,problem:row.problem,solution:row.solution,audience:row.audience,
    keywords:row.keywords,createdAt:row.created_at,updatedAt:row.updated_at};
}
function toEvidence(row) {
  return {id:row.id,source:row.source,sourceId:row.source_id,title:row.title,url:row.url,
    classification:row.classification,note:row.note,retrievedAt:row.retrieved_at,updatedAt:row.updated_at};
}
function toLink(row) {
  return {evidenceId:row.evidence_id,relation:row.relation,sourceExcerpt:row.source_excerpt,
    rationale:row.rationale,updatedAt:row.updated_at,title:row.title,url:row.url,source:row.source};
}
function toClaim(row,links=[]) {
  return {id:row.id,description:row.description,mechanism:row.mechanism,createdAt:row.created_at,
    updatedAt:row.updated_at,links};
}
function validateId(id) {
  if(typeof id!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw fail(404,"NOT_FOUND","Not found.");
  return id;
}
function validateEmail(value) {
  const email=text(value,254,5).toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw fail(400,"INVALID_INPUT","Enter a valid email.");
  return email;
}
function validatePassword(value) {
  if(typeof value!=="string"||value.length<12||value.length>128)
    throw fail(400,"INVALID_INPUT","Password must be 12–128 characters.");
  return value;
}
const RELATIONS=new Set(["overlap","possible-difference","background","uncertain"]);
const CLASSES=new Set(["unreviewed","overlap","differentiated","irrelevant","needs-review"]);
const SOURCES=new Set(["Patent publication","Company documentation","Research publication","Other documentation"]);
const errText=(obj)=>String(obj?.message||obj?.msg||obj?.error_description||"").slice(0,200);

export function createSupabaseStore({
  url=process.env.SUPABASE_URL, key=process.env.SUPABASE_PUBLISHABLE_KEY,
  fetchImpl=fetch, timeoutMs=10000
}={}) {
  let base;
  try {base=new URL(url);if(base.protocol!=="https:"||!base.hostname.endsWith(".supabase.co"))throw Error();}
  catch {throw new Error("SUPABASE_URL must be a valid https://<project>.supabase.co URL.");}
  if(!key||typeof key!=="string")throw new Error("SUPABASE_PUBLISHABLE_KEY is required.");
  // Prysm's auth.users trigger creates Prysm user_profiles. Keep Priorly login/
  // registration disabled against this shared staging project.
  if(base.hostname==="dpcpbebiylwozvkjubeq.supabase.co") {
    throw new Error("Prysm Style is for Priorly schema staging ONLY. Its shared Auth trigger must not be used for Priorly accounts.");
  }
  const origin=base.origin;
  const standardHeaders={"apikey":key,"Accept":"application/json"};

  async function request(path,{method="GET",token,body,prefer}={}) {
    const headers={...standardHeaders};
    if(token)headers.Authorization="Bearer "+token;
    if(body!==undefined)headers["Content-Type"]="application/json";
    if(prefer)headers.Prefer=prefer;
    let response;
    try {response=await fetchImpl(origin+path,{method,headers,signal:AbortSignal.timeout(timeoutMs),
      body:body===undefined?undefined:JSON.stringify(body)});}
    catch {throw fail(502,"UPSTREAM_UNAVAILABLE","Supabase connection unavailable.");}
    let data=null;
    try {data=response.status===204?null:await response.json();}
    catch {if(response.ok)return null;throw fail(502,"UPSTREAM_ERROR","Unexpected Supabase response.");}
    if(!response.ok){
      if(response.status===401||response.status===403)
        throw fail(response.status,"NOT_AUTHENTICATED","Session expired or access denied.");
      if(response.status===409||data?.code==="23505")
        throw fail(409,"ALREADY_EXISTS","This record already exists.");
      if(response.status===400||response.status===422)
        throw fail(400,"INVALID_INPUT",errText(data)||"Invalid request.");
      throw fail(502,"UPSTREAM_ERROR","Managed database request failed.");
    }
    return data;
  }

  const auth=(path,params)=>request("/auth/v1/"+path,params);
  async function signUp(emailValue,passwordValue){
    const email=validateEmail(emailValue),password=validatePassword(passwordValue);
    const data=await auth("signup",{method:"POST",body:{email,password}});
    return {user:data.user?{id:data.user.id,email:data.user.email,createdAt:data.user.created_at}:null,
      token:data.access_token||null,refreshToken:data.refresh_token||null,
      verificationRequired:!data.access_token};
  }
  async function signIn(emailValue,passwordValue){
    const email=validateEmail(emailValue),password=validatePassword(passwordValue);
    const data=await auth("token?grant_type=password",{method:"POST",body:{email,password}});
    if(!data?.access_token||!data?.refresh_token)throw fail(401,"INVALID_CREDENTIALS","Email or password is invalid.");
    return {user:{id:data.user.id,email:data.user.email,createdAt:data.user.created_at},
      token:data.access_token,refreshToken:data.refresh_token};
  }
  async function getUser(token){
    if(!token||typeof token!=="string")return null;
    try {
      const user=await auth("user",{token});
      return user?.id?{id:user.id,email:user.email,createdAt:user.created_at}:null;
    }catch(e){if(e.status===401||e.status===403)return null;throw e;}
  }
  async function refreshSession(refreshToken){
    if(!refreshToken||typeof refreshToken!=="string")return null;
    try{
      const data=await auth("token?grant_type=refresh_token",{method:"POST",body:{refresh_token:refreshToken}});
      if(!data?.access_token||!data?.refresh_token)return null;
      return {token:data.access_token,refreshToken:data.refresh_token};
    }catch(e){if(e.status===401||e.status===400||e.status===403)return null;throw e;}
  }
  async function signOut(token){
    if(!token)return;
    try{await auth("logout",{method:"POST",token});}catch{/* local session cookies still cleared */}
  }
  function dbRequest(token,table,{method="GET",where={},body,prefer="return=representation",columns="*",
    order,limit}={}) {
    const qs=new URLSearchParams();
    for(const [name,value] of Object.entries(where))qs.set(name,"eq."+String(value));
    if(method==="GET") {
      qs.set("select",columns);
      if(order)qs.set("order",order);
      if(limit)qs.set("limit",String(limit));
    }
    const path="/rest/v1/priorly_"+table+(qs.size?"?"+qs.toString():"");
    return request(path,{method,token,body,prefer:method==="GET"?undefined:prefer});
  }
  // The authenticated application server scopes every request by a validated
  // bearer token, and Postgres RLS is the final authorization boundary.
  function forToken(token) {
    if(!token||typeof token!=="string")throw fail(401,"NOT_AUTHENTICATED","Sign in first.");
    const getOne=async(table,where,columns="*")=>(await dbRequest(token,table,{where,columns,limit:1}))?.[0];
    async function getProject(userId,projectId) {
      validateId(projectId);
      const x=await getOne("projects",{id:projectId,owner_id:userId});
      if(!x)throw fail(404,"NOT_FOUND","Project not found.");
      return toProject(x);
    }
    async function getEvidence(userId,projectId,evidenceId){
      await getProject(userId,projectId);
      validateId(evidenceId);
      const x=await getOne("evidence",{id:evidenceId,project_id:projectId,owner_id:userId});
      if(!x)throw fail(404,"NOT_FOUND","Evidence not found.");
      return x;
    }
    async function getClaim(userId,projectId,claimId) {
      await getProject(userId,projectId);validateId(claimId);
      const x=await getOne("claims",{id:claimId,project_id:projectId,owner_id:userId});
      if(!x)throw fail(404,"NOT_FOUND","Technical claim not found.");
      return x;
    }
    return {
      async listProjects(userId){
        return (await dbRequest(token,"projects",{where:{owner_id:userId},order:"updated_at.desc",limit:100})).map(toProject);
      },
      async createProject(userId,body) {
        const data=await dbRequest(token,"projects",{method:"POST",body:projectFields(body)});
        return toProject(data[0]);
      },
      getProject,
      async updateProject(userId,id,body){
        await getProject(userId,id);
        const data=await dbRequest(token,"projects",{method:"PATCH",where:{id,owner_id:userId},body:{...projectFields(body),updated_at:new Date().toISOString()}});
        if(!data.length)throw fail(404,"NOT_FOUND","Project not found.");
        return toProject(data[0]);
      },
      async deleteProject(userId,id) {
        await getProject(userId,id);
        await dbRequest(token,"projects",{method:"DELETE",where:{id,owner_id:userId},prefer:"return=minimal"});
      },
      async listRuns(userId,projectId){
        await getProject(userId,projectId);
        return (await dbRequest(token,"research_runs",{where:{project_id:projectId,owner_id:userId},order:"created_at.desc",limit:25}))
          .map(x=>({id:x.id,result:x.result_json,createdAt:x.created_at}));
      },
      async storeRun(userId,projectId,result){
        await getProject(userId,projectId);
        if(!result||!Array.isArray(result.papers)||!Array.isArray(result.repos))
          throw fail(400,"INVALID_INPUT","Malformed research.");
        const rows=[...result.papers,...result.repos]
          .filter(x=>x&&typeof x.url==="string"&&x.url.startsWith("https://"))
          .map(x=>({project_id:projectId,source:String(x.source).slice(0,100),
            source_id:String(x.id||x.url).slice(0,1500),title:String(x.title).slice(0,400),
            url:x.url.slice(0,1600),retrieved_at:x.retrievedAt||new Date().toISOString()}));
        // PostgREST does not expose a multi-request transaction. Research run
        // inserted first; noncritical source upserts may fail visibly in sourceErrors.
        const [run]=await dbRequest(token,"research_runs",{method:"POST",body:{project_id:projectId,result_json:result}});
        if(rows.length){
          try{
            await request("/rest/v1/priorly_evidence?on_conflict=project_id,source,source_id",{
              method:"POST",token,body:rows,prefer:"resolution=ignore-duplicates,return=minimal"});
          }catch{
            throw fail(502,"PARTIAL_RESEARCH_SAVE","Research run saved, but some evidence could not be attached. Refresh before retrying.");
          }
        }
        return {id:run.id,result,createdAt:run.created_at};
      },
      async listEvidence(userId,projectId){
        await getProject(userId,projectId);
        return (await dbRequest(token,"evidence",{where:{project_id:projectId,owner_id:userId},order:"updated_at.desc",limit:250})).map(toEvidence);
      },
      async classifyEvidence(userId,projectId,evidenceId,body){
        await getEvidence(userId,projectId,evidenceId);
        if(!body||!CLASSES.has(body.classification))throw fail(400,"INVALID_INPUT","Invalid review status.");
        const data=await dbRequest(token,"evidence",{method:"PATCH",where:{id:evidenceId,project_id:projectId,owner_id:userId},
          body:{classification:body.classification,note:text(body.note||"",1500),updated_at:new Date().toISOString()}});
        return toEvidence(data[0]);
      },
      async importEvidence(userId,projectId,body){
        await getProject(userId,projectId);
        if(!body||!SOURCES.has(body.source))throw fail(400,"INVALID_INPUT","Invalid source.");
        const title=text(body.title,240,5),url=text(body.url,1200,12);
        try {if(new URL(url).protocol!=="https:")throw Error();}
        catch{throw fail(400,"INVALID_INPUT","Use an HTTPS URL.");}
        const [x]=await dbRequest(token,"evidence",{method:"POST",body:{
          project_id:projectId,source:body.source,source_id:url,title,url,
          note:"Manually provided; source not independently verified",retrieved_at:new Date().toISOString()
        }});
        return toEvidence(x);
      },
      async listClaims(userId,projectId){
        await getProject(userId,projectId);
        const [claims,links,evidence]=await Promise.all([
          dbRequest(token,"claims",{where:{project_id:projectId,owner_id:userId},order:"created_at.asc",limit:60}),
          dbRequest(token,"claim_sources",{where:{project_id:projectId,owner_id:userId},limit:500}),
          dbRequest(token,"evidence",{where:{project_id:projectId,owner_id:userId},limit:250})
        ]);
        const look=new Map(evidence.map(x=>[x.id,x]));
        return claims.map(c=>toClaim(c,links.filter(l=>l.claim_id===c.id).map(l=>{
          const source=look.get(l.evidence_id);
          return source?toLink({...l,title:source.title,url:source.url,source:source.source}):null;
        }).filter(Boolean)));
      },
      async createClaim(userId,projectId,body){
        await getProject(userId,projectId);
        const [x]=await dbRequest(token,"claims",{method:"POST",body:{project_id:projectId,...claimFields(body)}});
        return toClaim(x);
      },
      async updateClaim(userId,projectId,id,body){
        await getClaim(userId,projectId,id);
        const [x]=await dbRequest(token,"claims",{method:"PATCH",where:{id,project_id:projectId,owner_id:userId},
          body:{...claimFields(body),updated_at:new Date().toISOString()}});
        return toClaim(x);
      },
      async deleteClaim(userId,projectId,id){
        await getClaim(userId,projectId,id);
        await dbRequest(token,"claims",{method:"DELETE",where:{id,project_id:projectId,owner_id:userId},prefer:"return=minimal"});
      },
      async listClaimLinks(userId,projectId,claimId){
        await getClaim(userId,projectId,claimId);
        const all=await this.listClaims(userId,projectId);
        return all.find(c=>c.id===claimId)?.links||[];
      },
      async linkClaimSource(userId,projectId,claimId,body){
        await getClaim(userId,projectId,claimId);
        if(!body||!RELATIONS.has(body.relation))throw fail(400,"INVALID_INPUT","Invalid comparison.");
        const evidenceId=validateId(body.evidenceId);
        await getEvidence(userId,projectId,evidenceId);
        const link={claim_id:claimId,evidence_id:evidenceId,project_id:projectId,relation:body.relation,
          source_excerpt:text(body.sourceExcerpt||"",1000),rationale:text(body.rationale||"",1500),
          updated_at:new Date().toISOString()};
        await request("/rest/v1/priorly_claim_sources?on_conflict=claim_id,evidence_id",{
          method:"POST",token,body:link,prefer:"resolution=merge-duplicates,return=representation"});
        const links=await this.listClaimLinks(userId,projectId,claimId);
        return links.find(l=>l.evidenceId===evidenceId);
      },
      async unlinkClaimSource(userId,projectId,claimId,evidenceId){
        await getClaim(userId,projectId,claimId);
        await getEvidence(userId,projectId,evidenceId);
        const url="/rest/v1/priorly_claim_sources?claim_id=eq."+claimId+"&evidence_id=eq."+evidenceId+
          "&project_id=eq."+projectId;
        const data=await request(url,{method:"DELETE",token,prefer:"return=representation"});
        if(!data?.length)throw fail(404,"NOT_FOUND","Source comparison not found.");
      }
    };
  }
  return {kind:"supabase",signUp,signIn,getUser,refreshSession,signOut,forToken};
}
