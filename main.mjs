import { Run } from './run.mjs';
import { parseArgs } from "node:util";

function durationToSeconds(duration) {
    const str = duration.trim();
    const regex = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i;
    const match = str.match(regex);
    if (!match || match[0] === '') {
        throw new Error(`Invalid duration format: "${duration}"`);
    }
    const [, h = 0, m = 0, s = 0] = match;
    return +h * 3600 + +m * 60 + +s;
}

const { values: cmdArgs } = parseArgs({
    options: {
        task: { type: "string", default: "TASK.md" },
        cycle: { type: "string", default: "20m" }
    }
});
const judgeCycleTime = durationToSeconds(cmdArgs.cycle);

const run = new Run(cmdArgs.task, judgeCycleTime);
await run.launch();

// TODO: log terminal output to file
