import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const sourceDirectory = resolve(import.meta.dirname, "../..");
const nativeModules = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

function imports(path: string) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest);
  const specifiers: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      specifiers.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

const modules = [...new Glob("**/*.{ts,tsx}").scanSync(sourceDirectory)]
  .filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".d.ts"))
  .map((path) => ({ path, imports: imports(join(sourceDirectory, path)) }));

test("desktop process boundaries keep native capabilities out of shared and renderer modules", () => {
  const violations: { path: string; specifier: string }[] = [];
  for (const module of modules) {
    const process = module.path.split("/")[0];
    for (const specifier of module.imports) {
      const native =
        specifier === "electron" ||
        specifier === "bun" ||
        specifier.startsWith("bun:") ||
        specifier.startsWith("node:") ||
        nativeModules.has(specifier);
      const target = specifier.startsWith(".")
        ? relative(sourceDirectory, resolve(sourceDirectory, dirname(module.path), specifier))
        : specifier;
      const targetProcess = target.split("/")[0];
      const forbidden =
        (process === "renderer" && (native || ["main", "preload"].includes(targetProcess))) ||
        (process === "shared" &&
          (native || ["main", "preload", "renderer"].includes(targetProcess))) ||
        (process === "preload" && ["main", "renderer"].includes(targetProcess)) ||
        (process === "main" && ["preload", "renderer"].includes(targetProcess));
      if (forbidden) violations.push({ path: module.path, specifier });
    }
  }
  expect(violations).toEqual([]);
});
