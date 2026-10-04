// Decides whether a snippet contains any real code, or is only the LeetCode / NeetCode
// starter template (class wrapper + empty method signature, comments, `pass`, ...).
// Used to skip pointless LLM calls. Deliberately conservative: it only says "no real code"
// when EVERY line is recognisable boilerplate, so real code is never skipped by mistake.
(function (root) {
  const MODS = '(?:public|private|protected|internal|static|final|override|async|export|pub|open|abstract|virtual|inline|extern|unsafe|sealed|partial|readonly)';
  const CONTROL = /^(?:if|for|while|switch|catch|return|else|elif|do|try|with|assert|print|throw|raise|yield|await|new|delete|case|default|foreach|until|unless|del|not|lambda)\b/;

  const RULES = [
    /^[\s{}()[\];:,]*$/,                                                            // only punctuation: "}", "};", ")"
    /^(?:@|#\[)/,                                                                    // decorators / attributes
    new RegExp('^(?:' + MODS + '\\s+)*(?:class|struct|interface|enum|impl|trait|object|namespace|record|package|module)\\b'),
    /^(?:import|from\s+\S+\s+import|using|include|require|use)\b/,
    /^(?:public|private|protected)\s*:$/,                                            // C++ access specifiers
    /^(?:pass|\.\.\.)\s*;?$/,                                                        // empty-body placeholders
    // stub returns: `return 0;`, `return null;`, `return []`, `return new int[0];`, `return {};`, ...
    /^return\b\s*(?:-?\d+(?:\.\d+)?|null|nullptr|nil|none|false|true|""|''|\[\]|\{\}|\(\)|new\s+[\w<>]+(?:\[\s*\d*\s*\]|\(\s*\))|[\w:<>]+\{\}|vec!\[\]|Vec::new\(\)|String::new\(\))?\s*;?$/i,
    // python:  def f(self, nums: List[int]) -> int:
    /^(?:async\s+)?def\s+\w+\s*\(.*\)\s*(?:->\s*[^:]+?)?\s*:$/,
    // go / rust / swift / kotlin / js function declarations, signature only (no body on the same line)
    new RegExp('^(?:' + MODS + '\\s+)*(?:func|fun|fn|function)\\b[^{};=]*\\{?$'),
    // js/ts:  var f = function(a, b) {   |   const f = (a: number): number => {
    /^(?:var|let|const)\s+[\w$]+\s*=\s*(?:async\s*)?(?:function\b[^{};]*|\([^)]*\)\s*(?::\s*[^=;{]+)?\s*=>)\s*\{?$/,
  ];
  // c++ / java / c# / ts methods:  [modifiers] [return type] name(params) [qualifiers] {
  const C_METHOD = /^(?:[\w:<>[\],&*?.\s]+?\s+)?[\w$~:]+\s*\([^;{}]*\)\s*(?:const|noexcept|override|final|throws\s+[\w.,\s]+|:\s*[^;{}=]+|->\s*[^;{}]+)?\s*\{$/;
  const C_METHOD_ALLMAN = /^(?!.*<<)[\w:<>[\],&*?.\s]+?\s+[\w$~:]+\s*\([^;{}]*\)\s*(?:const|noexcept|override|final)?$/; // "{" is on the next line

  function stripComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')                  // block comments / JSDoc
      .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, ' ')     // python docstrings
      .replace(/(^|\s)\/\/.*$/gm, '$1')                   // line comments (leaves "http://")
      .replace(/(^|\s)#.*$/gm, '$1');                     // python comments, #include
  }

  function isBoilerplate(line) {
    if (RULES.some((re) => re.test(line))) return true;
    if (CONTROL.test(line)) return false;
    return C_METHOD.test(line) || C_METHOD_ALLMAN.test(line);
  }

  function hasRealCode(code) {
    const lines = stripComments(String(code || '')).split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.some((l) => !isBoilerplate(l));
  }

  root.lcxHasRealCode = hasRealCode;
  if (typeof module !== 'undefined' && module.exports) module.exports = hasRealCode;
})(typeof self !== 'undefined' ? self : globalThis);
