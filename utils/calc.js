// Évaluateur d'expressions pour &calc. Écrit à la main (tokenizer + shunting
// yard) plutôt qu'avec eval()/Function() : l'entrée vient de n'importe quel
// membre du serveur, et il n'existe aucune façon sûre d'exécuter ça comme du
// JavaScript. Ici, un caractère hors de la grammaire est une erreur, pas du
// code.

const CONSTANTS = { pi: Math.PI, π: Math.PI, e: Math.E };

const FUNCTIONS = {
  sqrt: (x) => Math.sqrt(x),
  abs: (x) => Math.abs(x),
  round: (x) => Math.round(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  ln: (x) => Math.log(x),
  log: (x) => Math.log10(x),
  exp: (x) => Math.exp(x),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
};

// `prec` = priorité, `right` = associativité à droite (seule la puissance).
const OPERATORS = {
  "+": { prec: 1, apply: (a, b) => a + b },
  "-": { prec: 1, apply: (a, b) => a - b },
  "*": { prec: 2, apply: (a, b) => a * b },
  "/": { prec: 2, apply: (a, b) => a / b },
  "%": { prec: 2, apply: (a, b) => a % b },
  "^": { prec: 3, right: true, apply: (a, b) => a ** b },
};

// Entre "*" (2) et "^" (3) : -2^2 = -(2^2), mais -2*3 = (-2)*3.
const UNARY_PRECEDENCE = 2.5;

class CalcError extends Error {}

/**
 * Découpe l'expression et insère les multiplications implicites ("2x", "3(4+1)",
 * ")(" ) : elles sont naturelles pour qui écrit un calcul à la main, et sans
 * elles `2x+3=7` n'aurait aucun sens.
 */
function tokenize(input) {
  const tokens = [];
  // "," décimale et "×" tapés au clavier sont acceptés ; le "x" latin est
  // laissé tel quel, c'est l'inconnue des équations.
  const src = input.replace(/,/g, ".").replace(/[×✕]/g, "*");
  let i = 0;

  const previous = () => tokens[tokens.length - 1];
  // Un nom de FONCTION ne multiplie pas la parenthèse qui le suit : "sqrt(16)"
  // est un appel, pas "sqrt * (16)".
  const impliesMultiplication = (before) => {
    const prev = previous();
    if (!prev) return false;
    if (prev.type === "name") return !(before === "(" && FUNCTIONS[prev.value]);
    return prev.type === "number" || prev.value === ")";
  };

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      const match = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!match) throw new CalcError(`Nombre invalide près de « ${src.slice(i, i + 8)} ».`);
      if (impliesMultiplication("number")) tokens.push({ type: "op", value: "*" });
      tokens.push({ type: "number", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }

    if (/[a-zA-Zπ]/.test(ch)) {
      const match = /^[a-zA-Zπ]+/.exec(src.slice(i));
      if (impliesMultiplication("name")) tokens.push({ type: "op", value: "*" });
      tokens.push({ type: "name", value: match[0].toLowerCase() });
      i += match[0].length;
      continue;
    }

    if (ch === "(") {
      if (impliesMultiplication("(")) tokens.push({ type: "op", value: "*" });
      tokens.push({ type: "paren", value: "(" });
      i++;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: "paren", value: ")" });
      i++;
      continue;
    }

    if (OPERATORS[ch]) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }

    throw new CalcError(`Caractère non autorisé : « ${ch} ».`);
  }

  return tokens;
}

/** Un "-" (ou "+") est unaire en début d'expression, après un opérateur ou après "(". */
function isUnaryPosition(previous) {
  return !previous || previous.type === "op" || previous.value === "(";
}

