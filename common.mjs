import EventEmitter, { once } from "node:events";
import { ChunkProcessor } from "./chunk_processor.mjs";

export function generateRandomString(length = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timeout after ${ms}ms`));
        }, ms);
        promise.then(
            (result) => { clearTimeout(timer); resolve(result); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
}

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

export async function rpcCall(proc, args, timeoutMs = 10 * 60 * 1000, terminalLogger) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
        throw new Error(`RPC call failed (${args.type}): process already exited: ${proc.exitCode ?? (proc.signalCode ? 'signal ' + proc.signalCode : proc.exitCode)}`);
    }
    const chunkProcessor = new ChunkProcessor(terminalLogger);
    const eventEmitter = new EventEmitter();
    const onData = (chunk) => {
        for (const record of chunkProcessor.getRecords(chunk)) {
            if (record.type === "response" && record.command === args.type && record.id === args.id) {
                eventEmitter.emit(args.type, record);
            }
        }
    };
    let stdinError = null;
    const onStdinError = (err) => { stdinError = err; };
    proc.stdout.on("data", onData);
    proc.stdin.on("error", onStdinError);
    try {
        proc.stdin.write(`${JSON.stringify(args)}\n`);
        const [type, payload] = await raceEvents(
            [
                { emitter: eventEmitter, eventName: args.type },
                { emitter: proc, eventName: "exit" }
            ],
            timeoutMs,
            `RPC call timed out after ${timeoutMs / 1000}s (${args.type})`
        );
        if (type !== args.type) {
            if (stdinError && proc.exitCode === null) {
                throw new Error(`RPC call failed (${args.type}): stdin: ${stdinError.message}`);
            }
            throw new Error(`RPC call failed (${args.type}): process exited: ${proc.exitCode ?? (payload[1] ? 'signal ' + payload[1] : payload[0])}`);
        }
        const response = payload[0];
        if (!response.success) {
            throw new Error(`RPC call failed (${args.type}): ${response.error}`);
        }
        return response.data;
    } finally {
        proc.stdout.off("data", onData);
        proc.stdin.off("error", onStdinError);
    }
}
