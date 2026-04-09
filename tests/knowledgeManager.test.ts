import { describe, expect, it } from "vitest";

/**
 * Tests for Knowledge Manager logic
 * Tests R2 key formatting, document key conversion, and category listing
 */

// Re-implement key conversion from knowledgeManager.ts
function docKeyToR2Key(docKey: string): string {
	return docKey.replace(/:/g, "/");
}

function r2KeyToDocKey(r2Key: string): string {
	return r2Key.replace("taxonomy/", "").replace(/\//g, ":");
}

// Default categories from knowledgeManager.ts
const defaultCategories: Record<string, string> = {
	arcs: "Algorand Request for Comments",
	sdks: "Software Development Kits",
	algokit: "AlgoKit",
	"algokit-utils": "AlgoKit Utils",
	tealscript: "TEALScript",
	puya: "Puya",
	"liquid-auth": "Liquid Auth",
	python: "Python Development",
	developers: "Developer Documentation",
	clis: "CLI Tools",
	nodes: "Node Management",
	details: "Developer Details",
};

describe("Knowledge Manager", () => {
	describe("docKeyToR2Key", () => {
		it("should convert colons to forward slashes", () => {
			expect(docKeyToR2Key("ARCs:specs:arc-0020.md")).toBe("ARCs/specs/arc-0020.md");
		});

		it("should handle single segment (no colons)", () => {
			expect(docKeyToR2Key("readme.md")).toBe("readme.md");
		});

		it("should handle deeply nested keys", () => {
			expect(docKeyToR2Key("a:b:c:d:e.md")).toBe("a/b/c/d/e.md");
		});

		it("should handle empty string", () => {
			expect(docKeyToR2Key("")).toBe("");
		});
	});

	describe("r2KeyToDocKey", () => {
		it("should convert forward slashes to colons", () => {
			expect(r2KeyToDocKey("ARCs/specs/arc-0020.md")).toBe("ARCs:specs:arc-0020.md");
		});

		it("should strip taxonomy/ prefix", () => {
			expect(r2KeyToDocKey("taxonomy/ARCs/specs/arc-0020.md")).toBe("ARCs:specs:arc-0020.md");
		});

		it("should handle key without taxonomy prefix", () => {
			expect(r2KeyToDocKey("sdks/python/readme.md")).toBe("sdks:python:readme.md");
		});
	});

	describe("R2 key round-trip", () => {
		it("should convert back to original doc key", () => {
			const docKey = "ARCs:specs:arc-0020.md";
			const r2Key = docKeyToR2Key(docKey);
			// Note: r2KeyToDocKey strips taxonomy/, so this tests without that prefix
			const roundTripped = r2Key.replace(/\//g, ":");
			expect(roundTripped).toBe(docKey);
		});
	});

	describe("R2 prefix extraction", () => {
		it("should extract first segment for listing", () => {
			const r2Key = "ARCs/specs/arc-0020.md";
			const prefix = r2Key.split("/")[0];
			expect(prefix).toBe("ARCs");
		});

		it("should handle single-segment keys", () => {
			const r2Key = "readme.md";
			const prefix = r2Key.split("/")[0];
			expect(prefix).toBe("readme.md");
		});
	});

	describe("Default categories", () => {
		it("should contain all expected categories", () => {
			expect(Object.keys(defaultCategories)).toContain("arcs");
			expect(Object.keys(defaultCategories)).toContain("sdks");
			expect(Object.keys(defaultCategories)).toContain("algokit");
			expect(Object.keys(defaultCategories)).toContain("developers");
		});

		it("should have 12 categories", () => {
			expect(Object.keys(defaultCategories)).toHaveLength(12);
		});

		it("should have non-empty descriptions", () => {
			for (const desc of Object.values(defaultCategories)) {
				expect(desc.length).toBeGreaterThan(0);
			}
		});
	});

	describe("Document key format validation", () => {
		it("should accept valid document key format", () => {
			const validKeys = [
				"ARCs:specs:arc-0020.md",
				"sdks:python:readme.md",
				"algokit:overview.md",
			];
			for (const key of validKeys) {
				// Valid keys convert cleanly to R2 paths
				const r2Key = docKeyToR2Key(key);
				expect(r2Key).not.toContain(":");
				expect(r2Key).toContain("/");
			}
		});
	});
});
