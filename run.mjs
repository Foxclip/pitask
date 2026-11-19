import { Worker } from './worker.mjs';
import { Judge } from './judge.mjs';
import { Logger } from './logger.mjs';
import { FileLogger } from './filelogger.mjs';
import { writeFileSync } from 'node:fs';
import { once } from 'node:events';

export class Run {

    taskPath;
    worker;
    judgeCycleTime;
    judgeTimer;
    workerSessionPath;

    constructor(taskPath, judgeCycleTime) {
        FileLogger.resetLogFile();
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
        Logger.writeLine("Starting Judge process...");
        const judge = new Judge(this.taskPath, this.workerSessionPath);
        const [verdict] = await once(judge.eventEmitter, "done");
        Logger.writeLine(`Judge verdict: ${verdict}`);
    }

    async launch() {
        Logger.writeLine("Starting Worker process...");
        this.worker = new Worker(this.taskPath);
        this.workerSessionPath = await this.worker.getSessionPath();
        Logger.writeLine(`Session: ${this.workerSessionPath}`, Logger.COLOR_DIM);
        // this.setJudgeTimer(this.judgeCycleTime);
        this.setJudgeTimer(0);
        this.worker.start();
    }

}
