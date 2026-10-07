import { describe, it, expect } from "vitest";
import { toImageBox } from "@/lib/attachments/client";

describe("toImageBox", () => {
  it("scales from the shown size to the real size", () => {
    expect(toImageBox({ x: 10, y: 20, w: 50, h: 10 }, { width: 400, height: 200 }, { width: 800, height: 400 })).toEqual({
      x: 20,
      y: 40,
      w: 100,
      h: 20,
    });
  });

  it("handles a box drawn backwards", () => {
    expect(toImageBox({ x: 60, y: 30, w: -50, h: -10 }, { width: 400, height: 200 }, { width: 400, height: 200 })).toEqual({
      x: 10,
      y: 20,
      w: 50,
      h: 10,
    });
  });

  it("clamps to the image", () => {
    const b = toImageBox({ x: 380, y: 190, w: 100, h: 100 }, { width: 400, height: 200 }, { width: 400, height: 200 });
    expect(b.x + b.w).toBeLessThanOrEqual(400);
    expect(b.y + b.h).toBeLessThanOrEqual(200);
  });
});
