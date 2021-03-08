export type ASTFile = {
  path: string;
  name: string;
};

export type ComponentElementProperty = {
  static: boolean;
  value?: any;
  variable?: string;
};

export type ComponentElement = {
  type: string;
  properties: Record<string, ComponentElementProperty>;
};

export type ComponentGlobalVariable = {
  type: string;
  value: any;
  modifier: string;
  usedInTemplate: boolean;
  usedInComponent: boolean;
};

export type ComponentConstructorParameter = {
  modifier: string;
  type: string;
  isInternal: boolean;
  isGlobal: boolean;
};

export type Statement = {
  variableDeclaration?: {
    name: string;
    value: string;
    import?: {
      path: string;
    };
  };
  callExpression?: {
    from?: 'parameter' | 'global';
    // variable: string;
    calls: string[];
    parameters: string[];
  };
  binaryExpression?: {
    property: string;
    value?: string;
    subscribeExpression?: {
      calls: string[];
      parameters: Array<{
        type: string;
        name: string;
      }>;
      statements: Statement[];
    };
  };
  if?: {
    condition: string;
    statements: Statement[];
  };
};

export type Component = {
  file: ASTFile;
  selector: string;
  templateUrl: string;
  styleUrls: string[];
  html: Partial<{
    hasRouterOutlet: boolean;
    elements: Array<ComponentElement>;
  }>;
  component: {
    globalVariables: Record<string, ComponentGlobalVariable>;
    constructor: {
      parameters: Record<string, ComponentConstructorParameter>;
      statements: Statement[];
    };
    implements: string[];
    lifecycle?: {
      onInit?: {
        implemented: boolean;
        statements: Statement[];
      };
      onDestroy?: {
        implemented: boolean;
        statements: Statement[];
      };
    };
  };
};

export type AST = {
  angular: {
    main: Partial<{
      prefix: string;
      path: string;
      module: ASTFile;
      moduleRouter: ASTFile;
      bootstrapElement: Partial<Component>;
    }>;
  };
};
