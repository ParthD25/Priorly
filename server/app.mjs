import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { researchIdea, InputError } from "./research.mjs";
import { createStore, AppError } from "./storage.mjs";

const FILES = new Map([
  ["/", ["../index.html","text/html; charset=utf-8"]],
  ["/index.html", ["../index.html","text/html; charset=utf-8"]],
  ["/app.js", ["../app.js","text/javascript; charset=utf-8"]],
  ["/styles.css", ["../styles.css","text/css; charset=utf-8"]],
  ["/workspace.html", ["../workspace.html","text/html; charset=utf-8"]],
  ["/workspace.js", ["../workspace.js","text/javascript; charset=utf-8"]],
  ["/workspace.css", ["../workspace.css","text/css; charset=utf-8"]]
]);
const LIMIT = 16 * 1024;
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};
const send = (res, status, data, extra={}) => {
  res.writeHead(status,{...SECURITY_HEADERS,"Content-Type":"application/json; charset=utf-8",...extra});
  res.end(JSON.stringify(data));
};
const error = (status,code,message) => new AppError(status,code,message);
const cookieFrom = (req,name) => {
  const raw=String(req.headers.cookie||"");
  const pair=raw.split(";").map(s=>s.trim()).find(s=>s.startsWith(name+"="));
  return pair?pair.slice(name.length+1):"";
};
const tokenFrom = req => cookieFrom(req,"priorly_session");
const cookiesFor = (token,refreshToken="",clear=false) => {
  const flags=["Path=/","HttpOnly","SameSite=Strict",process.env.NODE_ENV==="production"?"Secure":""].filter(Boolean);
  const suffix="; "+flags.join("; ")+(clear?"; Max-Age=0":"");
  const result=["priorly_session="+(clear?"":token)+suffix];
  if(refreshToken||clear)result.push("priorly_refresh="+(clear?"":refreshToken)+suffix);
  return result;
};
async function getSession(req,res,store) {
  let token=tokenFrom(req), user;
  if(store.kind==="supabase"){
    user=await store.getUser(token);
    if(!user){
      const refreshed=await store.refreshSession(cookieFrom(req,"priorly_refresh"));
      if(refreshed){
        token=refreshed.token;
        user=await store.getUser(token);
        if(user)res.setHeader("Set-Cookie",cookiesFor(token,refreshed.refreshToken));
      }
    }
  }else{
    user=store.userForToken(token);
  }
  return {user,token};
}
async function readBody(req) {
  let total=0;
  const chunks=[];
  for await(const chunk of req){
    total+=chunk.length;
    if(total>LIMIT)throw error(413,"PAYLOAD_TOO_LARGE","Request body too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw error(400,"INVALID_JSON","Request must contain valid JSON.");
  }
}
function csrfAndType(req) {
  const origin=req.headers.origin;
  if(origin){
    let permitted=false;
    try {permitted=new URL(origin).host===req.headers.host;}catch{}
    if(!permitted)throw error(403,"ORIGIN_DENIED","Cross-origin requests are not permitted.");
  }
  const type=String(req.headers["content-type"]||"").toLowerCase();
  if(!type.startsWith("application/json"))throw error(415,"UNSUPPORTED_MEDIA_TYPE","Content-Type must be application/json.");
}
function throttle(buckets,key,now,max,windowMs){
  const last=buckets.get(key);
  if(!last||now>=last.end){buckets.set(key,{count:1,end:now+windowMs});return;}
  last.count++;
  if(last.count>max)throw error(429,"RATE_LIMITED","Rate limit exceeded; try again later.");
}
const routeParts = path => path.split("/").filter(Boolean);
export function createApp({
  service=researchIdea,
  store=createStore({path:process.env.PRIORLY_DB_PATH||".data/priorly.sqlite"}),
  clock=()=>Date.now(),
  maxRequests=20,
  windowMs=15*60*1000
}={}){
  const buckets=new Map();
  return createServer(async(req,res)=>{
    const requestId=randomUUID();
    res.setHeader("X-Request-Id",requestId);
    try {
      const pathname=new URL(req.url||"/","http://localhost").pathname;
      if(pathname==="/api/v1/health"&&req.method==="GET")return send(res,200,{status:"ok",version:"0.5.0",storage:store.kind==="supabase"?"supabase":"sqlite"});
      if(req.method==="GET"&&FILES.has(pathname)){
        const [file,mime]=FILES.get(pathname);
        const bytes=await readFile(new URL(file,import.meta.url));
        res.writeHead(200,{...SECURITY_HEADERS,"Content-Type":mime});
        return res.end(bytes);
      }
      if(!pathname.startsWith("/api/v1/"))return send(res,404,{error:{code:"NOT_FOUND",message:"Not found."}});
      const parts=routeParts(pathname);
      const isWrite=!["GET","HEAD"].includes(req.method);
      if(isWrite)csrfAndType(req);

      if(parts[2]==="auth"){
        if(parts.length===4&&["register","login"].includes(parts[3])&&req.method==="POST"){
          throttle(buckets,"auth:"+req.socket.remoteAddress,clock(),10,windowMs);
          const body=await readBody(req);
          const result=await (parts[3]==="register"?store.signUp(body.email,body.password):store.signIn(body.email,body.password));
          if(result.verificationRequired) return send(res,202,{verificationRequired:true,message:"Confirm your email before signing in."});
          res.setHeader("Set-Cookie",cookiesFor(result.token,result.refreshToken));
          return send(res,200,{user:result.user});
        }
        if(parts.length===4&&parts[3]==="me"&&req.method==="GET"){
          const {user}=await getSession(req,res,store);
          return user?send(res,200,{user}):send(res,401,{error:{code:"NOT_AUTHENTICATED",message:"Sign in to continue."}});
        }
        if(parts.length===4&&parts[3]==="logout"&&req.method==="POST"){
          await store.signOut(tokenFrom(req));
          res.setHeader("Set-Cookie",cookiesFor("","",true));
          return send(res,200,{ok:true});
        }
        return send(res,404,{error:{code:"NOT_FOUND",message:"Not found."}});
      }

      // Existing public research endpoint remains available to the static preview,
      // with strict rate limiting. No server-side research history is stored.
      if(parts[2]==="research"&&parts.length===3&&req.method==="POST"){
        throttle(buckets,"research:"+req.socket.remoteAddress,clock(),maxRequests,windowMs);
        const body=await readBody(req);
        return send(res,200,await service(body));
      }
      if(parts[2]!=="projects")return send(res,404,{error:{code:"NOT_FOUND",message:"Not found."}});
      const {user,token}=await getSession(req,res,store);
      if(!user)throw error(401,"NOT_AUTHENTICATED","Sign in to continue.");
      const scoped=store.forToken?store.forToken(token):store;
      if(parts.length===3){
        if(req.method==="GET")return send(res,200,{projects:await scoped.listProjects(user.id)});
        if(req.method==="POST")return send(res,201,{project:await scoped.createProject(user.id,await readBody(req))});
      }
      const projectId=parts[3];
      if(parts.length===4){
        if(req.method==="GET")return send(res,200,{project:await scoped.getProject(user.id,projectId)});
        if(req.method==="PUT")return send(res,200,{project:await scoped.updateProject(user.id,projectId,await readBody(req))});
        if(req.method==="DELETE"){await scoped.deleteProject(user.id,projectId);return send(res,200,{ok:true});}
      }
      if(parts.length===5&&parts[4]==="research"){
        if(req.method==="GET")return send(res,200,{runs:await scoped.listRuns(user.id,projectId)});
        if(req.method==="POST"){
          throttle(buckets,"research:"+req.socket.remoteAddress,clock(),maxRequests,windowMs);
          const project=await scoped.getProject(user.id,projectId);
          const result=await service({
            ideaName:project.title,
            ideaProblem:project.problem,
            ideaSolution:project.solution,
            ideaAudience:project.audience,
            ideaKeywords:project.keywords
          });
          return send(res,201,{run:await scoped.storeRun(user.id,projectId,result)});
        }
      }
      if(parts.length===5&&parts[4]==="evidence"&&req.method==="GET"){
        return send(res,200,{evidence:await scoped.listEvidence(user.id,projectId)});
      }
      if(parts.length===6&&parts[4]==="evidence"&&req.method==="PATCH"){
        return send(res,200,{evidence:await scoped.classifyEvidence(user.id,projectId,parts[5],await readBody(req))});
      }
      if(parts.length===5&&parts[4]==="evidence"&&req.method==="POST"){
        return send(res,201,{evidence:await scoped.importEvidence(user.id,projectId,await readBody(req))});
      }
      if(parts.length===5&&parts[4]==="claims"){
        if(req.method==="GET")return send(res,200,{claims:await scoped.listClaims(user.id,projectId)});
        if(req.method==="POST")return send(res,201,{claim:await scoped.createClaim(user.id,projectId,await readBody(req))});
      }
      if(parts.length===6&&parts[4]==="claims"){
        if(req.method==="PUT")return send(res,200,{claim:await scoped.updateClaim(user.id,projectId,parts[5],await readBody(req))});
        if(req.method==="DELETE"){await scoped.deleteClaim(user.id,projectId,parts[5]);return send(res,200,{ok:true});}
      }
      if(parts.length===7&&parts[4]==="claims"&&parts[6]==="sources"){
        if(req.method==="GET")return send(res,200,{links:await scoped.listClaimLinks(user.id,projectId,parts[5])});
        if(req.method==="POST")return send(res,201,{link:await scoped.linkClaimSource(user.id,projectId,parts[5],await readBody(req))});
      }
      if(parts.length===8&&parts[4]==="claims"&&parts[6]==="sources"&&req.method==="DELETE"){
        await scoped.unlinkClaimSource(user.id,projectId,parts[5],parts[7]);
        return send(res,200,{ok:true});
      }
      return send(res,405,{error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed."}});
    }catch(e){
      if(e instanceof InputError)return send(res,400,{error:{code:"INVALID_IDEA",message:e.message}});
      if(e instanceof AppError)return send(res,e.status,{error:{code:e.code,message:e.message}});
      console.error("Priorly request failure",requestId,e instanceof Error?e.name:"Unexpected");
      return send(res,500,{error:{code:"INTERNAL_ERROR",message:"Unexpected server error.",requestId}});
    }
  });
}
