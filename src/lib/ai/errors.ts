// Errors thrown by `callAi` (re-exported from ./client).

/** The model returned output that does not match the schema, twice in a row. */
export class AiOutputError extends Error {
  readonly callName: string;
  constructor(callName: string, reason: string) {
    super(`AI call "${callName}" returned invalid output: ${reason}`);
    this.name = "AiOutputError";
    this.callName = callName;
  }
}

/** The input cannot be sent to the API (file type, file size, call name). */
export class AiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiInputError";
  }
}
