import { tree } from "./tree";
import type { Node, BaseNode } from "estree";
/**
 * Rule library for different nodes.
 *
 * @param {{ functionRules: Object }} options - Rule options.
 */
var Rules = function (options) {
  this.data = {};
  this._addCategory("functions", options.functionRules);
};

/**
 * Gets the node context rules.
 *
 * @param {BaseNode} node - Node to get the rules for
 *
 * @returns {Object} Context rules or an empty rule object.
 */
Rules.prototype.get = function (node: BaseNode) {
  if (node.type === "CallExpression") return this.getFunctionRules(node);

  return {};
};

/**
 * Gets the node context rules.
 *
 * @param {BaseNode} node - Node to get the rules for
 *
 * @returns {Object} Context rules or an empty rule object.
 */
Rules.prototype.getFunctionRules = function (node: BaseNode) {
  return this._getWithCache(node, this.data.functions);
};

Rules.prototype._getWithCache = function (node: BaseNode, data) {
  var fullName = tree.getFullItemName(node);
  if (data.cache[fullName]) {
    return data.cache[fullName];
  }

  let rules = null;
  const partialNames = tree.getRuleNames(node);
  for (var i = 0; !rules && i < partialNames.length; i++) {
    rules = data.rules[partialNames[i]];
  }

  return (data.cache[fullName] = rules || {});
};

Rules.prototype._addCategory = function (type, rules) {
  this.data[type] = {
    cache: Object.create(null),
    rules: rules || {},
  };
};

module.exports = Rules;
