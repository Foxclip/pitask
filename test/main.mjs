import test from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { ChunkProcessor } from "../chunk_processor.mjs";
import { rpcCall } from "../common.mjs";

function spawnRpcProcess(t) {
    const rpcProcess = spawn("node", ["mock-pi.mjs"]);
    t.after(() => rpcProcess.kill());
    assert.strictEqual(rpcProcess.exitCode, null);
    assert.strictEqual(rpcProcess.signalCode, null);
    rpcProcess.on("error", (e) => assert.fail("RPC process error:", e.message));
    return rpcProcess;
}

test("rpc session path test", async (t) => {
    const rpcProcess = spawnRpcProcess(t);
    const sessionPath = (await rpcCall(rpcProcess, {
        type: "get_state"
    }, 1000)).sessionFile;
    assert.strictEqual(sessionPath, "/path/to/file.jsonl");
});

