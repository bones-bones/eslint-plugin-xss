export const toRegexp = (str: string) => {
  var pair = str.split("/");
  return new RegExp(pair[0], pair[1]);
};

export const any = (input: string, regexps: RegExp[]) => {
  for (var i = 0; i < regexps.length; i++) {
    if (regexps[i].exec(input)) return true;
  }

  return false;
};
