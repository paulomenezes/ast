export type ASTFile = {
  path: string;
  name: string;
};

export type AST = {
  angular: {
    main: Partial<{
      path: string;
      module: ASTFile;
      moduleRouter: ASTFile;
      bootstrapElement: ASTFile;
    }>;
  };
};
