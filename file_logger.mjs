import { appendFileSync } from "fs";

export class FileLogger {

    filename;

    constructor(filename) {
        this.filename = filename;   
    }

    write(text) {
        appendFileSync(this.filename, text, "utf8");
    }

    writeIsoTime() {
        const isoTime = new Date().toISOString();
        this.write(`[${isoTime}]`);
    }

    writeLine(line) {
        this.writeIsoTime();
        this.write(" ");
        this.write(`${line}\n`);
    }

}
