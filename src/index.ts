/**
 * @fileoverview Validates M-Files coding conventions
 * @author Mikko Rantanen
 */

import requireindex from "requireindex";

// -----------------------------------------------------------------------------
// Requirements
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Plugin Definition
// -----------------------------------------------------------------------------

// import all rules in lib/rules

export const rules = requireindex(__dirname + "/rules");

// allow users to extend the recommended configurations
export const configs = {
  recommended: {
    plugins: ["xss"],
    rules: {
      "xss/no-mixed-html": "error",
      "xss/no-location-href-assign": "error",
    },
  },
};
