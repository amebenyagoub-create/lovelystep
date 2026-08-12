// Lets test scripts import the app's TypeScript modules directly.
//
// The app uses TypeScript's "bundler" module resolution, so relative imports are written
// without a file extension. Plain Node ESM requires one. This hook appends ".ts" for relative
// specifiers that would otherwise fail, so tests can exercise the real source instead of a
// hand-copied mirror of it. Test-only: the application never loads this.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-resolve-hook-impl.mjs", pathToFileURL("./scripts/"));
