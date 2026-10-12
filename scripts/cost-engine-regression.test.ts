import assert from "node:assert/strict";
import test from "node:test";
import { decimal, decimalString, evaluateCostPolicy, validateCostFormula } from "../supabase/functions/_shared/costEngine.ts";
import type { CostFormulaExpression } from "../supabase/functions/_shared/costTypes.ts";

const variable = (name: string) => ({ type: "variable" as const, name });
const number = (value: string) => ({ type: "number" as const, value });
const binary = (operator: "+" | "-" | "*" | "/", left: CostFormulaExpression, right: CostFormulaExpression): CostFormulaExpression => ({ type: "binary", operator, left, right });

test("cost engine uses deterministic fixed precision token pricing", () => {
  const policy = {
    rates: { input_rate: "4", output_rate: "16", request_fee: "0.001" },
    formula: binary("+",
      binary("+", binary("*", binary("/", variable("input_tokens"), number("1000000")), variable("input_rate")),
        binary("*", binary("/", variable("output_tokens"), number("1000000")), variable("output_rate"))),
      variable("request_fee")),
  };
  const result = evaluateCostPolicy(policy, { input_tokens: 12400, output_tokens: 2100 });
  assert.equal(result.amount, "0.0842");
});

test("cost engine supports conditions and rejects unsafe variables", () => {
  const formula = { type: "conditional" as const, condition: { type: "comparison" as const, operator: "eq" as const, left: variable("success"), right: number("1") }, whenTrue: number("0.03"), whenFalse: number("0") };
  assert.equal(evaluateCostPolicy({ formula }, { success: true }).amount, "0.03");
  assert.throws(() => validateCostFormula(variable("secret")), /not allowed/);
});

test("decimal helpers preserve twelve-place values", () => {
  assert.equal(decimalString(decimal("123.000000000001")), "123.000000000001");
  assert.throws(() => evaluateCostPolicy({ formula: binary("/", number("1"), number("0")) }, {}), /divide by zero/);
});

test("provider pricing separates regular, cached, cache-write, output, and request costs", () => {
  const regular = { type: "function" as const, name: "max" as const, arguments: [number("0"), binary("-", binary("-", variable("input_tokens"), variable("cached_input_tokens")), variable("cache_write_tokens"))] };
  const priced = (tokens: CostFormulaExpression, rate: string) => binary("*", binary("/", tokens, number("1000000")), variable(rate));
  const formula = binary("+", binary("+", binary("+", binary("+",
    priced(regular, "input_rate"), priced(variable("cached_input_tokens"), "cached_input_rate")),
    priced(variable("cache_write_tokens"), "cache_write_rate")), priced(variable("output_tokens"), "output_rate")),
    binary("*", variable("request_count"), variable("request_fee")));
  const result = evaluateCostPolicy({ rates: { input_rate: "2", cached_input_rate: "0.2", cache_write_rate: "2.5", output_rate: "8", request_fee: "0.01" }, formula },
    { input_tokens: 1_000_000, cached_input_tokens: 200_000, cache_write_tokens: 100_000, output_tokens: 500_000, request_count: 1 });
  assert.equal(result.amount, "5.7");
});
