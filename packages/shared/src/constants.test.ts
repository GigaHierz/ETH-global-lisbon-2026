import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODEL,
  SMALL_MODEL,
  DEFAULT_EXCHANGE_ASK,
  DEFAULT_EXCHANGE_URL,
  PROVIDER_PORTS,
  localhostUrl,
  DEFAULT_PROVIDER_URLS,
} from "./constants.js";

describe("shared constants", () => {
  it("pins the model ids and exchange defaults", () => {
    expect(DEFAULT_MODEL).toBe("llama-3.3-70b-versatile");
    expect(SMALL_MODEL).toBe("llama-3.1-8b-instant");
    expect(DEFAULT_EXCHANGE_ASK).toBe(0.12);
    expect(DEFAULT_EXCHANGE_URL).toBe("http://localhost:4100");
  });

  it("defines the four provider ports", () => {
    expect(PROVIDER_PORTS).toEqual([4021, 4022, 4023, 4024]);
  });

  it("builds localhost urls", () => {
    expect(localhostUrl(4021)).toBe("http://localhost:4021");
  });

  it("seeds discovery with the first three provider urls", () => {
    expect(DEFAULT_PROVIDER_URLS).toEqual([
      "http://localhost:4021",
      "http://localhost:4022",
      "http://localhost:4023",
    ]);
  });
});
