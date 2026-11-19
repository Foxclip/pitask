import EventEmitter from "node:events";
import { spawn } from "node:child_process";
import { Logger } from "./logger.mjs";

const excludeTools = [
    "ask_user_question",
    "edit",
    "write"
];

export class Judge {

    piProcess;
    lastMessage = "";
    eventEmitter = new EventEmitter();

    constructor(taskPath, workerSessionPath) {

        const prompt = `You are one cycle of the judge for a pitask run: a pi worker agent executing the task in ${taskPath}.
You are STATELESS: your only context is what you read from disk right now. Do not assume anything from a previous cycle — the loop keeps its memory in files, not in you.

Worker session file: ${workerSessionPath}

Read (budget: AT MOST 4 tool calls, use tail/jq — you are one cycle of many and
speed matters more than depth):
1. Worker session file above — the worker's live transcript (JSONL, one record
   per line, lines can be long). Tail the end to see what it has been doing:
   assistant messages, tool calls, results. If it is missing or empty, the
   worker just started — that is OK.
2. ${taskPath} — the task the worker is supposed to complete

The loop already checked deterministic health (worker process liveness) and
would have ended the run if the worker died. Being asked means: the worker is
alive. Judge the WORK, not the plumbing: is the worker making real progress on
the task? Stuck repeating itself? Off-track? (A transcript that ends with a
finished answer is OK — the worker may already be done.)

You are READ-ONLY: inspect files only — never modify anything in this
directory, the worker is working here.

Output format (STRICT): your final line must be exactly one of:
DECISION: OK
DECISION: NUDGE: <one-line message, specific, actionable, referencing what you saw>
DECISION: DISTILL: <one-line reason the context has rotted>
DECISION: STOP: <one-line reason the task cannot succeed>

DISTILL is for CONTEXT ROT only: the worker is confidently repeating a wrong
premise, working from a refuted plan, or re-doing work it already did — the
transcript itself is now the problem. It is DESTRUCTIVE and bounded: the
worker's current session would be discarded and a FRESH session would be
relaunched with a distilled brief (task + what it got right so far). Do NOT
use it for slow progress (NUDGE), a task that cannot succeed (STOP), or
ordinary stuckness (NUDGE first).

Any other final line is treated as OK. Do NOT end with anything after the DECISION line.`;
        this.piProcess = spawn(
            "pi",
            [
                "--print", prompt,
                "--exclude-tools", excludeTools.join(","),
            ],
            { stdio: ['pipe', 'pipe', 'inherit'] }
        );
        if (!this.piProcess.stdin || !this.piProcess.stdout) {
            throw new Error('Failed to initialize Judge process streams.');
        }
        this.piProcess.stdin.end();

        // event setup
        this.piProcess.stdout.on('data', (message) => {
            this.lastMessage += message;
        });
        this.piProcess.on('close', (code) => {
            Logger.writeLine(`[judge]: \n${this.lastMessage}`);
            const messageTrimmed = this.lastMessage.trimEnd();
            const lastLine = messageTrimmed.slice(messageTrimmed.lastIndexOf('\n') + 1);
            const m = lastLine.match(/^DECISION:\s*(.*)$/);
            const verdict = m ? m[1].trim() : (code === 0 ? "OK" : `ERROR: judge exited with code ${code}`);
            this.eventEmitter.emit("done", verdict);
        });
        this.piProcess.on('error', (err) => {
            console.error('Failed to start Judge Pi process. Is the "pi" CLI installed and in your PATH?', err.message);
            this.eventEmitter.emit("done", "ERROR: " + err.message);
        });
    }

}
