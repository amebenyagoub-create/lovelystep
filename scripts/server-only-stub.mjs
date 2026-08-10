// Stub for the `server-only` package, used by test scripts.
//
// `server-only` is not a real dependency: Next's bundler aliases it and errors if a client
// bundle imports it. Test scripts run server modules in plain Node, which is exactly the
// context the guard permits, so resolving it to an empty module is correct here.
export {};
