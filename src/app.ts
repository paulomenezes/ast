import fs from 'fs';
import path from 'path';
import { ArrayLiteralExpression, Node, Project, SourceFile, Statement } from 'ts-morph';
import ts from 'typescript';
import { AST } from './ast';

const projectFolder = path.join(__dirname, '../../ss-in-home/app/frontend');

const angularFile = path.join(projectFolder, 'angular.json');

const project = new Project({
  tsConfigFilePath: path.join(projectFolder, 'tsconfig.json'),
});

let projectAST: Partial<AST> = {};

if (fs.existsSync(angularFile)) {
  try {
    const mainPath = path.join(projectFolder, 'src/main.ts');
    const mainFile = project.getSourceFileOrThrow(mainPath);

    projectAST = {
      angular: {
        main: {
          path: mainPath,
        },
      },
    };

    const expressionStatement = mainFile?.getStatements().filter((statement) => statement.getKind() === ts.SyntaxKind.ExpressionStatement);

    if (expressionStatement && expressionStatement.length > 0) {
      const mainModule = getMainModuleName(expressionStatement[0]);

      if (mainModule) {
        const mainModulePath = getImportPathFromFile(mainFile, mainModule);

        if (mainModulePath) {
          const mainModuleAbsolutePath = getPathFromFileImport(mainPath, mainModulePath);
          const mainModuleFile = project.getSourceFileOrThrow(mainModuleAbsolutePath);

          projectAST.angular!.main.module = {
            name: mainModule,
            path: mainModuleFile.getFilePath().toString(),
          };

          mainModuleFile
            .getClassOrThrow(mainModule)
            .getDecoratorOrThrow('NgModule')
            .getCallExpressionOrThrow()
            .getArguments()
            .forEach((arg) => {
              if (Node.isObjectLiteralExpression(arg)) {
                arg.getProperties().forEach((prop) => {
                  if (Node.isPropertyAssignment(prop)) {
                    const initializer = prop.getInitializerOrThrow();

                    if (Node.isArrayLiteralExpression(initializer)) {
                      if (prop.getName() === 'imports') {
                        projectAST.angular!.main.moduleRouter = getRouterModuleFileFromInitializer(initializer, mainModuleFile);
                      }

                      if (prop.getName() === 'bootstrap') {
                        const bootstrapElement = initializer.getElements()[0].getText();

                        projectAST.angular!.main.bootstrapElement = {
                          name: bootstrapElement,
                          path: getPathFromFileImport(mainModuleAbsolutePath, getImportPathFromFile(mainModuleFile, bootstrapElement)!),
                        };
                      }
                    }
                  }
                });
              }
            });
        } else {
          console.log('Main module path not found');
        }
      } else {
        console.log('Main module not found');
      }
    } else {
      console.log('Bootstrap expreession not found');
    }
  } catch (error) {
    console.error(error);
  }
} else {
  console.log('Is not an angular project');
}

console.log(JSON.stringify(projectAST, null, 2));

function getRouterModuleFileFromInitializer(initializer: ArrayLiteralExpression, moduleFile: SourceFile): { path: string; name: string } | undefined {
  for (const element of initializer.getElements()) {
    if (Node.isIdentifier(element)) {
      const relativePath = getImportPathFromFile(moduleFile, element.getText());

      if (relativePath && isLocalImport(relativePath)) {
        const importPath = getPathFromFileImport(moduleFile.getFilePath().toString(), relativePath);

        const isRouterModuleImport = project
          .getSourceFile(importPath)
          ?.getClasses()
          .find((classElement) =>
            classElement
              .getDecorator('NgModule')
              ?.getCallExpression()
              ?.getArguments()
              .find((argument) => {
                if (Node.isObjectLiteralExpression(argument)) {
                  return argument.getProperties().find((property) => {
                    if (Node.isPropertyAssignment(property) && property.getName() === 'exports') {
                      const propertyInitializer = property.getInitializer();

                      return (
                        Node.isArrayLiteralExpression(propertyInitializer) &&
                        propertyInitializer.getElements().length === 1 &&
                        propertyInitializer.getElements()[0].getText() === 'RouterModule'
                      );
                    }
                  });
                }

                return false;
              })
          );

        if (isRouterModuleImport) {
          return {
            path: importPath,
            name: element.getText(),
          };
        }
      }
    }
  }
}

function isLocalImport(importPath: string): boolean {
  return importPath.startsWith('.');
}

function getPathFromFileImport(filePath: string, importPath: string): string {
  const part = filePath.split('/');
  part.pop();

  return path.join(part.join('/'), importPath + '.ts');
}

function getMainModuleName(statement: Node): string | undefined {
  for (const expression of statement.getChildren()) {
    if (
      Node.isCallExpression(expression) &&
      expression.getArguments() &&
      expression.getArguments().length === 1 &&
      expression.getArguments()[0].getKind() === ts.SyntaxKind.Identifier
    ) {
      return expression.getArguments()[0].getText();
    } else {
      return getMainModuleName(expression);
    }
  }

  return undefined;
}

function getImportPathFromFile(file: SourceFile, importIndentifier: string): string | undefined {
  return file
    .getImportDeclarations()
    .find((imp) =>
      imp
        .getImportClause()
        ?.getNamedImports()
        .find((named) => named.getText() === importIndentifier)
    )
    ?.getModuleSpecifierValue();
}
