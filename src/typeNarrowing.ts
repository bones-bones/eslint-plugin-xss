import type {
  BaseNode,
  SimpleCallExpression,
  MemberExpression,
  ThisExpression,
  Identifier,
  FunctionExpression,
  FunctionDeclaration,
  ArrowFunctionExpression,
  ArrayExpression,
  AssignmentExpression,
  ConditionalExpression,
  VariableDeclarator,
  Property,
} from "estree";

const isOfType =
  <T extends BaseNode>(type: string) =>
  (node: BaseNode): node is T =>
    node.type === type;

export const isSimpleCallExpression =
  isOfType<SimpleCallExpression>("CallExpression");

export const isMemberExpression =
  isOfType<MemberExpression>("MemberExpression");

export const isThisExpression = isOfType<ThisExpression>("ThisExpression");

export const isIdentifier = isOfType<Identifier>("Identifier");

export const isFunctionExpression =
  isOfType<FunctionExpression>("FunctionExpression");

export const isFunctionDeclaration = isOfType<FunctionDeclaration>(
  "FunctionDeclaration"
);
export const isArrowFunctionExpression = isOfType<ArrowFunctionExpression>(
  "ArrowFunctionExpression"
);

export const isAssignmentExpression = isOfType<AssignmentExpression>(
  "AssignmentExpression"
);

export const isVariableDeclarator =
  isOfType<VariableDeclarator>("VariableDeclarator");

export const isProperty = isOfType<Property>("Property");

export const isArrayExpression = isOfType<ArrayExpression>("ArrayExpression");

export const isConditionalExpression = isOfType<ConditionalExpression>(
  "ConditionalExpression"
);
