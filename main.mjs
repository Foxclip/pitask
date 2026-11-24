import { Run } from './run.mjs';
import { parseArgs } from "node:util";
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, statSync } from 'node:fs';

const PITASK_DIR_NAME = ".pitask";

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

// check task file
if (!statSync(cmdArgs.task).isFile()) {
    throw new Error(`${cmdArgs.task} does not exist`);
}

// create pitask folder
mkdirSync(PITASK_DIR_NAME);

// create run folder
const runsDir = `${PITASK_DIR_NAME}/runs`;
mkdirSync(runsDir);
let runN = 1;
for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
        continue;
    }
    const match = entry.name.match(/^run(\d+)$/);
    if (match) {
        runN = Math.max(runN, Number(match[1]) + 1);
    }
}
const runDir = `${runsDir}/run${runN}`;
mkdirSync(runDir);

// write metadata file
const metadata = {
    startupTimeIso: new Date().toISOString(),
    taskPath: cmdArgs.task,
    judgeCycleTime: cmdArgs.cycle
}
writeFileSync(`${runDir}/meta.json`, JSON.stringify(metadata, null, 4));

// copy task file
copyFileSync(cmdArgs.task, `${runDir}/TASK.md`);

// launch run
const run = new Run(runDir, cmdArgs.task, judgeCycleTime);
await run.launch();

// TODO: implement DISTILL verdict
// TODO: log terminal output to file
