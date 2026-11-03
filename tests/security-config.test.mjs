import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeRuntime } from "../server/security-config.mjs";
test("preview starts on loopback",()=>{
  assert.deepEqual(assertSafeRuntime({NODE_ENV:"development"}),{host:"127.0.0.1"});
  assert.equal(assertSafeRuntime({NODE_ENV:"test",HOST:"localhost"}).host,"localhost");
});
test("production deployment is blocked",()=>{
  assert.throws(()=>assertSafeRuntime({NODE_ENV:"production",HOST:"127.0.0.1"}),/NOT approved/);
});
test("non-loopback network exposure is blocked",()=>{
  assert.throws(()=>assertSafeRuntime({NODE_ENV:"development",HOST:"0.0.0.0"}),/loopback/);
  assert.throws(()=>assertSafeRuntime({NODE_ENV:"development",HOST:"192.168.1.8"}),/loopback/);
});
