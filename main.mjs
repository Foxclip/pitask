import { readFileSync } from "node:fs";
import { Run } from './run.mjs';

const taskText = readFileSync("TASK.md", "utf8");
const task = {
    id: "prompt-1",
    type: "prompt",
    message: taskText
};
const run = new Run(task);
await run.launch();

