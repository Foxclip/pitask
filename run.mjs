import { Worker } from './worker.mjs';
import { Judge } from './judge.mjs';
import { TerminalLogger } from './terminal_logger.mjs';
import { FileLogger } from './file_logger.mjs';
import { raceEvents } from './common.mjs';
import { readFileSync } from 'node:fs';

export class Run {

    taskPath;
    worker;
    judgeCycleTime;
    judgeTimer;
    judgeFileLogger;
    workerFileLogger;

    constructor(taskPath, judgeCycleTime) {
        this.judgeFileLogger = new FileLogger("judge.log");
        this.judgeFileLogger.clearLogFile();
        this.workerFileLogger = new FileLogger("worker.log");
        this.workerFileLogger.clearLogFile();
        this.taskPath = taskPath;
        this.judgeCycleTime = judgeCycleTime;
    }

    setJudgeTimer(cycleTime) {
        clearTimeout(this.judgeTimer);
        this.judgeTimer = setTimeout(() => {
            this.processJudgeCycle()
                .catch(err => TerminalLogger.writeLine(`Judge cycle error: ${err.message}`, TerminalLogger.COLOR_ERROR));
        }, cycleTime * 1000);
    }

    async processJudgeCycle() {
        // start Judge process
        TerminalLogger.writeLine("Starting Judge process...", TerminalLogger.COLOR_DIM);
        const judge = new Judge(this.judgeFileLogger);

        // wait for it
        let verdict;
        try {
            await judge.start(this.taskPath, this.worker.sessionPath);
            if (judge.exited) {
                throw new Error("Judge exited already");
            }
            const [type, payload] = await raceEvents(
                [
                    { emitter: judge.eventEmitter, eventName: "done"},
                    { emitter: judge.eventEmitter, eventName: "exit"}
                ],
                this.judgeCycleTime * 1000,
                `Judge cycle timed out after ${this.judgeCycleTime}s`
            );
            if (type === "done") {
                verdict = payload[0];
                TerminalLogger.writeLine(`Judge verdict: ${verdict}`);
            } else if (type === "exit") {
                if (payload[0] === null) {
                    TerminalLogger.writeLine("Judge process failed to start", TerminalLogger.COLOR_ERROR);
                } else {
                    TerminalLogger.writeLine(`Judge exited: ${payload[0]}`);
                }
            }
        } catch (error) {
            if (judge.exited) {
                TerminalLogger.writeLine("Judge process failed to start", TerminalLogger.COLOR_ERROR);
            } else {
                judge.killProcess();
                TerminalLogger.writeLine(`Judge error: ${error.message}`, TerminalLogger.COLOR_ERROR);
            }
        }

        // act on verdict
        if (verdict) {
            const colonIndex = verdict.indexOf(':');
            const decision = (colonIndex === -1 ? verdict : verdict.slice(0, colonIndex)).trim();
            const decisionText = colonIndex === -1 ? "" : verdict.slice(colonIndex + 1).trim();
            if (decision === "OK") {
                // skip
            } else if (decision === "NUDGE") {
                if (!this.worker.settled && !this.worker.exited && decisionText)  {
                    try {
                        await this.worker.steer(decisionText);
                    } catch(err) {
                        TerminalLogger.writeLine(`NUDGE failed: ${err.message}`, TerminalLogger.COLOR_ERROR);
                    }
                }
            } else if (decision === "DISTILL") {
                // todo
            } else if (decision === "STOP") {
                // todo
            } else if (decision === "ERROR") {
                // skip
            } else {
                TerminalLogger.writeLine("Judge decision could not be parsed", TerminalLogger.COLOR_ERROR);
            }
        }
    }

    async launch() {
        TerminalLogger.writeLine("Starting Worker process...", TerminalLogger.COLOR_DIM);
        const taskText = readFileSync(this.taskPath, "utf8");
        this.worker = new Worker(this.workerFileLogger);
        // this.setJudgeTimer(this.judgeCycleTime);
        try {
            await this.worker.start(taskText);
        } catch (error) {
            if (this.worker.exited) {
                TerminalLogger.writeLine("Worker process failed to start", TerminalLogger.COLOR_ERROR);
            } else {
                this.worker.killProcess();
                TerminalLogger.writeLine(`Worker error: ${error.message}`, TerminalLogger.COLOR_ERROR);
            }
            return;
        }
        this.setJudgeTimer(0); // for now fires once at the beginning
    }

}
