/**
 * Registers the `@/` alias resolver. Test infrastructure only.
 *
 * Used as `node --import ./scripts/register-alias.mjs <script>`, so the hooks are in place
 * before the test file's own imports are resolved.
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);
