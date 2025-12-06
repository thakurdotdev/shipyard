import { describe, it, expect } from "bun:test";
import { fc } from "@fast-check/vitest";
import { EnvService } from "./services/env-service";

describe("Encryption Utilities", () => {
  it("should encrypt and decrypt to the original value", () => {
    fc.assert(
      fc.property(fc.string(), (original) => {
        const encrypted = EnvService.encrypt(original);
        const decrypted = EnvService.decrypt(encrypted);
        expect(decrypted).toBe(original);

        // Ensure it's actually encrypted (unless empty string which might result in just IV/Tag)
        if (original.length > 0) {
          expect(encrypted).not.toBe(original);
          expect(encrypted).toContain(":");
        }
      }),
    );
  });

  it("should handle legacy plain text values", () => {
    fc.assert(
      fc.property(fc.string(), (original) => {
        // If it doesn't contain ':', it should return as is
        if (!original.includes(":")) {
          expect(EnvService.decrypt(original)).toBe(original);
        }
      }),
    );
  });
});
