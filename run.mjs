import { Worker } from './worker.mjs';
import { Judge } from './judge.mjs';
import { TerminalLogger } from './terminal_logger.mjs';
import { FileLogger } from './file_logger.mjs';
import { raceEvents } from './common.mjs';
import { existsSync, readFileSync } from 'node:fs';

export class Run {

    runDir;
    taskPath;
    worker;
    judgeCycleTime;
    judgeTimer;
    terminalLogger;
    judgeFileLogger;
    workerFileLogger;
    nudgeCount = 0;
    distillCount = 0;

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
            await judge.start({
                runDir: this.runDir,
                taskPath: this.taskPath,
                workerSessionPath: this.worker.sessionPath,
                nudgeCount: this.nudgeCount,
                distillCount: this.distillCount
            });
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
                const nudgeFilename = `${this.runDir}/NUDGE-${this.nudgeCount + 1}.md`;
                if (this.worker.settled || this.worker.exited) {
                    this.terminalLogger.logError("NUDGE failed: Worker exited");
                } else if (!existsSync(nudgeFilename)) {
                    this.terminalLogger.logError(`NUDGE failed: ${nudgeFilename} does not exist`);
                } else {
                    try {
                        const nudgeText = readFileSync(nudgeFilename, "utf8");
                        this.terminalLogger.logDim("Sending steer message to Worker...");
                        await this.worker.steer(nudgeText);
                        this.nudgeCount++;
                    } catch(err) {
                        this.terminalLogger.logError(`NUDGE failed: ${err.message}`);
                    }
                }
            } else if (decision === "DISTILL") {
                if (this.worker.exited) {
                    this.terminalLogger.logError("DISTILL failed: Worker exited");
                } else {
                    const distillFilename = `${this.runDir}/DISTILL-${this.distillCount + 1}.md`;
                    if (!existsSync(distillFilename)) {
                        this.terminalLogger.logError(`DISTILL failed: ${distillFilename} does not exist`);
                    } else {
                        try {
                            const distillText = readFileSync(distillFilename, "utf8");
                            this.terminalLogger.logDim("Starting new session...");
                            await this.worker.newSession();
                            this.terminalLogger.logDim("Sending prompt to Worker...");
                            await this.worker.sendPrompt(distillText);
                            this.distillCount++;
                        } catch(err) {
                            this.terminalLogger.logError(`DISTILL failed: ${err.message}`);
                        }
                    }
                }
            } else if (decision === "STOP") {
                this.terminalLogger.logDim("Stopping Worker...");
                this.worker.killProcess();
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
