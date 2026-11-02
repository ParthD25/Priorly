import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes, randomUUID, scryptSync, createHash, timingSafeEqual } from "node:crypto";

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = message => new AppError(400, "INVALID_INPUT", message);
const string = (value, max = 2000) => {
  if (typeof value !== "string") throw bad("Expected a text value.");
  const out = value.trim();
  if (out.length > max) throw bad("Text exceeds " + max + " characters.");
  return out;
};
const digest = value => createHash("sha256").update(value).digest("hex");
const TTL = 7 * 24 * 60 * 60 * 1000;

export function createStore({ path = ".data/priorly.sqlite", now = () => Date.now() } = {}) {
  if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode=WAL;");
  db.exec([
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);",
    "CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);",
    "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,problem TEXT NOT NULL DEFAULT '',solution TEXT NOT NULL DEFAULT '',audience TEXT NOT NULL DEFAULT '',keywords TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);",
    "CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id,updated_at);",
    "CREATE TABLE IF NOT EXISTS research_runs (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,result_json TEXT NOT NULL,created_at TEXT NOT NULL);",
    "CREATE INDEX IF NOT EXISTS idx_runs_project ON research_runs(project_id,created_at);",
    "CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,source TEXT NOT NULL,source_id TEXT NOT NULL,title TEXT NOT NULL,url TEXT NOT NULL,classification TEXT NOT NULL DEFAULT 'unreviewed',note TEXT NOT NULL DEFAULT '',retrieved_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(project_id,source,source_id));",
    "CREATE INDEX IF NOT EXISTS idx_evidence_project ON evidence(project_id);",
    "CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,description TEXT NOT NULL,mechanism TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);",
    "CREATE INDEX IF NOT EXISTS idx_claims_project ON claims(project_id);",
    "CREATE TABLE IF NOT EXISTS claim_sources (claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,relation TEXT NOT NULL,source_excerpt TEXT NOT NULL DEFAULT '',rationale TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(claim_id,evidence_id));"
  ].join("\n"));
  const nowISO = () => new Date(now()).toISOString();
  function publicUser(row) {
    return row ? { id:row.id, email:row.email, createdAt:row.created_at } : null;
  }
  function validEmail(value) {
    const email = string(value,254).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("Enter a valid email address.");
    return email;
  }
  function validPassword(value) {
    if (typeof value !== "string" || value.length < 12 || value.length > 128) throw bad("Password must have 12–128 characters.");
    return value;
  }
  function createSession(userId) {
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(digest(token),userId,now()+TTL);
    return token;
  }
  function signUp(emailValue,passwordValue) {
    const email=validEmail(emailValue), password=validPassword(passwordValue);
    const salt=randomBytes(24).toString("hex"), hash=scryptSync(password,salt,64).toString("hex"), id=randomUUID();
    try {
      db.prepare("INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)").run(id,email,"scrypt$"+salt+"$"+hash,nowISO());
    } catch(e) {
      if (String(e.message).includes("UNIQUE")) throw new AppError(409,"ACCOUNT_EXISTS","An account with this email already exists.");
      throw e;
    }
    return {user:publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id)),token:createSession(id)};
  }
  function signIn(emailValue,passwordValue) {
    const email=validEmail(emailValue), password=typeof passwordValue==="string"?passwordValue:"";
    const user=db.prepare("SELECT * FROM users WHERE email=?").get(email);
    const fake="scrypt$"+"0".repeat(48)+"$"+"0".repeat(128);
    const [,salt,expected]=(user?.password_hash||fake).split("$");
    const candidate=scryptSync(password,salt,64);
    const verified=timingSafeEqual(candidate,Buffer.from(expected,"hex"));
    if(!user||!verified) throw new AppError(401,"INVALID_CREDENTIALS","Invalid email or password.");
    return {user:publicUser(user),token:createSession(user.id)};
  }
  function userForToken(token) {
    if(typeof token!=="string"||!/^[a-zA-Z0-9_-]{40,80}$/.test(token))return null;
    return publicUser(db.prepare("SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?").get(digest(token),now()));
  }
  function signOut(token) {
    if(typeof token==="string"&&token.length<200)db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
  }
  function requireProject(userId,projectId) {
    const row=db.prepare("SELECT * FROM projects WHERE id=? AND owner_id=?").get(projectId,userId);
    if(!row)throw new AppError(404,"NOT_FOUND","Project not found.");
    return row;
  }
  function formatProject(row) {
    return {id:row.id,title:row.title,problem:row.problem,solution:row.solution,audience:row.audience,
      keywords:row.keywords,createdAt:row.created_at,updatedAt:row.updated_at};
  }
  function fields(body) {
    if(!body||typeof body!=="object"||Array.isArray(body))throw bad("Expected an object.");
    const title=string(body.title,90);
    if(title.length<2)throw bad("Project title must contain at least 2 characters.");
    return {title,problem:string(body.problem||"",1800),solution:string(body.solution||"",2400),
      audience:string(body.audience||"",180),keywords:string(body.keywords||"",300)};
  }
  function createProject(userId,body) {
    const p=fields(body), id=randomUUID(),createdAt=nowISO();
    db.prepare("INSERT INTO projects (id,owner_id,title,problem,solution,audience,keywords,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id,userId,p.title,p.problem,p.solution,p.audience,p.keywords,createdAt,createdAt);
    return formatProject(requireProject(userId,id));
  }
  function listProjects(userId) {
    return db.prepare("SELECT * FROM projects WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100").all(userId).map(formatProject);
  }
  function getProject(userId,id){return formatProject(requireProject(userId,id));}
  function updateProject(userId,id,body) {
    requireProject(userId,id);
    const p=fields(body);
    db.prepare("UPDATE projects SET title=?,problem=?,solution=?,audience=?,keywords=?,updated_at=? WHERE id=? AND owner_id=?")
      .run(p.title,p.problem,p.solution,p.audience,p.keywords,nowISO(),id,userId);
    return getProject(userId,id);
  }
  function deleteProject(userId,id) {
    requireProject(userId,id);
    db.prepare("DELETE FROM projects WHERE id=? AND owner_id=?").run(id,userId);
  }
  function listRuns(userId,projectId) {
    requireProject(userId,projectId);
    return db.prepare("SELECT id,result_json,created_at FROM research_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 25")
      .all(projectId).map(row=>({id:row.id,result:JSON.parse(row.result_json),createdAt:row.created_at}));
  }
  function storeRun(userId,projectId,result) {
    requireProject(userId,projectId);
    if(!result||!Array.isArray(result.papers)||!Array.isArray(result.repos))throw bad("Malformed research result.");
    const runId=randomUUID(),timestamp=nowISO();
    const append=db.prepare("INSERT INTO evidence (id,project_id,source,source_id,title,url,classification,note,retrieved_at,updated_at) VALUES (?,?,?,?,?,?,'unreviewed','',?,?) ON CONFLICT(project_id,source,source_id) DO NOTHING");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO research_runs (id,project_id,result_json,created_at) VALUES (?,?,?,?)").run(runId,projectId,JSON.stringify(result),timestamp);
      for(const x of [...result.papers,...result.repos]) {
        if(typeof x.url!=="string"||!x.url.startsWith("https://"))continue;
        append.run(randomUUID(),projectId,x.source,x.id||x.url,x.title,x.url,x.retrievedAt||timestamp,timestamp);
      }
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
    return {id:runId,result,createdAt:timestamp};
  }
  function listEvidence(userId,projectId) {
    requireProject(userId,projectId);
    return db.prepare("SELECT * FROM evidence WHERE project_id=? ORDER BY updated_at DESC LIMIT 250").all(projectId)
      .map(row=>({id:row.id,source:row.source,sourceId:row.source_id,title:row.title,url:row.url,
        classification:row.classification,note:row.note,retrievedAt:row.retrieved_at,updatedAt:row.updated_at}));
  }
  function classifyEvidence(userId,projectId,evidenceId,body) {
    requireProject(userId,projectId);
    const allowed=["unreviewed","overlap","differentiated","irrelevant","needs-review"];
    if(!body||!allowed.includes(body.classification))throw bad("Invalid evidence classification.");
    const note=string(body.note||"",1500);
    const result=db.prepare("UPDATE evidence SET classification=?,note=?,updated_at=? WHERE id=? AND project_id=?")
      .run(body.classification,note,nowISO(),evidenceId,projectId);
    if(!result.changes)throw new AppError(404,"NOT_FOUND","Evidence not found.");
    return listEvidence(userId,projectId).find(x=>x.id===evidenceId);
  }
  function importEvidence(userId,projectId,body) {
    requireProject(userId,projectId);
    if(!body||typeof body!=="object")throw bad("Expected a source object.");
    const allowed=["Patent publication","Company documentation","Research publication","Other documentation"];
    if(!allowed.includes(body.source))throw bad("Invalid source type.");
    const title=string(body.title,240), url=string(body.url,1200);
    if(title.length<5)throw bad("Source title must contain at least five characters.");
    try { const parsed=new URL(url); if(parsed.protocol!=="https:"||!parsed.hostname.includes("."))throw Error(); }
    catch { throw bad("Source URL must be a public HTTPS link."); }
    const timestamp=nowISO();
    try {
      db.prepare("INSERT INTO evidence (id,project_id,source,source_id,title,url,classification,note,retrieved_at,updated_at) VALUES (?,?,?,?,?,?,'unreviewed','Manually provided; source not independently verified',?,?)")
        .run(randomUUID(),projectId,body.source,url,title,url,timestamp,timestamp);
    } catch(e) {
      if(String(e.message).includes("UNIQUE"))throw new AppError(409,"SOURCE_EXISTS","This source is already attached to the project.");
      throw e;
    }
    return listEvidence(userId,projectId).find(x=>x.source===body.source&&x.sourceId===url);
  }
  function requireClaim(userId,projectId,claimId) {
    requireProject(userId,projectId);
    const claim=db.prepare("SELECT * FROM claims WHERE id=? AND project_id=?").get(claimId,projectId);
    if(!claim)throw new AppError(404,"NOT_FOUND","Technical claim not found.");
    return claim;
  }
  function claimFields(body) {
    if(!body||typeof body!=="object")throw bad("Expected a claim object.");
    const description=string(body.description,350),mechanism=string(body.mechanism||"",1800);
    if(description.length<10)throw bad("A technical claim needs at least ten characters.");
    return {description,mechanism};
  }
  function listClaimLinks(userId,projectId,claimId) {
    requireClaim(userId,projectId,claimId);
    return db.prepare("SELECT cs.evidence_id,cs.relation,cs.source_excerpt,cs.rationale,cs.updated_at,e.title,e.url,e.source FROM claim_sources cs JOIN evidence e ON e.id=cs.evidence_id WHERE cs.claim_id=? AND e.project_id=? ORDER BY cs.updated_at DESC")
      .all(claimId,projectId).map(x=>({evidenceId:x.evidence_id,relation:x.relation,sourceExcerpt:x.source_excerpt,
        rationale:x.rationale,updatedAt:x.updated_at,title:x.title,url:x.url,source:x.source}));
  }
  function listClaims(userId,projectId) {
    requireProject(userId,projectId);
    return db.prepare("SELECT * FROM claims WHERE project_id=? ORDER BY created_at ASC LIMIT 60").all(projectId)
      .map(x=>({id:x.id,description:x.description,mechanism:x.mechanism,createdAt:x.created_at,
        updatedAt:x.updated_at,links:listClaimLinks(userId,projectId,x.id)}));
  }
  function createClaim(userId,projectId,body) {
    requireProject(userId,projectId);
    const p=claimFields(body),id=randomUUID(),timestamp=nowISO();
    db.prepare("INSERT INTO claims (id,project_id,description,mechanism,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(id,projectId,p.description,p.mechanism,timestamp,timestamp);
    return listClaims(userId,projectId).find(x=>x.id===id);
  }
  function updateClaim(userId,projectId,id,body) {
    requireClaim(userId,projectId,id);
    const p=claimFields(body);
    db.prepare("UPDATE claims SET description=?,mechanism=?,updated_at=? WHERE id=? AND project_id=?")
      .run(p.description,p.mechanism,nowISO(),id,projectId);
    return listClaims(userId,projectId).find(x=>x.id===id);
  }
  function deleteClaim(userId,projectId,id) {
    requireClaim(userId,projectId,id);
    db.prepare("DELETE FROM claims WHERE id=? AND project_id=?").run(id,projectId);
  }
  function linkClaimSource(userId,projectId,claimId,body) {
    requireClaim(userId,projectId,claimId);
    if(!body||typeof body!=="object")throw bad("Expected evidence mapping.");
    const evidenceId=string(body.evidenceId,120);
    const source=db.prepare("SELECT id FROM evidence WHERE id=? AND project_id=?").get(evidenceId,projectId);
    if(!source)throw new AppError(404,"NOT_FOUND","Evidence source not found.");
    const allowed=["overlap","possible-difference","background","uncertain"];
    if(!allowed.includes(body.relation))throw bad("Invalid comparison relation.");
    const sourceExcerpt=string(body.sourceExcerpt||"",1000),rationale=string(body.rationale||"",1500);
    db.prepare("INSERT INTO claim_sources (claim_id,evidence_id,relation,source_excerpt,rationale,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(claim_id,evidence_id) DO UPDATE SET relation=excluded.relation,source_excerpt=excluded.source_excerpt,rationale=excluded.rationale,updated_at=excluded.updated_at")
      .run(claimId,evidenceId,body.relation,sourceExcerpt,rationale,nowISO());
    return listClaimLinks(userId,projectId,claimId).find(x=>x.evidenceId===evidenceId);
  }
  function unlinkClaimSource(userId,projectId,claimId,evidenceId) {
    requireClaim(userId,projectId,claimId);
    const row=db.prepare("DELETE FROM claim_sources WHERE claim_id=? AND evidence_id=?").run(claimId,evidenceId);
    if(!row.changes)throw new AppError(404,"NOT_FOUND","Claim evidence link not found.");
  }
  function deleteAccount(userId) {
    db.prepare("DELETE FROM users WHERE id=?").run(userId);
  }
  return {db,signUp,signIn,userForToken,signOut,createProject,listProjects,getProject,updateProject,
    deleteProject,listRuns,storeRun,listEvidence,classifyEvidence,importEvidence,listClaims,createClaim,updateClaim,deleteClaim,listClaimLinks,linkClaimSource,unlinkClaimSource,deleteAccount};
}
