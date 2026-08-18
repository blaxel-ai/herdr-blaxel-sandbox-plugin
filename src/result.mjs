export class PluginError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "PluginError";
    this.code = code;
    this.details = options.details;
  }
}

export function errorCode(error) {
  if (error instanceof PluginError) return error.code;
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }
  return "unexpected_error";
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    if (typeof error.message === "string") return error.message;
    if (typeof error.error === "string") return error.error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export function emitResult(action, status, data = {}) {
  const result = {
    schemaVersion: 1,
    plugin: "blaxel.sandbox",
    action,
    status,
    at: new Date().toISOString(),
    ...data,
  };
  process.stdout.write(`BLAXEL_RESULT ${JSON.stringify(result)}\n`);
  return result;
}

export function emitFailure(action, error) {
  const data = {
    code: errorCode(error),
    message: errorMessage(error),
  };
  if (error instanceof PluginError && error.details !== undefined) {
    data.details = error.details;
  }
  return emitResult(action, "failed", data);
}
