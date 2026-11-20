import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["tests/**/*.test.ts"],
		testTimeout: 30000,
	},
	resolve: {
		alias: {
			algosdk: "algosdk",
			// The Workers runtime module, which Node lacks (src/oauth-provider.ts, src/pending-logins.ts)
			"cloudflare:workers": fileURLToPath(
				new URL("./tests/stubs/cloudflare-workers.ts", import.meta.url),
			),
		},
	},
});
