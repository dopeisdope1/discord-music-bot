"use strict";

const { UsageError, BotError } = require("../../core/errors");

const VALID_PATTERN = /^[\d+\-*/().\s]+$/;

// Tokenizer: turns the validated string into numbers/operators/parens.
function tokenize(input) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
        const ch = input[i];
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (/[\d.]/.test(ch)) {
            let num = "";
            while (i < input.length && /[\d.]/.test(input[i])) {
                num += input[i];
                i++;
            }
            if ((num.match(/\./g) || []).length > 1) throw new BotError("Nombre invalide dans le calcul.");
            tokens.push({ type: "number", value: parseFloat(num) });
            continue;
        }
        if ("+-*/()".includes(ch)) {
            tokens.push({ type: ch });
            i++;
            continue;
        }
        throw new BotError(`Caractère invalide dans le calcul : "${ch}"`);
    }
    return tokens;
}

// Minimal recursive-descent / precedence-climbing parser & evaluator for
// + - * / and parens. No eval()/Function() involved — deliberately, since this
// takes raw user input (see command contract notes on why eval is a no-go).
function evaluate(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];

    function parseFactor() {
        const tok = peek();
        if (!tok) throw new BotError("Expression incomplète.");
        if (tok.type === "number") {
            consume();
            return tok.value;
        }
        if (tok.type === "(") {
            consume();
            const value = parseExpr();
            if (!peek() || peek().type !== ")") throw new BotError("Parenthèse manquante.");
            consume();
            return value;
        }
        if (tok.type === "-") {
            consume();
            return -parseFactor();
        }
        if (tok.type === "+") {
            consume();
            return parseFactor();
        }
        throw new BotError("Expression invalide.");
    }

    function parseTerm() {
        let value = parseFactor();
        while (peek() && (peek().type === "*" || peek().type === "/")) {
            const op = consume().type;
            const rhs = parseFactor();
            if (op === "*") {
                value *= rhs;
            } else {
                if (rhs === 0) throw new BotError("Division par zéro.");
                value /= rhs;
            }
        }
        return value;
    }

    function parseExpr() {
        let value = parseTerm();
        while (peek() && (peek().type === "+" || peek().type === "-")) {
            const op = consume().type;
            const rhs = parseTerm();
            value = op === "+" ? value + rhs : value - rhs;
        }
        return value;
    }

    const result = parseExpr();
    if (pos !== tokens.length) throw new BotError("Expression invalide.");
    return result;
}

module.exports = {
    name: "calc",
    category: "public",
    description: "Effectue une opération mathématique simple.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const expression = ctx.args.join(" ");
        if (!expression) throw new UsageError("calc <calcul, ex: (2+3)*4>");
        if (!VALID_PATTERN.test(expression)) {
            throw new UsageError("calc <calcul> — uniquement chiffres, + - * / ( ) et espaces autorisés.");
        }

        const result = evaluate(tokenize(expression));
        if (!Number.isFinite(result)) throw new BotError("Le résultat n'est pas un nombre fini.");

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🧮 Calculatrice",
                    description: `\`${expression}\` = **${result}**`,
                }),
            ],
        });
    },
};
