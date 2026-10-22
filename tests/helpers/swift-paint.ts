// Chat UI appearance (fonts, colors, spacing, insets, sizes, alignment) is
// owner-tuned on device and changes often. Source-conservation tests compare
// SwiftUI structure, actions and data flow, so they strip these modifiers and
// layout arguments from both sides first. Interactions (Button, sheet,
// overlay, contextMenu, gestures, disabled, task/onChange) are never stripped.
const paintModifiers = [
  'font', 'fontWeight', 'fontDesign', 'foregroundStyle', 'foregroundColor', 'tint',
  'padding', 'frame', 'lineSpacing', 'tracking', 'kerning', 'shadow', 'opacity',
  'cornerRadius', 'clipShape', 'scaleEffect', 'rotationEffect', 'offset', 'lineLimit',
  'fixedSize', 'multilineTextAlignment', 'glassEffect', 'background', 'presentationBackground',
  'imageScale', 'symbolRenderingMode', 'controlSize', 'minimumScaleFactor', 'alignmentGuide',
];
const layoutArguments = ['spacing', 'minLength', 'alignment'];
const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

// Index of the quote that closes the string opened at `open`.
function stringEnd(source: string, open: number): number {
  let i = open + 1;
  while (i < source.length && source[i] !== '"') i += source[i] === '\\' ? 2 : 1;
  return i;
}

// Index of the bracket that closes the one at `open`, skipping strings.
function closing(source: string, open: number): number {
  const stack = [pairs[source[open]!]!];
  for (let i = open + 1; i < source.length; i++) {
    const char = source[i]!;
    if (char === '"') i = stringEnd(source, i);
    else if (pairs[char]) stack.push(pairs[char]!);
    else if (char === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return source.length - 1;
}

// Index of the top-level `,` or closing bracket that ends an argument value.
function argumentEnd(source: string, start: number): number {
  for (let i = start; i < source.length; i++) {
    const char = source[i]!;
    if (char === '"') i = stringEnd(source, i);
    else if (pairs[char]) i = closing(source, i);
    else if (char === ',' || char === ')' || char === ']') return i;
  }
  return source.length;
}

export function withoutSwiftPaint(source: string): string {
  let result = source;
  const call = new RegExp(`\\.(?:${paintModifiers.join('|')})\\s*\\(`, 'g');
  for (let match = call.exec(result); match; match = call.exec(result)) {
    const open = match.index + match[0].length - 1;
    result = result.slice(0, match.index) + result.slice(closing(result, open) + 1);
    call.lastIndex = match.index;
  }
  const argument = new RegExp(`([(,])\\s*(?:${layoutArguments.join('|')})\\s*:`, 'g');
  for (let match = argument.exec(result); match; match = argument.exec(result)) {
    const end = argumentEnd(result, match.index + match[0].length);
    // A leading argument takes its trailing comma; a later one takes its leading comma.
    const [from, to] = match[1] === '(' ? [match.index + 1, result[end] === ',' ? end + 1 : end] : [match.index, end];
    result = result.slice(0, from) + result.slice(to);
    argument.lastIndex = match.index;
  }
  // `VStack() {` and `VStack {` are the same view once arguments are gone.
  return result.replace(/\(\s*\)(\s*\{)/g, '$1');
}
