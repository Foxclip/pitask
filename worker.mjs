import { Session } from "./session.mjs";

export class Worker extends Session {

    constructor(terminalLogger, fileLogger) {
        super("Worker", terminalLogger, fileLogger);
    }

    async start(taskText) {
        await super.start();
        await this.sendPrompt(taskText);
    }

}
