import { describe, expect, it } from "vitest";
import { normalizeHostname } from "../src/utils/hostname.js";

describe("normalizeHostname", () => {
  it("normalizes safe custom hostnames", () => {
    expect(normalizeHostname("HTTPS://Book.Example.com/")).toBe("book.example.com");
  });

  it("rejects IPs, localhost, ports, paths, and malformed labels", () => {
    expect(normalizeHostname("localhost")).toBeNull();
    expect(normalizeHostname("127.0.0.1")).toBeNull();
    expect(normalizeHostname("book.example.com:8080")).toBeNull();
    expect(normalizeHostname("book.example.com/path")).toBeNull();
    expect(normalizeHostname("-book.example.com")).toBeNull();
  });
});
