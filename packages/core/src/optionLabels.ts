/**
 * 去掉选项字符串开头与「第 index 项」对应的序号（模型常把「A. xxx」写进数组，Markdown 又会再加一层 A.）。
 * 仅识别与 index 对应的字母（A=0 …），避免误伤以其它字母开头的正文。
 */
export function stripRedundantChoicePrefix(option: string, index: number): string {
  const letter = String.fromCharCode(65 + index);
  const u = letter.toUpperCase();
  const l = letter.toLowerCase();
  let t = option.trim();
  for (let depth = 0; depth < 8; depth++) {
    const next = stripOneMatchingLabel(t, u, l);
    if (next === t) break;
    t = next;
  }
  return t;
}

function stripOneMatchingLabel(text: string, U: string, L: string): string {
  const t = text.trim();
  const bracketCn = new RegExp(`^（[${U}${L}]）\\s*[\\.\\)、．:：]\\s*`, "u");
  const bracketAsc = new RegExp(`^\\([${U}${L}]\\)\\s*[\\.\\)、．:：]\\s*`, "u");
  const plain = new RegExp(`^[${U}${L}]\\s*[\\.\\)、．:：]\\s*`, "u");
  for (const re of [bracketCn, bracketAsc, plain]) {
    const m = t.match(re);
    if (m) return t.slice(m[0].length).trim();
  }
  return t;
}
