import { ChunkProcessor } from "../chunk_processor.mjs";

function writeObj(obj) {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
}

const chunkProcessor = new ChunkProcessor();
function processInput(chunk) {
    const records = chunkProcessor.getRecords(chunk);
    for (const record of records) {
        if (record.type === "get_state") {
            sendState(record.id);
        }
    }
}

function sendState(id) {
    writeObj({
        id: id,
        type: "response",
        command: "get_state",
        success: true,
        data: {
            model: {
                id: "Qwen3.8-27B-UD-Q3_K_XL"
            },
            sessionFile: "/path/to/file.jsonl"
        }
    });
}

// pi process writes this on startup, so simulate it too
const startupObj = {
    type: "extension_ui_request",
    id: "bd03171a-2bc7-4c86-b555-96698513b1dc",
    method: "setStatus",
    statusKey: "goal"
};
writeObj(startupObj);

process.stdin.on("data", processInput);


