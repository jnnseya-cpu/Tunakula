import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpenNow, parseWeekly, parseSpecial } from "../src/modules/catalogue/hours.ts";

// A fixed instant: 2026-10-08 is a Thursday; 13:00 UTC = 15:00 in Africa/Kinshasa (UTC+2).
const at = new Date("2026-10-08T13:00:00Z");
const TZ = "Africa/Kinshasa";

test("an empty schedule means always open", () => {
  assert.equal(isOpenNow({}, {}, at, TZ), true);
});

test("open only within the weekday window", () => {
  // Thursday = weekday 4. 15:00 local is inside 08:00–22:00.
  assert.equal(isOpenNow({ "4": [["08:00", "22:00"]] }, {}, at, TZ), true);
  // Outside the window.
  assert.equal(isOpenNow({ "4": [["16:00", "22:00"]] }, {}, at, TZ), false);
  // A day with no entry is closed.
  assert.equal(isOpenNow({ "0": [["08:00", "22:00"]] }, {}, at, TZ), false);
});

test("a special date override wins over the weekly schedule", () => {
  assert.equal(isOpenNow({ "4": [["08:00", "22:00"]] }, { "2026-10-08": [] }, at, TZ), false, "closed all day");
  assert.equal(isOpenNow({ "4": [["08:00", "09:00"]] }, { "2026-10-08": [["14:00", "16:00"]] }, at, TZ), true, "special window open");
});

test("multiple windows (lunch + dinner)", () => {
  assert.equal(isOpenNow({ "4": [["11:00", "14:00"], ["18:00", "22:00"]] }, {}, at, TZ), false, "15:00 is between services");
  assert.equal(isOpenNow({ "4": [["11:00", "16:00"], ["18:00", "22:00"]] }, {}, at, TZ), true);
});

test("validation rejects bad input", () => {
  assert.throws(() => parseWeekly({ "9": [] }), /0–6/);
  assert.throws(() => parseWeekly({ "1": [["25:00", "26:00"]] }), /HH:MM/);
  assert.throws(() => parseWeekly({ "1": [["22:00", "08:00"]] }), /opens before/);
  assert.throws(() => parseSpecial({ "not-a-date": [] }), /YYYY-MM-DD/);
  assert.deepEqual(parseWeekly({ "4": [["08:00", "22:00"]] }), { "4": [["08:00", "22:00"]] });
});
