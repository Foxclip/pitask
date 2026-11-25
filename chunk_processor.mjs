export class ChunkProcessor {

    terminalLogger;
    lineBuffer = "";

    constructor(terminalLogger) {
        this.terminalLogger = terminalLogger;
    }

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
                this.terminalLogger?.logError(`Failed to parse JSON record: ${line}`);
            }
        }
        return records;
    }
}

