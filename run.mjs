import { Worker } from './worker.mjs';

export class Run {

    task;
    worker;
    judge;

    constructor(task) {
        this.task = task;
        console.log("Spawning Worker process...");
        this.worker = new Worker();
        console.log("Sending message to Worker...");
        this.worker.sendMessage(task);
    }

}
