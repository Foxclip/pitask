import { Session } from "./session.mjs";

export class Worker extends Session {

    constructor(fileLogger) {
        super("Worker", fileLogger);
    }

    async start(taskText) {
        await super.start();
        const args = {
            id: `worker-prompt-${++this.promptCount}`,
            type: "prompt",
            message: taskText
        };
        await this.rpcCall(args);
    }

}
