import { describe, it, expect } from "vitest";
import {
  addBusinessMinutes,
  businessMinutesBetween,
  parseHours,
  ALWAYS_OPEN,
  type BusinessCalendar,
} from "@/lib/sla/calendar";

const nineToSix: [number, number] = [540, 1080];
const weekdays = (tz: string, holidays: string[] = []): BusinessCalendar => ({
  enabled: true,
  timezone: tz,
  week: [null, nineToSix, nineToSix, nineToSix, nineToSix, nineToSix, null],
  holidays: new Set(holidays),
});
const KL = weekdays("Asia/Kuala_Lumpur");
const at = (iso: string) => new Date(iso);

describe("parseHours", () => {
  it("reads a window", () => {
    expect(parseHours("09:00-18:00")).toEqual([540, 1080]);
    expect(parseHours("00:00-24:00")).toEqual([0, 1440]);
  });
  it("treats empty or broken values as closed", () => {
    expect(parseHours("")).toBeNull();
    expect(parseHours("18:00-09:00")).toBeNull();
    expect(parseHours("9am-5pm")).toBeNull();
  });
});

describe("addBusinessMinutes", () => {
  it("stays inside the same day", () => {
    expect(addBusinessMinutes(at("2026-10-05T02:00:00Z"), 120, KL)).toEqual(at("2026-10-05T04:00:00Z"));
  });

  it("carries over to the next morning", () => {
    // mon 17:00 + 2h = tue 10:00 KL
    expect(addBusinessMinutes(at("2026-10-05T09:00:00Z"), 120, KL)).toEqual(at("2026-10-06T02:00:00Z"));
  });

  it("skips the weekend", () => {
    // fri 17:00 + 2h = mon 10:00 KL
    expect(addBusinessMinutes(at("2026-10-09T09:00:00Z"), 120, KL)).toEqual(at("2026-10-12T02:00:00Z"));
  });

  it("starts at opening time when created on a weekend", () => {
    expect(addBusinessMinutes(at("2026-10-10T04:00:00Z"), 30, KL)).toEqual(at("2026-10-12T01:30:00Z"));
  });

  it("starts at opening time when created before hours", () => {
    // mon 07:00 KL + 1h = mon 10:00 KL
    expect(addBusinessMinutes(at("2026-10-04T23:00:00Z"), 60, KL)).toEqual(at("2026-10-05T02:00:00Z"));
  });

  it("skips holidays", () => {
    const cal = weekdays("Asia/Kuala_Lumpur", ["2026-10-06"]);
    expect(addBusinessMinutes(at("2026-10-05T09:00:00Z"), 120, cal)).toEqual(at("2026-10-07T02:00:00Z"));
  });

  it("follows a clock change", () => {
    // fri 17:00 BST + 2h = mon 10:00 GMT
    const london = weekdays("Europe/London");
    expect(addBusinessMinutes(at("2026-10-23T16:00:00Z"), 120, london)).toEqual(at("2026-10-26T10:00:00Z"));
  });

  it("uses wall time when business hours are off", () => {
    expect(addBusinessMinutes(at("2026-10-10T04:00:00Z"), 90, ALWAYS_OPEN)).toEqual(at("2026-10-10T05:30:00Z"));
  });

  it("falls back to UTC for an unknown zone", () => {
    const cal = { ...weekdays("Not/AZone") };
    expect(addBusinessMinutes(at("2026-10-05T10:00:00Z"), 60, cal)).toEqual(at("2026-10-05T11:00:00Z"));
  });
});

describe("businessMinutesBetween", () => {
  it("counts only open time", () => {
    expect(businessMinutesBetween(at("2026-10-05T09:00:00Z"), at("2026-10-06T02:00:00Z"), KL)).toBe(120);
    expect(businessMinutesBetween(at("2026-10-09T09:00:00Z"), at("2026-10-12T02:00:00Z"), KL)).toBe(120);
  });

  it("is zero when the end is not after the start", () => {
    expect(businessMinutesBetween(at("2026-10-06T02:00:00Z"), at("2026-10-05T02:00:00Z"), KL)).toBe(0);
  });

  it("matches addBusinessMinutes", () => {
    const start = at("2026-10-08T05:13:00Z");
    const end = addBusinessMinutes(start, 1000, KL);
    expect(businessMinutesBetween(start, end, KL)).toBe(1000);
  });
});
