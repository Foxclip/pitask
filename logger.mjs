import { styleText } from "node:util";

export class Logger {

    static COLOR_DIM = "#777777";
    static COLOR_ERROR = "red";
    
    static getCurrentTimeString() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const hours = pad(now.getHours());
        const minutes = pad(now.getMinutes());
        const seconds = pad(now.getSeconds());
        return `${hours}:${minutes}:${seconds}`;
    }

    static write(text, color) {
        if (color) {
            process.stdout.write(styleText(color, text));
        } else {
            process.stdout.write(text);
        }
    }

    static writeTime(color) {
        this.write(`[${this.getCurrentTimeString()}]`, color ?? this.COLOR_DIM);
    }

    static writeLine(line, color) {
        this.writeTime();
        this.write(" ");
        if (line) {
            this.write(`${line}\n`, color);
        } else {
            this.write("\n", color);
        }
    }

}

