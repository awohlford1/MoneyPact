import ts from "typescript";

export function missingRuntimeExports(module, barrel) {
  return Object.keys(module)
    .filter((name) => !(name in barrel))
    .sort();
}

function typeNames(sourceText) {
  const source = ts.createSourceFile(
    "module.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return source.statements
    .filter(
      (statement) =>
        (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    )
    .map((statement) => statement.name.text)
    .sort();
}

function reexportedTypeNames(sourceText, moduleSpecifier) {
  const source = ts.createSourceFile(
    "index.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return source.statements.flatMap((statement) => {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier === undefined ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleSpecifier ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      return [];
    }

    return statement.exportClause.elements
      .filter((element) => statement.isTypeOnly || element.isTypeOnly)
      .map((element) => (element.propertyName ?? element.name).text);
  });
}

export function missingTypeExports(moduleSource, barrelSource, moduleSpecifier) {
  const exported = reexportedTypeNames(barrelSource, moduleSpecifier);
  return typeNames(moduleSource).filter((name) => !exported.includes(name));
}

export function runtimeDiagnostic(moduleName, groupName, missing) {
  return `${moduleName} exports ${missing.join(", ")} which ${groupName}/index.ts does not re-export`;
}

export function typeDiagnostic(moduleName, groupName, missing) {
  return `${moduleName} exports type ${missing.join(", ")} which ${groupName}/index.ts does not re-export`;
}
