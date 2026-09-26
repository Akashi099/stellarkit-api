const { formatAmount } = require("../src/utils/formatAmount");

describe("formatAmount", () => {
  test("pads integer strings to seven decimals", () => {
    expect(formatAmount("100")).toBe("100.0000000");
  });

  test("pads shorter decimal strings to seven decimals", () => {
    expect(formatAmount("12.34")).toBe("12.3400000");
  });

  test("rounds longer decimal strings to seven decimals", () => {
    expect(formatAmount("12.12345678")).toBe("12.1234568");
  });

  test("formats numeric values to seven decimals", () => {
    expect(formatAmount(9.5)).toBe("9.5000000");
  });

  test("leaves non-numeric strings unchanged", () => {
    expect(formatAmount("native")).toBe("native");
  });
});
