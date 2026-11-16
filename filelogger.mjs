import { writeFileSync, appendFileSync } from "fs";

const logFile = "run.log";

export class FileLogger {
    
    static resetLogFile() {
        writeFileSync(logFile, "", "utf8");
    }

    static write(text) {
        appendFileSync(logFile, text, "utf8");
    }

    static writeIsoTime() {
        const isoTime = new Date().toISOString();
        this.write(`[${isoTime}]`);
    }

    static writeLine(line) {
        this.writeIsoTime();
        this.write(" ");
        this.write(`${line}\n`);
    }

}
