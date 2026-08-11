// Stand-ins for the Next runtime modules that only exist inside a request.
//
// `next/headers` and `next/navigation` cannot be imported by a plain Node script, but the pure
// functions in lib/auth.ts sit in the same module as the ones that use them. The named exports
// have to exist for the ESM import to resolve; they throw if anything actually calls them, so a
// test can never silently exercise a fake request context. See ts-resolve-hook.mjs.
const unavailable = (name) => () => { throw new Error(`${name}() is only available during a request.`); };

export const cookies = unavailable("cookies");
export const headers = unavailable("headers");
export const draftMode = unavailable("draftMode");
export const redirect = unavailable("redirect");
export const notFound = unavailable("notFound");
