/**
 * The expression language used by behavioral models (see MODELS.md).
 *
 * Guards, updates, invariants, and properties are all expressions over the
 * model's state variables. They are parsed into a small AST and evaluated
 * against a plain scope — never `eval`, so a spec can be checked without
 * granting it the power to run arbitrary code.
 *
 * Supported: numbers, strings, booleans; `+ - * / %`; comparisons
 * (`= == != <> < <= > >=`); `not` / `and` / `or` / `implies`; parentheses;
 * the functions below; and `name@pre` to read a variable's pre-state value
 * inside a behavioral property.
 */

export class ExprError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExprError";
  }
}

/** Pure, total functions available inside an expression. */
export const FUNCTIONS = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  abs: (n) => Math.abs(n),
  floor: (n) => Math.floor(n),
  ceil: (n) => Math.ceil(n),
  round: (n) => Math.round(n),
};

const KEYWORDS = new Set(["and", "or", "not", "implies", "true", "false"]);

// Longest-first so "<=" wins over "<".
const OPERATORS = [
  "<=",
  ">=",
  "!=",
  "<>",
  "==",
  "=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "(",
  ")",
  ",",
];

const COMPARISONS = new Set(["=", "==", "!=", "<>", "<", "<=", ">", ">="]);

/** `x@pre` reads the pre-state; the suffix is part of the identifier token. */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(@pre)?/;
const NUMBER_RE = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/;

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "#") break; // trailing comment
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = NUMBER_RE.exec(src.slice(i));
      tokens.push({ type: "num", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      if (end === -1) throw new ExprError(`Unterminated string literal`);
      tokens.push({ type: "str", value: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const text = IDENT_RE.exec(src.slice(i))[0];
      tokens.push({ type: KEYWORDS.has(text) ? "kw" : "ident", value: text });
      i += text.length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected character "${ch}"`);
    tokens.push({ type: "op", value: op });
    i += op.length;
  }
  tokens.push({ type: "eof", value: "end of expression" });
  return tokens;
}

/** Parse an expression source string into an AST. Throws ExprError. */
export function parseExpr(src) {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = () => tokens[pos];
  const at = (type, value) =>
    peek().type === type && (value === undefined || peek().value === value);
  const eat = (type, value) => (at(type, value) ? tokens[pos++] : null);
  const expect = (type, value) => {
    const token = eat(type, value);
    if (!token) throw new ExprError(`Expected "${value ?? type}", found "${peek().value}"`);
    return token;
  };

  // implies is right-associative and binds loosest.
  function implication() {
    const left = disjunction();
    if (eat("kw", "implies")) {
      return { kind: "binary", op: "implies", left, right: implication() };
    }
    return left;
  }
  function disjunction() {
    let left = conjunction();
    while (eat("kw", "or")) left = { kind: "binary", op: "or", left, right: conjunction() };
    return left;
  }
  function conjunction() {
    let left = negation();
    while (eat("kw", "and")) left = { kind: "binary", op: "and", left, right: negation() };
    return left;
  }
  function negation() {
    if (eat("kw", "not")) return { kind: "unary", op: "not", arg: negation() };
    return comparison();
  }
  function comparison() {
    const left = additive();
    if (peek().type === "op" && COMPARISONS.has(peek().value)) {
      const op = tokens[pos++].value;
      return { kind: "binary", op: normalizeComparison(op), left, right: additive() };
    }
    return left;
  }
  function additive() {
    let left = multiplicative();
    while (at("op", "+") || at("op", "-")) {
      const op = tokens[pos++].value;
      left = { kind: "binary", op, left, right: multiplicative() };
    }
    return left;
  }
  function multiplicative() {
    let left = unary();
    while (at("op", "*") || at("op", "/") || at("op", "%")) {
      const op = tokens[pos++].value;
      left = { kind: "binary", op, left, right: unary() };
    }
    return left;
  }
  function unary() {
    if (eat("op", "-")) return { kind: "unary", op: "neg", arg: unary() };
    return primary();
  }
  function primary() {
    if (eat("op", "(")) {
      const inner = implication();
      expect("op", ")");
      return inner;
    }
    const num = eat("num");
    if (num) return { kind: "literal", value: num.value };
    const str = eat("str");
    if (str) return { kind: "literal", value: str.value };
    if (eat("kw", "true")) return { kind: "literal", value: true };
    if (eat("kw", "false")) return { kind: "literal", value: false };
    const ident = eat("ident");
    if (!ident) throw new ExprError(`Unexpected "${peek().value}"`);
    if (at("op", "(")) {
      pos++;
      const args = [];
      if (!at("op", ")")) {
        do {
          args.push(implication());
        } while (eat("op", ","));
      }
      expect("op", ")");
      if (!Object.hasOwn(FUNCTIONS, ident.value)) {
        throw new ExprError(
          `Unknown function "${ident.value}" (available: ${Object.keys(FUNCTIONS).join(", ")})`,
        );
      }
      return { kind: "call", name: ident.value, args };
    }
    if (ident.value.endsWith("@pre")) {
      return { kind: "ref", name: ident.value.slice(0, -4), pre: true };
    }
    return { kind: "ref", name: ident.value, pre: false };
  }

  const ast = implication();
  if (!at("eof")) throw new ExprError(`Unexpected "${peek().value}" after expression`);
  return ast;
}

const normalizeComparison = (op) => (op === "==" ? "=" : op === "<>" ? "!=" : op);

/** Parse, wrapping the AST with its source so reports can quote the spec. */
export function compileExpr(src) {
  return { src: String(src).trim(), ast: parseExpr(src) };
}

/**
 * Evaluate an AST. `scope.vars` holds the current values; `scope.pre` (when
 * present) holds the pre-state values reachable through `name@pre`.
 */
export function evalExpr(ast, scope) {
  const vars = scope.vars || {};
  const pre = scope.pre || null;

  const walk = (node) => {
    switch (node.kind) {
      case "literal":
        return node.value;
      case "ref": {
        if (node.pre) {
          if (!pre) throw new ExprError(`"${node.name}@pre" is only valid in a property claim`);
          if (!Object.hasOwn(pre, node.name)) throw new ExprError(`Unknown variable "${node.name}"`);
          return pre[node.name];
        }
        if (!Object.hasOwn(vars, node.name)) throw new ExprError(`Unknown variable "${node.name}"`);
        return vars[node.name];
      }
      case "call": {
        const args = node.args.map(walk);
        for (const arg of args) {
          if (typeof arg !== "number") {
            throw new ExprError(`"${node.name}" expects numbers, got ${describe(arg)}`);
          }
        }
        return FUNCTIONS[node.name](...args);
      }
      case "unary": {
        if (node.op === "not") return !bool(walk(node.arg), "not");
        return -num(walk(node.arg), "-");
      }
      case "binary":
        return binary(node, walk);
      default:
        throw new ExprError(`Unsupported expression node "${node.kind}"`);
    }
  };

  return walk(ast);
}

function binary(node, walk) {
  const { op } = node;
  // Short-circuit the logical operators before touching the right side.
  if (op === "and") return bool(walk(node.left), op) ? bool(walk(node.right), op) : false;
  if (op === "or") return bool(walk(node.left), op) ? true : bool(walk(node.right), op);
  if (op === "implies") return bool(walk(node.left), op) ? bool(walk(node.right), op) : true;

  const left = walk(node.left);
  const right = walk(node.right);

  switch (op) {
    case "=":
      return equal(left, right);
    case "!=":
      return !equal(left, right);
    case "<":
    case "<=":
    case ">":
    case ">=": {
      if (typeof left !== typeof right || (typeof left !== "number" && typeof left !== "string")) {
        throw new ExprError(
          `Cannot compare ${describe(left)} with ${describe(right)} using "${op}"`,
        );
      }
      if (op === "<") return left < right;
      if (op === "<=") return left <= right;
      if (op === ">") return left > right;
      return left >= right;
    }
    case "+":
      // Strings concatenate; anything else is arithmetic.
      if (typeof left === "string" && typeof right === "string") return left + right;
      return num(left, op) + num(right, op);
    case "-":
      return num(left, op) - num(right, op);
    case "*":
      return num(left, op) * num(right, op);
    case "/":
      if (num(right, op) === 0) throw new ExprError("Division by zero");
      return num(left, op) / num(right, op);
    case "%":
      if (num(right, op) === 0) throw new ExprError("Division by zero");
      return num(left, op) % num(right, op);
    default:
      throw new ExprError(`Unsupported operator "${op}"`);
  }
}

function equal(left, right) {
  if (typeof left !== typeof right) {
    throw new ExprError(`Cannot compare ${describe(left)} with ${describe(right)}`);
  }
  return left === right;
}

function num(value, op) {
  if (typeof value !== "number") {
    throw new ExprError(`"${op}" expects a number, got ${describe(value)}`);
  }
  return value;
}

function bool(value, op) {
  if (typeof value !== "boolean") {
    throw new ExprError(`"${op}" expects a boolean, got ${describe(value)}`);
  }
  return value;
}

const describe = (value) =>
  typeof value === "string" ? `the string ${JSON.stringify(value)}` : `${typeof value} ${value}`;

/** Every identifier an expression reads, split by whether it is a `@pre` read. */
export function freeVars(ast) {
  const vars = new Set();
  const pre = new Set();
  const walk = (node) => {
    switch (node.kind) {
      case "ref":
        (node.pre ? pre : vars).add(node.name);
        return;
      case "call":
        node.args.forEach(walk);
        return;
      case "unary":
        walk(node.arg);
        return;
      case "binary":
        walk(node.left);
        walk(node.right);
        return;
      default:
    }
  };
  walk(ast);
  return { vars, pre };
}

/** Render a value the way model reports quote it. */
export function formatValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && !Number.isInteger(value)) {
    return String(Number(value.toFixed(6)));
  }
  return String(value);
}

/** Render a state object as `a = 1, b = "x"`. */
export function formatState(state, keys = null) {
  const names = keys || Object.keys(state);
  return names.map((name) => `${name} = ${formatValue(state[name])}`).join(", ");
}
