import { beforeEach, describe, expect, it } from "vitest";
import { ResponseProcessor } from "../src/utils/responseProcessor";

describe("ResponseProcessor", () => {
	beforeEach(() => {
		ResponseProcessor.setItemsPerPage(10);
	});

	describe("setItemsPerPage", () => {
		it("should set the items per page", () => {
			ResponseProcessor.setItemsPerPage(5);
			// Verify by creating a response with 6 items - should paginate
			const items = Array.from({ length: 6 }, (_, i) => i);
			const result = ResponseProcessor.processResponse(items);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.metadata).toBeDefined();
			expect(parsed.metadata.itemsPerPage).toBe(5);
		});
	});

	describe("processResponse - simple values", () => {
		it("should wrap a string value in data property", () => {
			const result = ResponseProcessor.processResponse("hello");
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data).toBe("hello");
		});

		it("should wrap a number value in data property", () => {
			const result = ResponseProcessor.processResponse(42);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data).toBe(42);
		});

		it("should wrap null in data property", () => {
			const result = ResponseProcessor.processResponse(null);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data).toBe(null);
		});

		it("should wrap boolean in data property", () => {
			const result = ResponseProcessor.processResponse(true);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data).toBe(true);
		});
	});

	describe("processResponse - objects", () => {
		it("should wrap an object in data property", () => {
			const obj = { address: "ABC123", balance: 1000 };
			const result = ResponseProcessor.processResponse(obj);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data).toEqual(obj);
		});

		it("should not add metadata for small objects", () => {
			const obj = { a: 1, b: 2, c: 3 };
			const result = ResponseProcessor.processResponse(obj);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.metadata).toBeUndefined();
		});

		it("should return content array with text type", () => {
			const result = ResponseProcessor.processResponse({ key: "value" });
			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe("text");
		});
	});

	describe("processResponse - arrays", () => {
		it("should wrap a small array without pagination metadata", () => {
			const arr = [1, 2, 3];
			const result = ResponseProcessor.processResponse(arr);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data).toEqual(arr);
			expect(parsed.metadata).toBeUndefined();
		});

		it("should paginate a large array", () => {
			const arr = Array.from({ length: 25 }, (_, i) => i);
			const result = ResponseProcessor.processResponse(arr);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data).toHaveLength(10);
			expect(parsed.metadata).toBeDefined();
			expect(parsed.metadata.totalItems).toBe(25);
			expect(parsed.metadata.currentPage).toBe(1);
			expect(parsed.metadata.totalPages).toBe(3);
			expect(parsed.metadata.hasNextPage).toBe(true);
			expect(parsed.metadata.pageToken).toBeDefined();
		});

		it("should return second page with pageToken", () => {
			const arr = Array.from({ length: 25 }, (_, i) => i);
			// Get the first page to get the token
			const firstResult = ResponseProcessor.processResponse(arr);
			const firstParsed = JSON.parse(firstResult.content[0].text);
			const pageToken = firstParsed.metadata.pageToken;

			// Get the second page
			const secondResult = ResponseProcessor.processResponse(arr, pageToken);
			const secondParsed = JSON.parse(secondResult.content[0].text);
			expect(secondParsed.data).toHaveLength(10);
			expect(secondParsed.metadata.currentPage).toBe(2);
			expect(secondParsed.data[0]).toBe(10);
		});

		it("should handle last page correctly", () => {
			ResponseProcessor.setItemsPerPage(10);
			const arr = Array.from({ length: 15 }, (_, i) => i);
			// Get page 2 token
			const page2Token = btoa("page_2");
			const result = ResponseProcessor.processResponse(arr, page2Token);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data).toHaveLength(5);
			expect(parsed.metadata.hasNextPage).toBe(false);
			expect(parsed.metadata.pageToken).toBeUndefined();
		});
	});

	describe("processResponse - objects with array fields", () => {
		it("should paginate array fields within objects", () => {
			const obj = {
				name: "test",
				items: Array.from({ length: 15 }, (_, i) => ({ id: i })),
			};
			const result = ResponseProcessor.processResponse(obj);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data.items).toHaveLength(10);
			expect(parsed.metadata).toBeDefined();
			expect(parsed.metadata.arrayField).toBe("items");
			expect(parsed.metadata.totalItems).toBe(15);
		});

		it("should handle objects with nested arrays that get recursively processed", () => {
			// When an object has array fields exceeding page size, those get paginated
			// and the response includes metadata about which field was paginated
			const obj = {
				name: "test-app",
				accounts: Array.from({ length: 5 }, (_, i) => ({ addr: `addr${i}` })),
			};
			const result = ResponseProcessor.processResponse(obj);
			const parsed = JSON.parse(result.content[0].text);
			// Small array should not be paginated
			expect(parsed.data.accounts).toHaveLength(5);
			expect(parsed.metadata).toBeUndefined();
		});
	});

	describe("processResponse - custom page size", () => {
		it("should respect custom page size", () => {
			ResponseProcessor.setItemsPerPage(3);
			const arr = Array.from({ length: 10 }, (_, i) => i);
			const result = ResponseProcessor.processResponse(arr);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data).toHaveLength(3);
			expect(parsed.metadata.totalPages).toBe(4);
			expect(parsed.metadata.itemsPerPage).toBe(3);
		});
	});

	describe("page token encoding/decoding", () => {
		it("should handle invalid page tokens gracefully", () => {
			const arr = Array.from({ length: 15 }, (_, i) => i);
			const result = ResponseProcessor.processResponse(arr, "invalid_token");
			const parsed = JSON.parse(result.content[0].text);
			// Should default to page 1 on invalid token
			expect(parsed.metadata.currentPage).toBe(1);
		});
	});

	describe("BigInt serialization", () => {
		it("should serialize objects containing BigInt values", () => {
			const obj = {
				amount: BigInt(1000000),
				address: "TESTADDR",
				balance: BigInt(5000000),
			};
			const result = ResponseProcessor.processResponse(obj);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data.amount).toBe(1000000);
			expect(parsed.data.balance).toBe(5000000);
			expect(parsed.data.address).toBe("TESTADDR");
		});

		it("should serialize arrays containing BigInt values", () => {
			const arr = [{ amount: BigInt(100) }, { amount: BigInt(200) }];
			const result = ResponseProcessor.processResponse(arr);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data[0].amount).toBe(100);
			expect(parsed.data[1].amount).toBe(200);
		});

		it("should convert very large BigInts to strings", () => {
			const obj = { bigValue: BigInt("99999999999999999999") };
			const result = ResponseProcessor.processResponse(obj);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data.bigValue).toBe("99999999999999999999");
		});

		it("should handle nested objects with BigInt values", () => {
			const obj = {
				accounts: [
					{
						address: "ADDR1",
						amount: BigInt(3000000),
						assets: [{ assetId: 31566704, amount: BigInt(500) }],
					},
				],
			};
			const result = ResponseProcessor.processResponse(obj);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.data.accounts[0].amount).toBe(3000000);
			expect(parsed.data.accounts[0].assets[0].amount).toBe(500);
		});
	});
});
