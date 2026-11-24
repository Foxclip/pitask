import { Worker } from './worker.mjs';
import { Judge } from './judge.mjs';
import { TerminalLogger } from './terminal_logger.mjs';
import { FileLogger } from './file_logger.mjs';
import { raceEvents } from './common.mjs';
import { readFileSync } from 'node:fs';

export class Run {

    runDir;
    taskPath;
    worker;
    judgeCycleTime;
    judgeTimer;
    terminalLogger;
    judgeFileLogger;
    workerFileLogger;

    constructor(runDir, taskPath, judgeCycleTime) {
        this.runDir = runDir;
        this.terminalLogger = new TerminalLogger(`${runDir}/terminal.log`);
        this.judgeFileLogger = new FileLogger(`${runDir}/judge.log`);
        this.workerFileLogger = new FileLogger(`${runDir}/worker.log`);
        this.taskPath = taskPath;
        this.judgeCycleTime = judgeCycleTime;
    }

    setJudgeTimer(cycleTime) {
        clearTimeout(this.judgeTimer);
        this.judgeTimer = setTimeout(() => {
            this.processJudgeCycle()
                .catch(err => this.terminalLogger.logError(`Judge cycle error: ${err.message}`));
        }, cycleTime * 1000);
    }

    async processJudgeCycle() {
        // start Judge process
        this.terminalLogger.logDim("Starting Judge process...");
        const judge = new Judge(this.terminalLogger, this.judgeFileLogger);

        // wait for it
        let verdict;
        try {
            await judge.start(this.runDir, this.taskPath, this.worker.sessionPath);
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
                this.terminalLogger.logNormal(`Judge verdict: ${verdict}`);
            } else if (type === "exit") {
                if (payload[0] === null) {
                    this.terminalLogger.logError("Judge process failed to start");
                } else {
                    this.terminalLogger.logNormal(`Judge exited: ${payload[0]}`);
                }
            }
        } catch (error) {
            if (judge.exited) {
                this.terminalLogger.logError("Judge process failed to start");
            } else {
                judge.killProcess();
                this.terminalLogger.logError(`Judge error: ${error.message}`);
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
                        this.terminalLogger.logError(`NUDGE failed: ${err.message}`);
                    }
                }
            } else if (decision === "DISTILL") {
                // todo
            } else if (decision === "STOP") {
                // todo
            } else if (decision === "ERROR") {
                // skip
            } else {
                this.terminalLogger.logError("Judge decision could not be parsed");
            }
        }
    }

    async launch() {
        this.terminalLogger.logDim("Starting Worker process...");
        const taskText = readFileSync(this.taskPath, "utf8");
        this.worker = new Worker(this.terminalLogger, this.workerFileLogger);
        try {
            await this.worker.start(taskText);
        } catch (error) {
            if (this.worker.exited) {
                this.terminalLogger.logError("Worker process failed to start");
            } else {
                this.worker.killProcess();
                this.terminalLogger.logError(`Worker error: ${error.message}`);
            }
            return;
        }
        this.setJudgeTimer(0); // for now fires once at the beginning
    }

}
