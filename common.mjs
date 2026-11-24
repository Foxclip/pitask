import { once } from "node:events";

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
