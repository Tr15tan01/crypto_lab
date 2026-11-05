import { describe, expect, it } from "vitest";
import { UI_SCALE_INIT_SCRIPT, UI_SCALE_MAX, UI_SCALE_MIN, clampScale } from "@/lib/ui-scale";

describe("clampScale", () => {
  it("keeps the value inside the allowed range on 5% steps", () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(1.12)).toBe(1.1);
    expect(clampScale(1.13)).toBe(1.15);
    expect(clampScale(5)).toBe(UI_SCALE_MAX);
    expect(clampScale(0.1)).toBe(UI_SCALE_MIN);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it("init script only accepts in-range values", () => {
    expect(UI_SCALE_INIT_SCRIPT).toContain(`v>=${UI_SCALE_MIN}&&v<=${UI_SCALE_MAX}`);
  });
});
