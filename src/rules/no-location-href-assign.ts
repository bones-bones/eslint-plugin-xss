/**
 * @fileoverview prevents xss by assignment to location href javascript url string
 * @author Alexander Mostovenko
 */
import type { Rule } from "eslint";
import {
  isBaseCallExpression,
  isMemberExpression,
  isPrivateIdentifier,
} from "../typeNarrowing";

// ------------------------------------------------------------------------------
// Plugin Definition
// ------------------------------------------------------------------------------

const ERROR = "Dangerous location.href assignment can lead to XSS";

const rule: Rule.RuleModule = {
  meta: {
    docs: {
      description: "disallow location.href assignment (prevent possible XSS)",
    },
  },
  create: function (context) {
    var escapeFunc =
      (context.options[0] && context.options[0].escapeFunc) || "escape";

    return {
      AssignmentExpression: function (node) {
        const left = node.left;
        const isHref =
          isMemberExpression(left) &&
          isPrivateIdentifier(left.property) &&
          left.property.name === "href";
        if (!isHref) {
          return;
        }

        if (isMemberExpression(left)) {
          const isLocationObject = left.object.name === "location";
          const isLocationProperty = left.object.property.name === "location";
          if (!(isLocationObject || isLocationProperty)) {
            return;
          }
        } else {
          return;
        }

        const sourceCode = context.getSourceCode();
        if (
          isBaseCallExpression(node.right) &&
          isPrivateIdentifier(node.right.callee) &&
          (node.right.callee.name === escapeFunc ||
            sourceCode.getText(node.right.callee) === escapeFunc)
        ) {
          return;
        }
        const rightSource = sourceCode.getText(node.right);
        const errorMsg = `${ERROR}. Please use ${escapeFunc}(${rightSource}) as a wrapper for escaping`;

        context.report({ node: node, message: errorMsg });
      },
    };
  },
};
export default rule;
