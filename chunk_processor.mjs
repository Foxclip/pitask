import { TerminalLogger } from "./terminal_logger.mjs";

export class ChunkProcessor {

    lineBuffer = "";

    getRecords(chunk) {
        this.lineBuffer += chunk.toString('utf8');
        let lineEndIndex;
        let records = [];
        while((lineEndIndex = this.lineBuffer.indexOf('\n')) !== -1) {
            let line = this.lineBuffer.slice(0, lineEndIndex);
            this.lineBuffer = this.lineBuffer.slice(lineEndIndex + 1);
            // Strip optional preceding carriage return to handle CRLF safely
            if (line.endsWith('\r')) {
                line = line.slice(0, -1);
            }
            if (line === "") {
                continue;
            };

            let record;
            try {
                record = JSON.parse(line);
                records.push(record);
            } catch (err) {
                TerminalLogger.writeLine(`Failed to parse JSON record: ${line}`, TerminalLogger.COLOR_ERROR);
            }
        }
        return records;
    }
}

