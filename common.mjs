import EventEmitter, { once } from "node:events";
import { ChunkProcessor } from "./chunk_processor.mjs";

export async function raceEvents(eventList, timeoutMs, timeoutErrorText) {
    if (eventList.length === 0) {
        throw new Error("Must pass at least one event");
    }
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
    }, timeoutMs);
    let type;
    let payload;
    try {
        const promises = [];
        for (const evPair of eventList) {
            promises.push(once(evPair.emitter, evPair.eventName, { signal: ac.signal }).then(p => [evPair.eventName, p]));
        }
        [type, payload] = await Promise.race(promises);
    } catch (err) {
        if (timedOut) {
            if (!timeoutErrorText) {
                timeoutErrorText = `raceEvents timed out after ${timeoutMs / 1000}s`;
            }
            throw new Error(timeoutErrorText);
        }
        throw err;
    } finally {
        clearTimeout(timer);
        ac.abort();
    }
    return [type, payload];
}

export async function rpcCall(proc, args, timeoutMs = 10 * 60 * 1000, idInc, terminalLogger) {
    if (idInc) {
        if (!args.id) {
            args.id = idInc();
        }
    }
    const chunkProcessor = new ChunkProcessor(terminalLogger);
    let eventEmitter = new EventEmitter();
    const analyzeChunk = (chunk) => {
        const records = chunkProcessor.getRecords(chunk);
        for (const record of records) {
            if (record.type === "response" && record.command === args.type && record.id === args.id) {
                eventEmitter.emit(args.type, record);
            }
        }
    };
    let stdinError;
    const stdinListener = (err) => stdinError = err;
    proc.stdout.on("data", analyzeChunk);
    proc.stdin.on("error", stdinListener);
    let type, payload;
    try {
        proc.stdin.write(`${JSON.stringify(args)}\n`);
        [type, payload] = await raceEvents(
            [
                { emitter: eventEmitter, eventName: args.type },
                { emitter: eventEmitter, eventName: "exit" }
            ],
            timeoutMs,
            `RPC call timed out after ${timeoutMs / 1000}s (${args.type})`
        );
    } finally {
        proc.stdin.off("error", stdinListener);
        proc.stdout.off("data", analyzeChunk);
    }
    if (type !== args.type) {
        if (stdinError) {
            throw new Error(`RPC call failed (${args.type}): stdin: ${stdinError.message}`);
        }
        const exitCode = payload[0];
        throw new Error(`RPC call failed (${args.type}): exit: ${exitCode}`);
    }
    const response = payload[0];
    if (!response.success) {
        throw new Error(`RPC call failed (${args.type}): ${response.error}`);
    }
    return response.data;
}
