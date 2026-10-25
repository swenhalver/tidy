import { expect, test } from "bun:test";
import { centeredBounds, findDisplay, requestedDisplay } from "./window-display";

const builtIn = { id: 1, label: "Color LCD", workArea: { x: 0, y: 25, width: 1728, height: 1092 } };
const external = {
  id: 7,
  label: "S-Space",
  workArea: { x: 1728, y: -200, width: 2560, height: 1415 },
};
const displays = [builtIn, external];

test("the display comes from either argument form, then TIDY_DISPLAY", () => {
  expect(requestedDisplay(["Tidy", "--display=S-Space"], {})).toBe("S-Space");
  expect(requestedDisplay(["Tidy", "--display", "S-Space"], { TIDY_DISPLAY: "main" })).toBe(
    "S-Space",
  );
  expect(requestedDisplay(["Tidy"], { TIDY_DISPLAY: " 2 " })).toBe("2");
  expect(requestedDisplay(["Tidy", "--display="], {})).toBeNull();
  expect(requestedDisplay(["Tidy", "--display"], {})).toBeNull();
  expect(requestedDisplay(["Tidy"], {})).toBeNull();
});

test("displays match by name, main, ID or 1-based position", () => {
  expect(findDisplay(displays, builtIn, "S-Space")).toBe(external);
  expect(findDisplay(displays, builtIn, "s-space")).toBe(external);
  expect(findDisplay(displays, external, "main")).toBe(external);
  expect(findDisplay(displays, builtIn, "7")).toBe(external);
  expect(findDisplay(displays, builtIn, "2")).toBe(external);
  expect(findDisplay(displays, builtIn, "3")).toBeNull();
  expect(findDisplay(displays, builtIn, "Projector")).toBeNull();
});

test("windows are centered in the display's usable area and never larger than it", () => {
  expect(centeredBounds(external, 1200, 800)).toEqual({
    x: 1728 + 680,
    y: -200 + 308,
    width: 1200,
    height: 800,
  });
  expect(
    centeredBounds({ ...builtIn, workArea: { x: 0, y: 0, width: 1000, height: 700 } }, 1200, 800),
  ).toEqual({ x: 0, y: 0, width: 1000, height: 700 });
});
