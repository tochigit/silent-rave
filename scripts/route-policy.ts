import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
export type RouteSource = { file: string; source: string };
export function auditRoutePolicy(routes: RouteSource[]): string[] {
  const errors: string[] = [];
  for (const route of routes) {
    const file = route.file.replaceAll("\\", "/");
    const surface = /(?:^|\/)api\/admin\//.test(file) ? "admin" : /(?:^|\/)api\/staff\//.test(file) ? "staff" : null;
    const protectedPage = /\/(?:admin|staff)\/.*(?:page|layout)\.tsx$/.test(file) && !/\/(?:admin|staff)\/login\/page\.tsx$/.test(file);
    if (!surface && !protectedPage) continue;
    const ast = ts.createSourceFile(file, route.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const functions = new Map<string, ts.Node>();
    const exports: [string, ts.Node][] = [];
    for (const statement of ast.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.body) {
        if (statement.name) functions.set(statement.name.text, statement.body);
        if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) exports.push([statement.name?.text ?? "default", statement.body]);
      }
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          functions.set(declaration.name.text, declaration.initializer);
          if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) exports.push([declaration.name.text, declaration.initializer]);
        }
      }
    }
    const hasGuard = (node: ts.Node, seen = new Set<string>()): boolean => {
      if (ts.isIdentifier(node) && functions.has(node.text) && !seen.has(node.text)) {
        seen.add(node.text); return hasGuard(functions.get(node.text)!, seen);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (surface && node.expression.text === "guardApi" && node.arguments[1]?.getText(ast) === (surface === "admin" ? "ADMIN_API_ROLES" : "STAFF_API_ROLES")) return true;
        if (protectedPage && node.expression.text === "requirePageRole") return true;
        if (functions.has(node.expression.text) && !seen.has(node.expression.text)) {
          seen.add(node.expression.text); if (hasGuard(functions.get(node.expression.text)!, seen)) return true;
        }
      }
      return ts.forEachChild(node, child => hasGuard(child, seen) || undefined) === true;
    };
    const methods = exports.filter(([name]) => surface ? /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name) : name === "Page" || name === "default" || /Layout$/.test(name));
    if (!methods.length || methods.some(([, body]) => !hasGuard(body))) errors.push(`${file}: missing independent ${surface ? "API role guard" : "page role guard"}`);
  }
  return errors;
}
export async function repositoryRoutes(root = "src/app") {
  const result: RouteSource[] = [];
  const visit = async (directory: string) => {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, file.name);
      if (file.isDirectory()) await visit(target);
      else if (/^(route\.ts|page\.tsx|layout\.tsx)$/.test(file.name)) result.push({ file: target.replaceAll("\\", "/"), source: await readFile(target, "utf8") });
    }
  };
  await visit(root); return result;
}
