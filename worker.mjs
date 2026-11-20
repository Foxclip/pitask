import { readFileSync } from "node:fs";
import { Session } from "./session.mjs";

export class Worker extends Session {
    
    taskPath;

    constructor(fileLogger) {
        super("Worker", fileLogger);
    }

    start(taskPath) {
        this.taskPath = taskPath;
        const taskText = readFileSync(this.taskPath, "utf8");
        const task = {
            id: "worker-task",
            type: "prompt",
            message: taskText
        };
        this.piProcess.stdin.write(JSON.stringify(task) + '\n');
    }

}
