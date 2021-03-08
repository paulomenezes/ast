import fs from 'fs';
import path from 'path';
import { ArrayLiteralExpression, Block, Node, Project, PropertyDeclaration, SourceFile } from 'ts-morph';
import ts from 'typescript';
import {
  AST,
  ASTFile,
  Component,
  ComponentConstructorParameter,
  ComponentElement,
  ComponentElementProperty,
  ComponentGlobalVariable,
  Statement,
} from './ast';

const projectFolder = path.join(__dirname, '../../ss-in-home/app/frontend');

const angularFile = path.join(projectFolder, 'angular.json');

let projectAST: Partial<AST> = {};

if (fs.existsSync(angularFile)) {
  const angularJson = JSON.parse(fs.readFileSync(angularFile, 'utf-8'));
  const prefix: string = angularJson.projects[Object.keys(angularJson.projects)[0]].prefix;

  const project = new Project({
    tsConfigFilePath: path.join(projectFolder, 'tsconfig.json'),
  });

  try {
    const mainPath = path.join(projectFolder, 'src/main.ts');
    const mainFile = project.getSourceFileOrThrow(mainPath);

    projectAST = {
      angular: {
        main: {
          prefix,
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
          const mainModuleAbsolutePath = getAbsolutePathFromFileImport(mainPath, mainModulePath);
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
            .forEach((argument) => {
              if (Node.isObjectLiteralExpression(argument)) {
                argument.getProperties().forEach((property) => {
                  if (Node.isPropertyAssignment(property)) {
                    const initializer = property.getInitializerOrThrow();

                    if (Node.isArrayLiteralExpression(initializer)) {
                      if (property.getName() === 'imports') {
                        projectAST.angular!.main.moduleRouter = getRouterModuleFileFromInitializer(project, initializer, mainModuleFile);
                      }

                      if (property.getName() === 'bootstrap') {
                        const bootstrapElement = initializer.getElements()[0].getText();

                        const file = {
                          name: bootstrapElement,
                          path: getAbsolutePathFromFileImport(mainModuleAbsolutePath, getImportPathFromFile(mainModuleFile, bootstrapElement)!),
                        };

                        projectAST.angular!.main.bootstrapElement = createComponentObject(project, file, prefix);
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

function removeStringQuotes(value: string | undefined): string {
  return (value || '').replace(/\'/g, '').replace(/\"/g, '');
}

function createComponentObject(project: Project, file: ASTFile, prefix: string): Partial<Component> {
  const component: Partial<Component> = {
    file,
  };

  const source = project.getSourceFileOrThrow(file.path);
  const componentClass = source.getClassOrThrow(file.name);
  const argument = componentClass.getDecoratorOrThrow('Component').getCallExpressionOrThrow().getArguments()[0];

  if (Node.isObjectLiteralExpression(argument)) {
    argument.getProperties().forEach((property) => {
      if (Node.isPropertyAssignment(property)) {
        const name = property.getName();

        if (name === 'selector' || name === 'templateUrl') {
          let value: string | undefined;

          if (Node.isStringLiteral(property.getInitializer())) {
            value = property.getInitializer()?.getText();
          }

          if (value) {
            if (name === 'selector') {
              component.selector = removeStringQuotes(value);
            }

            if (name === 'templateUrl') {
              component.templateUrl = getAbsolutePathFromFileImport(file.path, removeStringQuotes(value), false);
            }
          }
        } else if (name === 'styleUrls') {
          let value: string[] | undefined;

          const initializer = property.getInitializer();

          if (Node.isArrayLiteralExpression(initializer)) {
            value = initializer
              .getElements()
              .map((element) => getAbsolutePathFromFileImport(file.path, removeStringQuotes(element.getText()), false));
          }

          if (value) {
            component.styleUrls = value;
          }
        }
      }
    });
  }

  const globalVariables = componentClass.getMembers().reduce((previous, member) => {
    if (Node.isPropertyDeclaration(member)) {
      const type = member.getType();
      const symbol = type.getSymbol();

      previous[member.getName()] = {
        modifier: member.getModifiers()?.[0]?.getText() || 'public',
        usedInTemplate: false,
        usedInComponent: false,
        value: member.getInitializer()?.getText(),
        type: symbol ? symbol.getName() : type.getText(),
      };
    }

    return previous;
  }, {} as Record<string, ComponentGlobalVariable>);

  const constructor = componentClass.getConstructors()[0];

  const parameters = constructor.getParameters().reduce((previous, parameter) => {
    previous[parameter.getName()] = {
      modifier: parameter.getModifiers()?.[0]?.getText() || 'public',
      type: parameter.getType().getSymbol()?.getName()!,
      isGlobal: !!parameter.getModifiers()?.[0]?.getText(),
      isInternal: isLocalImport(getImportPathFromFile(source, parameter.getType().getSymbol()?.getName()!)!),
    };

    return previous;
  }, {} as Record<string, ComponentConstructorParameter>);

  const statements: Statement[] = getStatementsFromBody(source, constructor.getBody());

  const onInitStatements: Statement[] = getStatementsFromBody(source, componentClass.getMethod('ngOnInit')?.getBody());
  const onDestroyStatements: Statement[] = getStatementsFromBody(source, componentClass.getMethod('ngOnDestroy')?.getBody());

  component.component = {
    globalVariables,
    constructor: {
      parameters,
      statements,
    },
    implements: componentClass
      .getHeritageClauses()[0]
      .getTypeNodes()
      .map((heritage) => heritage.getText()),
    lifecycle: {
      onInit: {
        implemented: false,
        statements: onInitStatements,
      },
      onDestroy: {
        implemented: false,
        statements: onDestroyStatements,
      },
    },
  };

  if (component.templateUrl) {
    const file = fs.readFileSync(component.templateUrl, 'utf-8');

    const lines = file.split('\n').filter((line) => line.indexOf(`<${prefix}-`) >= 0);

    const elements: ComponentElement[] = lines.map((line) => {
      line = line.trim();

      const properties = line.match(/\[?\w+\]?="\w+"/g)?.reduce((previous, current) => {
        const name = current
          .match(/\[?\w+]?=/g)![0]
          .replace('[', '')
          .replace(']', '')
          .replace('=', '');

        previous[name] = {
          static: !current.match(/\[\w+\]=/g),
        };

        const value = removeStringQuotes(current.match(/"\w+"/g)?.[0]);

        if (component.component!.globalVariables[value]) {
          component.component!.globalVariables[value].usedInTemplate = true;

          previous[name].variable = value;
        } else {
          previous[name].value = value;
        }

        return previous;
      }, {} as Record<string, ComponentElementProperty>);

      return {
        type: line.substring(1, line.indexOf(' ')),
        properties: properties || {},
      };
    });

    component.html = {
      hasRouterOutlet: file.indexOf('<router-outlet>') >= 0 && file.indexOf('</router-outlet>') >= 0,
      elements,
    };
  }

  return component;
}

function getStatementsFromBody(file: SourceFile, constructorBody: Node<ts.Node> | undefined): Statement[] {
  let statements: Statement[] = [];

  if (constructorBody && Node.isBlock(constructorBody)) {
    constructorBody.getStatements().forEach((statement) => {
      const newStatement = createStatements(file, statement);

      if (newStatement) {
        statements.push(newStatement);
      }
    });
  }

  return statements;
}

function createStatements(file: SourceFile, nodeStatement: Node<ts.Node>): Statement | undefined {
  let statement: Statement | undefined;

  if (Node.isVariableStatement(nodeStatement)) {
    const initializer = nodeStatement.getDeclarationList().getDeclarations()[0].getInitializer();

    if (Node.isCallExpression(initializer)) {
      statement = {
        variableDeclaration: {
          name: nodeStatement.getDeclarationList().getDeclarations()[0].getName(),
          value: initializer.getExpression().getText(),
          import: {
            path: getImportPathFromFile(file, initializer.getExpression().getText())!,
          },
        },
      };
    }
  } else if (Node.isExpressionStatement(nodeStatement)) {
    const expression = nodeStatement.getExpression();

    if (Node.isCallExpression(expression)) {
      statement = {
        callExpression: {
          calls: expression.getText().split('.'),
          parameters: expression.getArguments().map((argument) => argument.getText()),
        },
      };
    } else if (Node.isBinaryExpression(expression)) {
      const left = expression.getLeft();
      const right = expression.getRight();

      if (Node.isCallExpression(right)) {
        const rightExpression = right.getExpression();

        if (rightExpression.getText().endsWith('.subscribe')) {
          const arrowFunction = right.getArguments()[0];

          if (Node.isArrowFunction(arrowFunction)) {
            statement = {
              binaryExpression: {
                property: (Node.isPropertyAccessExpression(left) && left.getName()) || '',
                subscribeExpression: {
                  // variable: rightExpression.getText().split('.')[0],
                  calls: rightExpression.getText().split('.'),
                  parameters: arrowFunction.getParameters().map((parameter) => ({
                    name: parameter.getName(),
                    type: parameter.getType().getText(),
                  })),
                  statements: getStatementsFromBody(file, arrowFunction.getBody()),
                },
              },
            };
          }
        }
      } else if (Node.isIdentifier(right)) {
        statement = {
          binaryExpression: {
            property: expression.getLeft().getText(),
            value: right.getText(),
          },
        };
      }
    }
  } else if (Node.isIfStatement(nodeStatement)) {
    statement = {
      if: {
        condition: nodeStatement.getExpression().getText(),
        statements: getStatementsFromBody(file, nodeStatement.getThenStatement()),
      },
    };
  }

  return statement;
}

function getRouterModuleFileFromInitializer(
  project: Project,
  initializer: ArrayLiteralExpression,
  moduleFile: SourceFile
): { path: string; name: string } | undefined {
  for (const element of initializer.getElements()) {
    if (Node.isIdentifier(element)) {
      const relativePath = getImportPathFromFile(moduleFile, element.getText());

      if (relativePath && isLocalImport(relativePath)) {
        const importPath = getAbsolutePathFromFileImport(moduleFile.getFilePath().toString(), relativePath);

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

function getAbsolutePathFromFileImport(filePath: string, importPath: string, isTypescript = true): string {
  const part = filePath.split('/');
  part.pop();

  return path.join(part.join('/'), `${importPath}${isTypescript ? '.ts' : ''}`);
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
