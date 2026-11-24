import { Run } from './run.mjs';
import { parseArgs } from "node:util";
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

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
const taskPath = path.resolve(cmdArgs.task);
const judgeCycleTime = durationToSeconds(cmdArgs.cycle);

// check task file
if (!existsSync(taskPath)) {
    throw new Error(`${taskPath} does not exist`);
}
if (!statSync(taskPath).isFile()) {
    throw new Error(`${taskPath} is not a file`);
}

// create pitask folder
mkdirSync(PITASK_DIR_NAME, { recursive: true });

// create run folder
const runsDir = `${PITASK_DIR_NAME}/runs`;
mkdirSync(runsDir, { recursive: true });
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
const runDir = path.resolve(`${runsDir}/run${runN}`);
mkdirSync(runDir);

// write metadata file
const metadata = {
    startupTimeIso: new Date().toISOString(),
    taskPath: taskPath,
    judgeCycleTime: cmdArgs.cycle
}
writeFileSync(`${runDir}/meta.json`, JSON.stringify(metadata, null, 4));

// copy task file
copyFileSync(taskPath, `${runDir}/TASK.md`);

// launch run
const run = new Run(runDir, taskPath, judgeCycleTime);
await run.launch();

// TODO: implement DISTILL verdict
