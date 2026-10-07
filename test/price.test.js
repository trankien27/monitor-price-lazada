import test from "node:test";
import assert from "node:assert/strict";
import { formatVnd, parseVnd } from "../src/price.js";

test("parseVnd doc gia Lazada", () => {
  assert.equal(parseVnd("₫1.249.000"), 1249000);
  assert.equal(parseVnd("499,000 ₫"), 499000);
  assert.equal(parseVnd("499000.00"), 499000);
  assert.equal(parseVnd(""), null);
});

test("formatVnd dinh dang tien Viet", () => {
  assert.match(formatVnd(1249000), /1[.]249[.]000/);
});
