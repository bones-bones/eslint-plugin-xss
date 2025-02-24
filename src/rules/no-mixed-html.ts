import type {
  BaseNode,
  BaseCallExpression,
  Pattern,
  Expression,
  PrivateIdentifier,
} from "estree";
import type { Rule } from "eslint";
/**
 * @fileoverview Checks for missing encoding when concatenating HTML strings
 * @author Mikko Rantanen
 */

import * as re from "../re";
import * as tree from "../tree";
import * as Rules from "../Rules";
import {
  isArrayExpression,
  isAssignmentExpression,
  isProperty,
  isSimpleCallExpression,
  isVariableDeclarator,
} from "../typeNarrowing";

// -----------------------------------------------------------------------------
// Rule Definition
// -----------------------------------------------------------------------------

module.exports = function (context: Rule.RuleContext) {
  // Default options.
  var htmlVariableRules = ["html/i"];
  var htmlFunctionRules = ["AsHtml"];
  var functionRules = {
    ".join": { passthrough: { obj: true, args: true } },
    ".toString": { passthrough: { obj: true } },
    ".substr": { passthrough: { obj: true } },
    ".substring": { passthrough: { obj: true } },
  };

  // Read the user specified options.
  if (context.options.length > 0) {
    var opts = context.options[0];

    htmlVariableRules = opts.htmlVariableRules || htmlVariableRules;
    htmlFunctionRules = opts.htmlFunctionRules || htmlFunctionRules;
    functionRules = opts.functions || functionRules;
  }

  // Turn the name rules from string/string array to regexp.
  const htmlVariableRulesRegex = htmlVariableRules.map(re.toRegexp);
  htmlFunctionRules = htmlFunctionRules.map(re.toRegexp);

  var allRules = new Rules({
    functionRules: functionRules,
  });

  // Expression stack for tracking the topmost expression that is marked
  // XSS-candidate when we find '<html>' strings.
  var exprStack = [];

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Checks whether the node represents a passthrough function.
   *
   * @param {BaseNode} node - Node to check.
   *
   * @returns {bool} - True, if the node is an array join.
   */
  var getPassthrough = function (node: BaseNode) {
    if (node.type !== "CallExpression") return false;

    var rules = allRules.getFunctionRules(node);
    return rules.passthrough;
  };

  /**
   * Gets all descendants that we know to affect the possible output string.
   *
   * @param {BaseNode} node - Node for which to get the descendants. Inclusive.
   * @param {Node} _children - Collection of descendants. Leave null.
   * @param {Node} _hasRecursed -
   *      Defines whether the function has recursed into inner structures.
   *      Leave false.
   *
   * @returns {Node[]} - Flat list of descendant nodes.
   */
  var getDescendants = function (
    node: BaseCallExpression,
    _children,
    _hasRecursed
  ) {
    // The children array may be passed during recursion.
    if (_children === undefined) {
      _children = [];
    }

    // Handle the special case of .join() function.
    var passthrough = getPassthrough(node);
    if (passthrough) {
      // Get the descedants from the array and the function argument.
      if (passthrough.obj) {
        getDescendants(node.callee.object, _children, _hasRecursed);
      }

      if (passthrough.args) {
        node.arguments.forEach(function (a) {
          getDescendants(a, _children, _hasRecursed);
        });
      }

      return _children;
    }

    // Check the expression type.
    if (
      node.type === "CallExpression" ||
      node.type === "NewExpression" ||
      node.type === "ThisExpression" ||
      node.type === "ObjectExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "UnaryExpression" ||
      node.type === "UpdateExpression" ||
      node.type === "MemberExpression" ||
      node.type === "SequenceExpression" ||
      node.type === "Literal" ||
      node.type === "Identifier" ||
      (_hasRecursed && node.type === "ArrayExpression")
    ) {
      // Basic expressions that won't be reflected further.
      _children.push(node);
    } else if (node.type === "ArrayExpression") {
      // For array nodes, get the descendant nodes.
      node.elements.forEach(function (e) {
        getDescendants(e, _children, true);
      });
    } else if (node.type === "BinaryExpression") {
      // Binary expressions concatenate strings.
      //
      // Recurse to both left and right side.
      getDescendants(node.left, _children, true);
      getDescendants(node.right, _children, true);
    } else if (node.type === "AssignmentExpression") {
      // There might be assignment expressions in the middle of the node.
      // Use the assignment identifier as the descendant.
      //
      // The assignment itself will be checked with its own descendants
      // check.
      getDescendants(node.left, _children, _hasRecursed);
    } else if (node.type === "ConditionalExpression") {
      getDescendants(node.alternate, _children, _hasRecursed);
      getDescendants(node.consequent, _children, _hasRecursed);
    }

    return _children;
  };

  /**
   * Checks whether the node is safe for XSS attacks.
   *
   * @param {BaseNode} node - Node to check.
   *
   * @returns {bool} - True, if the node is XSS safe.
   */
  var isXssSafe = function (node) {
    // See if the item is commented to be safe.
    if (isCommentedSafe(node)) return true;

    // Literal nodes and function expressions are okay.
    if (node.type === "Literal" || node.type === "FunctionExpression") {
      return true;
    }

    // Identifiers and member expressions are okay if they resolve to an
    // HTML name.
    if (node.type === "Identifier" || node.type === "MemberExpression") {
      // isHtmlVariable handles both Identifiers and member expressions.
      return isHtmlVariable(node);
    }

    // Encode calls are okay.
    if (node.type === "CallExpression") {
      return isHtmlOutputFunction(node.callee);
    }

    // Assume unsafe.
    return false;
  };

  /**
   * Check for whether the function identifier refers to an encoding function.
   *
   * @param {Identifier} func - Function identifier to check.
   *
   * @returns {bool} True, if the function is an encoding function.
   */
  var isHtmlOutputFunction = function (func) {
    return (
      allRules.getFunctionRules(func).htmlOutput ||
      re.any(tree.getFullItemName(func), htmlFunctionRules)
    );
  };

  /**
   * Checks whether the function uses raw HTML input.
   *
   * @param {Identifier} func - Function identifier to check.
   *
   * @returns {bool} True, if the function is unsafe.
   */
  var functionAcceptsHtml = function (func) {
    return allRules.getFunctionRules(func).htmlInput;
  };

  /**
   * Checks whether the node-tree contains XSS-safe data.
   *
   * Reports error to ESLint.
   *
   * @param {BaseNode} node - Root node to check.
   * @param {Node} target
   *      Target node the root is used for. Affects some XSS checks.
   */
  var checkForXss = function (node: BaseNode, target) {
    // Skip functions.
    // This stops the following from giving errors:
    // > htmlEncoder = function() {}
    if (
      node.type === "FunctionExpression" ||
      node.type === "ObjectExpression"
    ) {
      return;
    }

    // Get the rules.
    var targetRules = allRules.get(target);

    // Get the descendants.
    var nodes = getDescendants(node);

    // Check each descendant.
    nodes.forEach(function (childNode) {
      // Return if the parameter is marked as safe in the current context.
      if (targetRules.safe === true) {
        return;
      } else if (targetRules?.safe?.includes(tree.getNodeName(childNode))) {
        return;
      }

      // Node is okay, if it is safe.
      if (isXssSafe(childNode)) return;

      // Node wasn't deemed okay. Report error.
      var msg = "Unencoded input '{{ identifier }}' used in HTML context";
      if (childNode.type === "CallExpression") {
        msg =
          "Unencoded return value from function '{{ identifier }}' " +
          "used in HTML context";
        childNode = childNode.callee;
      }

      var identifier = null;
      if (childNode.type === "ObjectExpression") identifier = "[Object]";
      else if (childNode.type === "ArrayExpression") identifier = "[Array]";
      else identifier = context.getSource(childNode);

      context.report({
        node: childNode,
        message: msg,
        data: { identifier: identifier },
      });
    });
  };

  /**
   * Checks whether the node uses HTML.
   *
   * @param {BaseNode} node - Node to check.
   *
   * @returns {bool} True, if the node uses HTML.
   */
  const usesHtml = function (
    node: BaseNode & Rule.NodeParentExtension
  ): boolean {
    // Check the node type.
    if (isSimpleCallExpression(node)) {
      // Check the valid call expression callees.
      return functionAcceptsHtml(node.callee);
    } else if (isAssignmentExpression(node)) {
      // Assignment operator.
      // x = y
      // HTML-name on the left indicates html expression.
      return isHtmlVariable(node.left);
    } else if (isVariableDeclarator(node)) {
      // Variable declaration.
      // var x = y
      // HTML-name as the variable name indicates html expression.
      return isHtmlVariable(node.id);
    } else if (isProperty(node)) {
      // Property declaration.
      // x: y
      // HTML-name as the key indicates html property.
      return isHtmlVariable(node.key);
    } else if (isArrayExpression(node)) {
      // Array expression.
      // [ a, b, c ]
      return usesHtml(node.parent);
    } else if (node.type === "ReturnStatement") {
      // Return statement.
      let func = tree.getParentFunctionIdentifier(node);
      if (!func) {
        return false;
      }

      return isHtmlFunction(func);
    } else if (node.type === "ArrowFunctionExpression") {
      // Return statement.
      let func = tree.getParentFunctionIdentifier(node);
      if (!func) {
        return false;
      }

      return isHtmlFunction(func);
    }

    return false;
  };

  /**
   * Checks whether the node meets the criteria of storing HTML content.
   *
   * Reports error to ESLint.
   *
   * @param {BaseNode} node - The node to check.
   */
  var checkHtmlVariable = function (node) {
    var msg = "Non-HTML variable '{{ identifier }}' is used to store raw HTML";
    if (!isXssSafe(node)) {
      context.report({
        node: node,
        message: msg,
        data: {
          identifier: context.getSource(node),
        },
      });
    }
  };

  /**
   * Checks whether the node meets the criteria of storing HTML content.
   *
   * Reports error to ESLint.
   *
   * @param {BaseNode} node - The node to check.
   * @param {Node} fault
   *      The node that causes the fail and should be reported as error location.
   */
  var checkHtmlFunction = function (node, fault) {
    var msg = "Non-HTML function '{{ identifier }}' returns HTML content";
    if (!isXssSafe(node)) {
      context.report({
        node: fault,
        message: msg,
        data: {
          identifier: context.getSource(node),
        },
      });
    }
  };

  /**
   * Checks whether the node meets the criteria of storing HTML content.
   *
   * Reports error to ESLint.
   *
   * @param {BaseNode} node - The node to check.
   */
  var checkFunctionAcceptsHtml = function (node) {
    if (!functionAcceptsHtml(node)) {
      context.report({
        node: node,
        message: "HTML passed in to function '{{ identifier }}'",
        data: {
          identifier: context.getSource(node),
        },
      });
    }
  };

  /**
   * Checks whether the node name matches the variable naming rule.
   *
   * @param {BaseNode} node - Node to check
   *
   * @returns {bool} True, if the node matches HTML variable naming.
   */
  var isHtmlVariable = function (
    node: Pattern | Expression | PrivateIdentifier
  ) {
    // Ensure we can get the identifier.
    node = tree.getIdentifier(node);
    if (!node) return false;

    // Make the check against the htmlVariableRules regexp.
    return re.any(node.name, htmlVariableRulesRegex);
  };

  /**
   * Checks whether the node name matches the function naming rule.
   *
   * @param {BaseNode} node - Node to check
   *
   * @returns {bool} True, if the node matches HTML function naming.
   */
  var isHtmlFunction = function (node) {
    // Ensure we can get the identifier.
    node = tree.getIdentifier(node);
    if (!node) return false;

    // Make the check against the function naming rule.
    return re.any(node.name, htmlFunctionRules);
  };

  /**
   * Checks whether the current node may infect the stack with XSS.
   *
   * @param {BaseNode} node - Current node.
   *
   * @returns {bool} True, if the node can infect the stack.
   */
  var canInfectXss = function (node) {
    // If we got nothing in the stack, there's nothing to infect.
    if (exprStack.length === 0) return false;

    // Ensure the node to check is used as part of a 'parameter chain' from
    // the top stack node.
    //
    // This 'parameter chain' is the group of nodes that directly affect the
    // node result. It ignores things like function expression argument
    // lists and bodies, etc.
    //
    // We don't want to trigger xss checks in case the identifier
    // is the parent object of a function call expression for
    // example:
    // > html.encode( text )
    var top = exprStack[exprStack.length - 1].node;
    var parent = node;
    do {
      var child = parent;
      parent = parent.parent;

      if (!tree.isParameter(child, parent)) {
        return false;
      }
    } while (parent !== top);

    // Assume true.
    return true;
  };

  /**
   * Pushes node to the expression stack.
   *
   * @param {BaseNode} node - Node to push.
   */
  var pushNode = function (node) {
    exprStack.push({ node: node });
  };

  /**
   * Pops a node from the expression stack and checks it for XSS issues.
   */
  var exitNode = function () {
    // Quick checks for whether the node is even vulnerable to XSS.
    var expr = exprStack.pop();
    if (!expr.xss && !usesHtml(expr.node)) return;

    // Now we should know there is HTML involved somewhere.

    // Check whether the node has been commented safe.
    if (isCommentedSafe(expr.node)) return;

    // Check the node based on its type.
    if (expr.node.type === "CallExpression") {
      // Call expression.
      //
      // Ensure the function accepts HTML and none of the arguments have
      // XSS issues.
      checkFunctionAcceptsHtml(expr.node.callee);
      expr.node.arguments.forEach(function (a) {
        checkForXss(a, expr.node);
      });
    } else if (expr.node.type === "AssignmentExpression") {
      // Assignment.
      //
      // Ensure the target variable is HTML compatible and the assigned
      // value doesn't have XSS issues.
      checkHtmlVariable(expr.node.left);
      checkForXss(expr.node.right, expr.node);
    } else if (expr.node.type === "VariableDeclarator") {
      // New variable initialization.
      //
      // Ensure the target variable is HTML compatible and the assigned
      // value doesn't have XSS issues.
      checkHtmlVariable(expr.node.id);
      if (expr.node.init) checkForXss(expr.node.init, expr.node);
    } else if (expr.node.type === "Property") {
      // Property declaration inside an object declaration.
      //
      // Ensure the target property is HTML compatible and the assigned
      // value doesn't have XSS issues.
      checkHtmlVariable(expr.node.key);
      checkForXss(expr.node.value, expr.node);
    } else if (expr.node.type === "ReturnStatement") {
      // Return statement.
      //
      // Make sure the function we are returning from is compatible
      // with a HTML return value and there are no XSS issues in the
      // value returned.

      // Get the closest function scope.
      let func = tree.getParentFunctionIdentifier(expr.node);
      if (!func) return;

      checkHtmlFunction(func, expr.node);
      checkForXss(expr.node.argument, expr.node);
    } else if (expr.node.type === "ArrowFunctionExpression") {
      // Arrow function expression.
      //
      // Make sure the function we are returning from is compatible
      // with a HTML return value and there are no XSS issues in the
      // value returned.

      // Get the closest function scope.
      let func = tree.getParentFunctionIdentifier(expr.node);
      if (!func) return;

      checkHtmlFunction(func, func);
      checkForXss(expr.node.body, expr.node);
    }
  };

  var markParentXSS = function () {
    // Ensure the current node is XSS candidate.
    var expr = exprStack.pop();
    if (!expr.xss && !usesHtml(expr.node)) return;

    // Mark the parent element as XSS candidate.
    var candidate = getXssCandidateParent(expr.node);
    if (candidate) candidate.xss = true;
  };

  /**
   * Checks whether the given node is commented to be safe from HTML.
   *
   * @param {BaseNode} node - The node to check for the comments.
   *
   * @returns {bool} True, if the node is commented safe.
   */
  var isCommentedSafe = function (node) {
    while (
      node &&
      (node.type === "ArrayExpression" ||
        node.type === "Identifier" ||
        node.type === "Literal" ||
        node.type === "CallExpression" ||
        node.type === "BinaryExpression" ||
        node.type === "MemberExpression")
    ) {
      if (nodeHasSafeComment(node)) return true;

      node = getCommentParent(node);
    }

    return false;
  };

  /**
   * Gets a parent node that might have a comment that is seemingly
   * attached to the current node.
   *
   * This might differ from normal parent node in cases where the
   * physical location of the node isn't at the start of the parent:
   *
   * /comment/ a + b
   *
   * Here the comment is attached to the binary expression node 'a+b' instead
   * of the a 'a' identifier node.
   *
   * However 'a' should still be considered commented - but 'b' isn't.
   *
   * However this function also handles situation such as
   * /comment/ ( a + b )
   * Where the comment should count for both a and b.
   *
   * @param {BaseNode} node - The node to get the parent for.
   *
   * @returns {Node} The practical parent node.
   */
  var getCommentParent = function (node) {
    var parent = node.parent;
    if (!parent) return parent;

    // Call expressions don't cause comment inheritance:
    // /comment/ foo( unsafe() )
    //
    // Shouldn't equal:
    // foo( /comment/ unsafe() )
    if (parent.type === "CallExpression") return null;

    // Binary expressions are a bit confusing when it comes to comment
    // parenting. /comment/ x + y belongs to the binary expression instead
    // of 'x'.
    if (parent.type === "BinaryExpression") {
      // If the node is left side of binary expression, return parent no
      // matter what.
      if (node === parent.left) return parent;

      // Get the closest parenthesized binary expression.
      while (
        parent &&
        parent.type === "BinaryExpression" &&
        !hasParentheses(parent)
      ) {
        parent = parent.parent;
      }

      if (parent && parent.type === "BinaryExpression") return parent;

      return null;
    }

    return parent;
  };

  /**
   * Checks whether the node is surrounded by parentheses.
   *
   * @param {BaseNode} node - Node to check for parentheses.
   *
   * @returns {bool} True, if the node is surrounded with parentheses.
   */
  var hasParentheses = function (node) {
    var prevToken = context.getTokenBefore(node);

    return prevToken.type === "Punctuator" && prevToken.value === "(";
  };

  /**
   * Checks whether the given node is commented to be safe from HTML.
   *
   * @param {BaseNode} node - Node to check.
   *
   * @returns {bool} True, if this specific node has a /safe/ comment.
   */
  var nodeHasSafeComment = function (node) {
    // Check all the comments in front of the node for comment 'safe'
    var isSafe = false;
    var comments = context.getSourceCode().getComments(node);
    comments.leading.forEach(function (comment) {
      if (/^\s*safe\s*$/i.exec(comment.value)) isSafe = true;
    });

    return isSafe;
  };

  /**
   * Gets the closest parent node that matches the given type. May return the
   * node itself.
   *
   * @param {BaseNode} node - The node to start the search from.
   * @param {string} parentType - The node type to search.
   *
   * @returns {Node} The closest node of the correct type.
   */
  var getPathFromParent = function (node, parentType) {
    var path = [node];
    while (node && node.type !== parentType) {
      node = node.parent;
      path.push(node);
    }

    if (!node) return null;

    path.reverse();
    return path;
  };

  var getXssCandidateParent = function (node) {
    // Find the infectable node.
    //
    // This takes care of call expressions that might use
    // passthrough functions. Here we need to check whether the
    // current node is in a passthrough position.
    for (var ptr = exprStack.length - 1; ptr >= 0; ptr--) {
      // Only CallExpressions may pass through the parameters.
      var candidate = exprStack[ptr];
      if (candidate.node.type !== "CallExpression") return candidate;

      // Quick check for whether this is an passthrough at all.
      var functionRules = allRules.get(candidate.node);
      if (!functionRules.passthrough) return candidate;

      // The function is at least a partial passthrough.
      // Quickly check whether it passes everything through.
      if (functionRules.passthrough.obj && functionRules.passthrough.args)
        continue;

      // Only obj OR args is passed through. Figure out which one the
      // current node is.
      var path = getPathFromParent(node, "CallExpression");
      var callExpr = path[0];
      var callImmediateChild = path[1];

      var isCallee = callImmediateChild === callExpr.callee;
      var isParam = !isCallee;

      // Continue to next stack part if the function passes the obj through
      // and the current node is the obj.
      if (isCallee && functionRules.passthrough.obj) continue;

      // Continue to next stack part if the function passes the args through
      // and the current node is an argument.
      if (isParam && functionRules.passthrough.args) continue;

      return candidate;
    }

    return null;
  };

  var infectParentConditional = function (condition, node) {
    if (
      exprStack.length > 0 &&
      !isCommentedSafe(node) &&
      canInfectXss(node) &&
      condition(node)
    ) {
      var infectable = getXssCandidateParent(node);
      if (infectable) infectable.xss = true;
    }
  };

  // -------------------------------------------------------------------------
  // Public
  // -------------------------------------------------------------------------

  return {
    AssignmentExpression: pushNode,
    "AssignmentExpression:exit": exitNode,
    VariableDeclarator: pushNode,
    "VariableDeclarator:exit": exitNode,
    Property: pushNode,
    "Property:exit": exitNode,
    ReturnStatement: pushNode,
    "ReturnStatement:exit": exitNode,
    ArrowFunctionExpression: pushNode,
    "ArrowFunctionExpression:exit": exitNode,
    ArrayExpression: pushNode,
    "ArrayExpression:exit": markParentXSS,

    // Call expressions have a dual nature. They can either infect their
    // parents with XSS vulnerabilities or then they can suffer from them.
    CallExpression: function (node) {
      // First check whether this expression marks the parent as dirty.
      infectParentConditional(function (node) {
        return isHtmlOutputFunction(node.callee);
      }, node);
      pushNode(node);
    },
    "CallExpression:exit": exitNode,

    // Literals infect parents if they contain <html> tags or fragments.
    Literal: infectParentConditional.bind(null, function (node) {
      // Skip regex and /*safe*/ strings. Remaining strings infect parent
      // if they contain <html or </html tags.
      return (
        !node.regex && !isCommentedSafe(node) && /<\/?[a-z]/.exec(node.value)
      );
    }),

    // Identifiers infect parents if they refer to HTML in their name.
    Identifier: infectParentConditional.bind(null, function (node) {
      return isHtmlVariable(node);
    }),
  };
};

module.exports.schema = [
  {
    type: "object",
    properties: {
      htmlVariableRules: { type: "array" },
      htmlFunctionRules: { type: "array" },
      functions: { type: "object" },
    },
    additionalProperties: false,
  },
];
