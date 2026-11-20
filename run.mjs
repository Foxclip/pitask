import { Worker } from './worker.mjs';
import { Judge } from './judge.mjs';
import { TerminalLogger } from './terminal_logger.mjs';
import { FileLogger } from './file_logger.mjs';
import { once } from 'node:events';

export class Run {

    taskPath;
    worker;
    judgeCycleTime;
    judgeTimer;
    workerSessionPath;
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
            this.processJudgeCycle();
        }, cycleTime * 1000);
    }

    async processJudgeCycle() {
        TerminalLogger.writeLine("Starting Judge process...", TerminalLogger.COLOR_DIM);
        const judge = new Judge(this.judgeFileLogger);
        judge.start(this.taskPath, this.workerSessionPath);
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Timeout exceeded")), 30 * 60 * 1000);
        });
        try {
            if (judge.exited) {
                throw new Error("Judge exited already");
            }
            const [type, [payload]] = await Promise.race([
                once(judge.eventEmitter, "done").then(p => ["done", p]),
                once(judge.eventEmitter, "exit").then(p => ["exit", p]),
                timeout
            ]);
            if (type === "done") {
                TerminalLogger.writeLine(`Judge verdict: ${payload}`);
            } else if (type === "exit") {
                if (payload === null) {
                    TerminalLogger.writeLine("Judge process failed to start", TerminalLogger.COLOR_ERROR);
                } else {
                    TerminalLogger.writeLine(`Judge exited: ${payload}`);
                }
            }
        } catch (error) {
            judge.killProcess();
            TerminalLogger.write(`Judge error: ${error.message}`, TerminalLogger.COLOR_ERROR);
        } finally {
            clearTimeout(timer);
        }
    }

    async launch() {
        TerminalLogger.writeLine("Starting Worker process...", TerminalLogger.COLOR_DIM);
        this.worker = new Worker(this.workerFileLogger);
        this.workerSessionPath = await this.worker.getSessionPath();
        // this.setJudgeTimer(this.judgeCycleTime);
        this.setJudgeTimer(0);
        this.worker.start(this.taskPath);
    }

}
