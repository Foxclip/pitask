import { Worker } from './worker.mjs';
import { Logger } from './logger.mjs';
import { FileLogger } from './filelogger.mjs';
import { writeFileSync } from 'node:fs';

export class Run {

    task;
    worker;
    judge;
    sessionPath;

    constructor(task) {
        FileLogger.resetLogFile();
        this.task = task;
    }

    async launch() {
        Logger.writeLine("Starting Worker process...");
        this.worker = new Worker();
        this.sessionPath = await this.worker.getSessionPath();
        Logger.writeLine(`Session: ${this.sessionPath}`, Logger.COLOR_DIM);
        this.worker.sendMessage(this.task);
    }

}
