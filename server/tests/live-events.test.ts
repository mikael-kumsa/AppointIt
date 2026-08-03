import { afterEach, describe, expect, it, vi } from "vitest";
import { addLiveClient, publishLiveEvent } from "../src/modules/live/live-events.js";

afterEach(() => vi.useRealTimers());

describe("live tenant events", () => {
  it("publishes only scoped resource changes", () => {
    vi.useFakeTimers();
    const vendorWrite = vi.fn();
    const otherWrite = vi.fn();
    const removeVendor = addLiveClient("vendor-1", { write: vendorWrite } as any);
    expect(vendorWrite).toHaveBeenCalledWith(expect.stringContaining("event: ready"));
    const removeOther = addLiveClient("vendor-2", { write: otherWrite } as any);
    vendorWrite.mockClear(); otherWrite.mockClear();
    publishLiveEvent("vendor-1", ["appointments", "appointments", "customers"]);
    expect(vendorWrite).toHaveBeenCalledWith(expect.stringContaining('"resources":["appointments","customers"]'));
    expect(otherWrite).not.toHaveBeenCalled();
    removeVendor(); removeOther();
  });
});
