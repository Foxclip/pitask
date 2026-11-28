import { Session } from "./session.mjs";

export class Judge extends Session {

    prompt;
    verdict;

    constructor(terminalLogger, fileLogger) {
        super("Judge", terminalLogger, fileLogger, [
            "ask_user_question"
        ]);
    }

    async start({ runDir, taskPath, workerSessionPath, nudgeCount, distillCount }) {

        await super.start();

        this.prompt = `
- You are one cycle of the judge for a pitask run: a pi worker agent executing the task in ${taskPath}.
- You are STATELESS: your only context is what you read from disk right now. Do not assume anything from a previous cycle — the loop keeps its memory in files, not in you.

- Current working directory: ${process.cwd()}
- Run directory: ${runDir}
- Worker session file: ${workerSessionPath}
- Nudge count: ${nudgeCount}
- Distill count: ${distillCount}

- Read (budget: AT MOST 5 tool calls, use tail/jq — you are one cycle of many and speed matters more than depth):
    1. ${taskPath} — the task the worker is supposed to complete
    2. Worker session file above — the worker's live transcript (JSONL, one record per line, lines can be long). Tail the end to see what it has been doing: assistant messages, tool calls, results. If it is missing or empty, the worker just started — that is OK.

- The loop already checked deterministic health (worker process liveness) and would have ended the run if the worker died. Being asked means: the worker is alive. Judge the WORK, not the plumbing: is the worker making real progress on the task? Stuck repeating itself? Off-track? (A transcript that ends with a finished answer is OK — the worker may already be done.)

- Never modify anything in working directory (except the run directory when writing NUDGE and DISTILL files), the worker is working here.

- If you mention specific time in your message, it must be local time, not ISO.

- For NUDGE and DISTILL verdicts, write a file to the run directory:
    - NUDGE: NUDGE-<N>.md file, where <N> is Nudge count + 1
    - DISTILL: DISTILL-<N>.md, where <N> is Distill count + 1

- Output format (STRICT): your final line must be exactly one of:
    DECISION: OK
    DECISION: NUDGE: <one-line message, specific, actionable, referencing what you saw>
    DECISION: DISTILL: <one-line reason the context has rotted>
    DECISION: STOP: <one-line reason the task cannot succeed>

- DISTILL is for CONTEXT ROT only: the worker is confidently repeating a wrong premise, working from a refuted plan, or re-doing work it already did — the transcript itself is now the problem. It is DESTRUCTIVE and bounded: the worker's current session would be discarded and a FRESH session would be relaunched with a distilled brief (task + what it got right so far). Do NOT use it for slow progress (NUDGE), a task that cannot succeed (STOP), or ordinary stuckness (NUDGE first).

- Any other final line is treated as OK. Do NOT end with anything after the DECISION line.
- The verdict message must contain NO tool call. This session ends immediately with the verdict: the process is killed right after the DECISION line, so no further tool calls, re-reads, or polling are possible or needed.`;

        await this.sendPrompt(this.prompt);
    }

    onSettle(aborted) {
        super.onSettle(aborted);
        if (this.messages.length > 0) {
            const lastMessage = this.messages.at(-1);
            const messageTrimmed = lastMessage.trimEnd();
            const lastLine = messageTrimmed.slice(messageTrimmed.lastIndexOf('\n') + 1);
            const m = lastLine.match(/^DECISION:\s*(.*)$/);
            this.verdict = m ? m[1].trim() : `ERROR: decision could not be parsed`;
            this.eventEmitter.emit("done", this.verdict);
        } else {
            this.eventEmitter.emit("done", "ERROR: no messages");
        }
    }

    onError(err) {
        this.eventEmitter.emit("done", "ERROR: " + err.message); // before exit event, so that promises waiting for both events get this event
        super.onError(err);
    }

}
