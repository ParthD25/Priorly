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
    "CREATE INDEX IF NOT EXISTS idx_evidence_project ON evidence(project_id);"
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
  function deleteAccount(userId) {
    db.prepare("DELETE FROM users WHERE id=?").run(userId);
  }
  return {db,signUp,signIn,userForToken,signOut,createProject,listProjects,getProject,updateProject,
    deleteProject,listRuns,storeRun,listEvidence,classifyEvidence,deleteAccount};
}
