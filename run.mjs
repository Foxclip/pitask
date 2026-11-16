import { Worker } from './worker.mjs';
import { Logger } from './logger.mjs';
import { writeFileSync } from 'node:fs';

export class Run {

    task;
    worker;
    judge;

    constructor(task) {
        writeFileSync("run.log", "", "utf8");
        this.task = task;
        Logger.writeLine("Starting Worker process...");
        this.worker = new Worker();
        Logger.writeLine("Sending message to Worker...", Logger.COLOR_DIM);
        this.worker.sendMessage(task);
    }

}
