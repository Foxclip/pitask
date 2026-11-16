import { Worker } from './worker.mjs';
import { Logger } from './logger.mjs';

export class Run {

    task;
    worker;
    judge;

    constructor(task) {
        this.task = task;
        Logger.writeLine("Spawning Worker process...");
        this.worker = new Worker();
        Logger.writeLine("Sending message to Worker...", Logger.COLOR_DIM);
        this.worker.sendMessage(task);
        Logger.writeLine("Waiting response from Worker...", Logger.COLOR_DIM);
    }

}
