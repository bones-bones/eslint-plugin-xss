import type {
  BaseFunction,
  BaseNode,
  BaseCallExpression,
  BaseExpression,
} from "estree";
import type { Rule } from "eslint";
import {
  isArrayExpression,
  isArrowFunctionExpression,
  isAssignmentExpression,
  isConditionalExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isMemberExpression,
  isProperty,
  isSimpleCallExpression,
  isThisExpression,
  isVariableDeclarator,
} from "./typeNarrowing";

/**
 * Gets the identifier from the node.
 *
 * @param {BaseNode} node - Node to get the identifier for.
 *
 * @returns {Identifier} - The identifier node.
 */
export const getIdentifier = function (node: BaseNode) {
  // Function calls use the callee as name.
  if (isSimpleCallExpression(node)) {
    node = node.callee;
  }

  // Get the member property.
  if (isMemberExpression(node)) {
    if (node.computed) {
      node = node.object;
    } else {
      node = node.property;
    }
  }

  if (isIdentifier(node)) {
    return node;
  }

  return null;
};

/**
 * Gets the name of the node.
 *
 * @param {BaseNode} node - The node to get the name for.
 *
 * @returns {string} Node name.
 */
export const getNodeName = function (node: BaseNode) {
  // Check the 'this' expression.
  if (isThisExpression(node)) {
    return "this";
  }

  // Expect identifier or similar node.
  var id = tree.getIdentifier(node);
  return id ? id.name : "";
};

/**
 * Gets the function name.
 *
 * @param {Node} func - Function node.
 *
 * @returns {string} Function name with optional '.' for member functions.
 */
// TODO: func could be narrower
export const getFullItemName = function (func: BaseNode) {
  // Unwrap the possible call expression.
  if (isSimpleCallExpression(func)) {
    func = func.callee;
  }

  // Resolve the name stack from the member expression.
  // This gathers it in reverse.
  var name = [];
  while (isMemberExpression(func)) {
    name.push(func.property.name);
    func = func.object;
  }

  // Ensure the last object name is an identifier at this point.
  // We don't support [] indexed access for encoders.
  if (isIdentifier(func)) {
    name.push(func.name);
  }

  // Reverse the stack to get it in correct order and join function names
  // using '.'
  name.reverse();

  return name.join(".");
};

/**
 * Gets the function name candidates for the rules.
 *
 * @param {BaseNode} func - Function node.
 *
 * @returns {string} Names of rules that affect this function.
 */
export const getRuleNames = function (func: BaseNode) {
  // Unwrap the possible call expression.
  if (isSimpleCallExpression(func)) {
    func = func.callee;
  }

  // Unwrap the member expressions and get the last identifier.
  var names = [];
  var memberIdentifiers = [];
  for (; func; func = func.object) {
    // Skip computed properties.
    if (func.computed) {
      continue;
    }

    var identifier = tree.getIdentifier(func);
    if (!identifier) {
      break;
    }

    memberIdentifiers.unshift(identifier.name);

    // Add '.' prefix is this is part of a member function.
    var prefix = func.object ? "." : "";
    names.unshift(prefix + memberIdentifiers.join("."));
  }

  return names;
};

/**
 * Gets the parent function identifier.
 *
 * @param {BaseNode} node - Node for which to get the parent function.
 *
 * @returns {Identifier} - The function identifier or null.
 */
export const getParentFunctionIdentifier = function (
  node: BaseExpression & Rule.NodeParentExtension
) {
  // We'll want to get the closest function.
  var func = node;

  while (
    func &&
    !isFunctionExpression(func) &&
    !isFunctionDeclaration(func) &&
    !isArrowFunctionExpression(func)
  ) {
    // Continue getting the parent.
    func = func.parent;
  }

  // Not everything is inside functions.
  if (!func) {
    return null;
  }

  // If the function is named, return the function name.
  if (func.id) {
    return func.id;
  }

  // Otherwise see if it is being assigned to a variable.
  var parent = func.parent;

  if (parent) {
    if (parent.type === "VariableDeclarator") {
      return parent.id;
    }
    if (parent.type === "AssignmentExpression") {
      return parent.left;
    }
  }

  return null;
};

/**
 * Checks whether the node is part of the parameters of the expression.
 *
 * @param {BaseNode} node - Node to check.
 * @param {Expression} expr - The expression we are interested in.
 *
 * @returns {bool} True, if the node is a parameter.
 */
export const isParameter = function (node: BaseNode, expr: BaseCallExpression) {
  if (isSimpleCallExpression(expr)) {
    // Check whether any of the call arguments equals the node.
    let isParameter = false;
    expr.arguments.forEach((a) => {
      if (a === node) {
        isParameter = true;
      }
    });
    // Return the result.
    return isParameter;
  }
  if (isAssignmentExpression(expr)) {
    // Assignments count the right side as the paramter.
    return expr.right === node;
  }
  if (isVariableDeclarator(expr)) {
    // Declaration count the init expression as the paramter.
    return expr.init === node;
  }
  if (isProperty(expr)) {
    // Properties consider the property value as the parameter.
    return expr.value === node;
  }
  if (isArrayExpression(expr)) {
    // For arrays check whether the node is any of the elements.
    let isElement = false;
    expr.elements.forEach((e) => {
      if (e === node) {
        isElement = true;
      }
    });
    return isElement;
  }
  if (expr.type === "FunctionExpression") {
    // Function expression has no 'parameters'.
    // None of the fields end up directly into the HTML (that we know
    // of without solving the halting problem...)
    return false;
  }
  if (isConditionalExpression(expr)) {
    return node === expr.alternate || node === expr.consequent;
  }
  if (isArrowFunctionExpression(expr)) {
    return node === expr.body;
  }

  return true;
};