/** Shunting yard : tokens -> pile de sortie en notation polonaise inverse. */
function toRpn(tokens) {
  const output = [];
  const stack = [];

  tokens.forEach((token, index) => {
    const prev = tokens[index - 1];

    if (token.type === "number") return output.push(token);

    if (token.type === "name") {
      if (FUNCTIONS[token.value]) return stack.push({ type: "func", value: token.value });
      return output.push(token);
    }

    if (token.type === "op") {
      if ((token.value === "-" || token.value === "+") && isUnaryPosition(prev)) {
        // Le "-" unaire se place entre "*" et "^" en priorité : c'est ce qui
        // fait valoir -2^2 = -(2^2) = -4, comme partout ailleurs.
        if (token.value === "-") stack.push({ type: "unary", value: "-" });
        return;
      }
      const op = OPERATORS[token.value];
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type === "func") {
          output.push(stack.pop());
          continue;
        }
        const topPrec = top.type === "unary" ? UNARY_PRECEDENCE : top.type === "op" ? OPERATORS[top.value].prec : null;
        if (topPrec !== null && (topPrec > op.prec || (topPrec === op.prec && !op.right))) {
          output.push(stack.pop());
          continue;
        }
        break;
      }
      return stack.push(token);
    }

    if (token.value === "(") return stack.push(token);

    // ")"
    while (stack.length && stack[stack.length - 1].value !== "(") output.push(stack.pop());
    if (!stack.length) throw new CalcError("Parenthèse fermante sans ouvrante.");
    stack.pop();
    if (stack.length && stack[stack.length - 1].type === "func") output.push(stack.pop());
  });

  while (stack.length) {
    const top = stack.pop();
    if (top.value === "(") throw new CalcError("Parenthèse ouvrante jamais fermée.");
    output.push(top);
  }
  return output;
}

function evaluateRpn(rpn, variables) {
  const stack = [];
  for (const token of rpn) {
    if (token.type === "number") {
      stack.push(token.value);
    } else if (token.type === "name") {
      const value = variables[token.value] ?? CONSTANTS[token.value];
      if (value === undefined) throw new CalcError(`Inconnue « ${token.value} » : ce n'est ni une constante ni une fonction connue.`);
      stack.push(value);
    } else if (token.type === "func") {
      if (!stack.length) throw new CalcError(`La fonction « ${token.value} » attend un argument.`);
      stack.push(FUNCTIONS[token.value](stack.pop()));
    } else if (token.type === "unary") {
      if (!stack.length) throw new CalcError("Signe « - » sans nombre à sa droite.");
      stack.push(-stack.pop());
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new CalcError(`Opérateur « ${token.value} » incomplet.`);
      stack.push(OPERATORS[token.value].apply(a, b));
    }
  }
  if (stack.length !== 1) throw new CalcError("Expression incomplète.");
  return stack[0];
}

/** Évalue une expression sans inconnue (ou avec `x` fourni dans `variables`). */
function evaluate(expression, variables = {}) {
  const value = evaluateRpn(toRpn(tokenize(expression)), variables);
  if (typeof value !== "number" || Number.isNaN(value)) throw new CalcError("Le résultat n'est pas un nombre (division par zéro, racine d'un négatif...).");
  if (!Number.isFinite(value)) throw new CalcError("Le résultat est infini (division par zéro ?).");
  return value;
}

/** Arrondit les miettes de flottant (0.30000000000000004 -> 0.3) sans mentir sur les grands nombres. */
function format(value) {
  if (Number.isInteger(value)) return String(value);
  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}

/**
 * Résout une équation du premier degré à une inconnue `x` (ex : `2x+3=7`).
 * f(x) = gauche - droite est linéaire, donc entièrement déterminée par ses
 * valeurs en 0 et en 1 — et on revérifie la racine trouvée pour refuser les
 * équations non linéaires (`x^2=4`) au lieu d'en donner une fausse solution.
 */
function solve(left, right) {
  const f = (x) => evaluate(left, { x }) - evaluate(right, { x });
  const at0 = f(0);
  const slope = f(1) - at0;
  if (slope === 0) {
    if (at0 === 0) throw new CalcError("Cette équation est vraie pour n'importe quel `x`.");
    throw new CalcError("Cette équation n'a pas de solution.");
  }
  const root = -at0 / slope;
  if (Math.abs(f(root)) > 1e-6 * Math.max(1, Math.abs(root))) {
    throw new CalcError("Seules les équations du premier degré à une inconnue `x` sont résolues.");
  }
  return root;
}

/**
 * Point d'entrée de &calc : rend `{ expression, result }` prêt à afficher.
 * Une entrée contenant "=" est traitée comme une équation à résoudre.
 */
function compute(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) throw new CalcError("Donne un calcul, par exemple `calc (2+3)*4`.");
  if (trimmed.length > 200) throw new CalcError("Calcul trop long (200 caractères maximum).");

  const parts = trimmed.split("=");
  if (parts.length > 2) throw new CalcError("Une seule égalité à la fois.");
  if (parts.length === 2) {
    const x = solve(parts[0], parts[1]);
    return { expression: trimmed, result: `x = ${format(x)}`, solved: true };
  }
  return { expression: trimmed, result: format(evaluate(trimmed)), solved: false };
}

module.exports = { compute, evaluate, format, CalcError };
