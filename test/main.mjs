import test from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { ChunkProcessor } from "../chunk_processor.mjs";
import { rpcCall, withTimeout } from "../common.mjs";

const rpcCallTimeoutMs = 1000;

function spawnRpcProcess(t) {
    const rpcProcess = spawn("node", ["mock-pi.mjs"], { stdio: ["pipe", "pipe", "inherit"] });
    t.after(() => rpcProcess.kill());
    assert.strictEqual(rpcProcess.exitCode, null);
    assert.strictEqual(rpcProcess.signalCode, null);
    rpcProcess.on("error", (e) => assert.fail(`RPC process error: ${e.message}`));
    return rpcProcess;
}

async function sendPrompt(proc, prompt) {
    return (await rpcCall(proc, {
        id: "prompt-1",
        type: "prompt",
        message: prompt
    }, rpcCallTimeoutMs));
}

function waitForAssistantMessage(proc) {
    return new Promise((resolve, reject) => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
            reject(new Error("Process already exited"));
        }
        const chunkProcessor = new ChunkProcessor();
        const onData = (chunk) => {
            for (const record of chunkProcessor.getRecords(chunk)) {
                if (record.type === "message_end" && record.message.role === "assistant") {
                    proc.stdout.off("data", onData);
                    resolve(record.message);
                }
            }
        }
        proc.stdout.on("data", onData);
    });
}

function getMessageText(message) {
    const text = message.content.find((c) => c.type === "text");
    return text?.text;
}

test("rpc session path test", async (t) => {
    const rpcProcess = spawnRpcProcess(t);
    const sessionPath = (await rpcCall(rpcProcess, {
        type: "get_state"
    }, rpcCallTimeoutMs)).sessionFile;
    assert.strictEqual(sessionPath, "/path/to/file.jsonl");
});

test("rpc prompt test", async (t) => {
    const rpcProcess = spawnRpcProcess(t);
    const waitForMessage = waitForAssistantMessage(rpcProcess);
    await sendPrompt(rpcProcess, "Hello");
    const message = await withTimeout(waitForMessage, rpcCallTimeoutMs, "waitForMessage");
    assert.strictEqual(getMessageText(message), "Hi!");
});

