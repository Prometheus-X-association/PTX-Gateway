import type { CostFormulaCondition, CostFormulaExpression, CostPolicyDefinition } from "./costTypes.ts";

const SCALE_DIGITS = 12;
const SCALE = 10n ** BigInt(SCALE_DIGITS);
const ALLOWED_VARIABLES = new Set([
  "input_tokens", "output_tokens", "cached_input_tokens", "cache_write_tokens", "reasoning_tokens",
  "request_count", "tool_call_count", "attempt_count", "duration_ms", "quantity", "success",
  "subscription_amount", "period_execution_count",
]);

const pow10 = (value: number) => 10n ** BigInt(value);

export function decimal(value: string | number | bigint | boolean | null | undefined): bigint {
  if (typeof value === "boolean") return value ? SCALE : 0n;
  if (value === null || value === undefined || value === "") return 0n;
  if (typeof value === "bigint") return value * SCALE;
  let raw = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw)) throw new Error(`Invalid decimal value: ${raw}`);
  if (/e/i.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) throw new Error(`Invalid decimal value: ${raw}`);
    raw = numeric.toFixed(SCALE_DIGITS);
  }
  const negative = raw.startsWith("-");
  if (negative) raw = raw.slice(1);
  const [whole, fraction = ""] = raw.split(".");
  const scaled = BigInt(whole) * SCALE + BigInt((fraction + "0".repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS));
  return negative ? -scaled : scaled;
}

export function decimalString(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(SCALE_DIGITS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

const binary = (operator: "+" | "-" | "*" | "/", left: bigint, right: bigint): bigint => {
  if (operator === "+") return left + right;
  if (operator === "-") return left - right;
  if (operator === "*") return left * right / SCALE;
  if (right === 0n) throw new Error("Cost formula cannot divide by zero.");
  return left * SCALE / right;
};

const rounded = (value: bigint, places: number, mode: "round" | "ceil" | "floor") => {
  const safePlaces = Math.max(0, Math.min(SCALE_DIGITS, Math.trunc(places)));
  const factor = pow10(SCALE_DIGITS - safePlaces);
  const quotient = value / factor;
  const remainder = value % factor;
  if (remainder === 0n) return value;
  if (mode === "ceil") return (value > 0n ? quotient + 1n : quotient) * factor;
  if (mode === "floor") return (value < 0n ? quotient - 1n : quotient) * factor;
  return (quotient + (remainder > 0n ? 1n : -1n) * (2n * (remainder > 0n ? remainder : -remainder) >= factor ? 1n : 0n)) * factor;
};

export function validateCostFormula(expression: CostFormulaExpression, extraVariables: string[] = []): void {
  const allowed = new Set([...ALLOWED_VARIABLES, ...extraVariables]);
  let nodes = 0;
  const visitCondition = (condition: CostFormulaCondition, depth: number) => {
    if (condition.type !== "comparison") throw new Error("Unsupported cost condition.");
    visit(condition.left, depth + 1); visit(condition.right, depth + 1);
  };
  const visit = (item: CostFormulaExpression, depth: number) => {
    nodes++;
    if (nodes > 256 || depth > 32) throw new Error("Cost formula is too complex.");
    if (item.type === "number") { decimal(item.value); return; }
    if (item.type === "variable") {
      if (!allowed.has(item.name)) throw new Error(`Cost formula variable is not allowed: ${item.name}`);
      return;
    }
    if (item.type === "binary") { visit(item.left, depth + 1); visit(item.right, depth + 1); return; }
    if (item.type === "conditional") { visitCondition(item.condition, depth + 1); visit(item.whenTrue, depth + 1); visit(item.whenFalse, depth + 1); return; }
    if (item.type === "function") {
      if (!["min", "max", "round", "ceil", "floor"].includes(item.name)) throw new Error(`Cost formula function is not allowed: ${item.name}`);
      if (!item.arguments.length || item.arguments.length > 16) throw new Error("Cost formula function has an invalid argument count.");
      item.arguments.forEach((argument) => visit(argument, depth + 1)); return;
    }
    throw new Error("Unsupported cost formula expression.");
  };
  visit(expression, 0);
}

export function evaluateCostFormula(expression: CostFormulaExpression, values: Record<string, string | number | bigint | boolean | null | undefined>): bigint {
  const evaluateCondition = (condition: CostFormulaCondition) => {
    const left = evaluate(condition.left); const right = evaluate(condition.right);
    if (condition.operator === "eq") return left === right;
    if (condition.operator === "ne") return left !== right;
    if (condition.operator === "gt") return left > right;
    if (condition.operator === "gte") return left >= right;
    if (condition.operator === "lt") return left < right;
    return left <= right;
  };
  const evaluate = (item: CostFormulaExpression): bigint => {
    if (item.type === "number") return decimal(item.value);
    if (item.type === "variable") return decimal(values[item.name]);
    if (item.type === "binary") return binary(item.operator, evaluate(item.left), evaluate(item.right));
    if (item.type === "conditional") return evaluate(evaluateCondition(item.condition) ? item.whenTrue : item.whenFalse);
    const args = item.arguments.map(evaluate);
    if (item.name === "min") return args.reduce((a, b) => a < b ? a : b);
    if (item.name === "max") return args.reduce((a, b) => a > b ? a : b);
    const places = item.arguments[1] ? Number(decimalString(args[1])) : 0;
    return rounded(args[0], places, item.name);
  };
  return evaluate(expression);
}

export function evaluateCostPolicy(definition: CostPolicyDefinition, inputs: Record<string, string | number | bigint | boolean | null | undefined>) {
  const rates = definition.rates ?? {};
  validateCostFormula(definition.formula, Object.keys(rates));
  const normalizedInputs = { ...rates, ...inputs };
  const amount = evaluateCostFormula(definition.formula, normalizedInputs);
  return {
    amount: decimalString(amount),
    inputs: Object.fromEntries(Object.entries(normalizedInputs).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value ?? 0])),
    breakdown: { formula: definition.formula, amount: decimalString(amount) },
  };
}
