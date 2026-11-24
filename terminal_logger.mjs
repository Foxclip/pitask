import { styleText } from "node:util";
import { FileLogger } from "./file_logger.mjs";

export class TerminalLogger {

    static COLOR_DIM = "#777777";
    static COLOR_ERROR = "red";

    fileLogger;

    constructor(logFilename) {
        this.fileLogger = new FileLogger(logFilename);
    }
    
    getCurrentTimeString() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const hours = pad(now.getHours());
        const minutes = pad(now.getMinutes());
        const seconds = pad(now.getSeconds());
        return `${hours}:${minutes}:${seconds}`;
    }

    write(text, color) {
        if (color) {
            process.stdout.write(styleText(color, text));
        } else {
            process.stdout.write(text);
        }
    }

    writeTime(color) {
        this.write(`[${this.getCurrentTimeString()}]`, color ?? TerminalLogger.COLOR_DIM);
    }

    writeLine(line, color) {
        this.writeTime();
        this.write(" ");
        if (line) {
            this.write(`${line}\n`, color);
        } else {
            this.write("\n", color);
        }

        this.fileLogger.writeLine(line);
    }

    logNormal(line) {
        line ??= "";
        this.writeLine(line);
    }

    logDim(line) {
        line ??= "";
        this.writeLine(line, TerminalLogger.COLOR_DIM);
    }

    logError(line) {
        line ??= "";
        this.writeLine(line, TerminalLogger.COLOR_ERROR);
    }

}

