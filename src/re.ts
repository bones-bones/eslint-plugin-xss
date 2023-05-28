export const toRegexp = (str: string) => {
  const pair = str.split("/");
  return new RegExp(pair[0], pair[1]);
};

export const any = (input: string, regexps: RegExp[]) => {
  for (let i = 0; i < regexps.length; i++) {
    if (regexps[i].exec(input)) return true;
  }

  return false;
};
