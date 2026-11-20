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
        TerminalLogger.writeLine("Starting Judge process...");
        const judge = new Judge(this.judgeFileLogger);
        judge.start(this.taskPath, this.workerSessionPath);
        try {
            const [verdict] = await once(judge.eventEmitter, "done", {
                signal: AbortSignal.timeout(30 * 60 * 1000)
            });
            TerminalLogger.writeLine(`Judge verdict: ${verdict}`);
        } catch (error) {
            judge.killProcess();
            TerminalLogger.write(`Judge error: ${error.message}`, TerminalLogger.COLOR_ERROR);
        }
    }

    async launch() {
        TerminalLogger.writeLine("Starting Worker process...");
        this.worker = new Worker(this.workerFileLogger);
        this.workerSessionPath = await this.worker.getSessionPath();
        TerminalLogger.writeLine(`Session: ${this.workerSessionPath}`, TerminalLogger.COLOR_DIM);
        // this.setJudgeTimer(this.judgeCycleTime);
        this.setJudgeTimer(0);
        this.worker.start(this.taskPath);
    }

}
