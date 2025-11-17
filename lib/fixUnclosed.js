/**
 * LLM 结果修复工具
 * 自动修复未闭合的 JSON / XML / HTML 结构
 *
 * 功能：
 * - JSON：补全缺失的大括号、中括号、逗号；处理不匹配的括号嵌套
 * - XML：补全未闭合标签、自闭合标签
 *
 * JSON 修复策略：
 * 1. 扫描时维护括号栈，追踪所有未匹配的开括号
 * 2. 当遇到不匹配的闭括号时（例如遇到 ] 但栈顶是 {），在该位置前自动插入缺失的闭括号
 * 3. 扫描结束后，补全栈中剩余的所有未闭合括号
 * 4. 清理多余的尾部逗号
 *
 * 示例：
 * 输入: [{...}, {...  ]
 * 输出: [{...}, {...}]  (自动在 ] 前插入缺失的 })
 */

/**
 * 判断输入是否很可能是 JSON 格式
 */
function isLikelyJSON(input = '') {
  const s = (input || '').trimStart();
  if (!s) return false;
  if (s.startsWith('{') || s.startsWith('[')) return true;
  if (s.includes(':{') || s.includes('":[') || s.includes('"type"')) return true;
  return false;
}

/**
 * 去掉 JSON 末尾多余的逗号
 */
function stripTrailingCommas(text) {
  return text.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * 在对象/数组之间补上缺失的逗号
 * 场景：`}{` / `][` 替换为 `},{` / `],[`
 */
function addMissingCommas(text) {
  return text
    .replace(/}\s*({|\[)/g, '},$1')
    .replace(/]\s*({|\[)/g, '],$1');
}

/**
 * 尝试修复 JSON 结构本身
 *
 * 核心策略：
 * 1. 扫描文本，追踪所有未匹配的开括号
 * 2. 当遇到不匹配的闭括号时，在该位置前插入需要的闭括号
 * 3. 最后在文本末尾补全剩余未闭合的括号
 */
function fixJSONStructure(input = '') {
  let text = (input || '').replace(/\ufeff/g, '').replace(/[\u200B-\u200D\u2060]/g, '');

  // 先添加缺失的逗号（对象/数组之间）
  text = addMissingCommas(text);

  const stack = [];
  let inString = false;
  let escaped = false;
  let result = '';
  let lastNonWhitespaceChar = '';

  // 扫描并重建文本，插入缺失的闭合括号
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // 处理字符串内部
    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    // 字符串开始
    if (ch === '"') {
      inString = true;
      escaped = false;
      result += ch;
      continue;
    }

    // 处理开括号
    if (ch === '{' || ch === '[') {
      stack.push(ch);
      result += ch;
      lastNonWhitespaceChar = ch;
      continue;
    }

    // 处理闭括号
    if (ch === '}' || ch === ']') {
      const need = ch === '}' ? '{' : '[';

      // 如果栈顶不匹配，需要先闭合栈中所有不匹配的括号
      while (stack.length > 0 && stack[stack.length - 1] !== need) {
        const unclosed = stack.pop();
        const closing = unclosed === '{' ? '}' : ']';
        // 在当前闭括号之前插入需要的闭括号
        result += closing;
        lastNonWhitespaceChar = closing;
      }

      // 现在栈顶应该匹配了（或栈为空）
      if (stack.length > 0 && stack[stack.length - 1] === need) {
        stack.pop();
      }

      result += ch;
      lastNonWhitespaceChar = ch;
      continue;
    }

    // 其他字符直接添加
    result += ch;
    if (!/\s/.test(ch)) {
      lastNonWhitespaceChar = ch;
    }
  }

  // 修复未闭合的字符串
  if (inString) {
    result += '"';
    lastNonWhitespaceChar = '"';
  }

  // 如果最后一个非空白字符是逗号，去掉它
  if (lastNonWhitespaceChar === ',') {
    result = result.trimEnd();
    if (result.endsWith(',')) {
      result = result.slice(0, -1);
    }
  }

  // 补全栈中剩余的未闭合括号
  while (stack.length > 0) {
    const unclosed = stack.pop();
    result += unclosed === '{' ? '}' : ']';
  }

  // 最后统一清理多余的逗号（在闭合括号之前）
  result = stripTrailingCommas(result);

  return result;
}

/**
 * 修复 JSON 字符串
 * 会尽量在不破坏内容的前提下补全
 */
export function fixJSON(input = '') {
  const raw = (input || '').trim();
  if (!raw) return raw;

  try {
    JSON.parse(raw);
    return raw;
  } catch {}

  const fixed = fixJSONStructure(raw);
  try {
    JSON.parse(fixed);
    return fixed;
  } catch {}

  const second = stripTrailingCommas(fixed);
  return second;
}

/**
 * HTML 自闭合标签 + Draw.io / Excalidraw 中的自闭合标签
 */
const DEFAULT_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
  'mxgeometry',
  'mxpoint', // Draw.io 中的无子节点标签
]);

/**
 * 自动补全缺失的 `>` 符号
 * 用于处理 XML 片段中像 `</mxCell` 这类没有 `>` 的未完整标签
 * 思路：在下一个 `<` 之前没有出现 `>`，则认为缺失，自动补上
 */
function autoCloseAngleBrackets(input = '') {
  const text = String(input ?? '');
  const len = text.length;
  if (!len) return text;

  let out = '';
  let i = 0;

  while (i < len) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      out += text.slice(i);
      break;
    }

    // 前面的普通文本
    out += text.slice(i, lt);

    // 从 lt 开始查找下一个 `>` 或下一个 `<`
    let j = lt + 1;
    let foundGt = -1;
    let foundNextLt = -1;
    for (; j < len; j++) {
      const ch = text[j];
      if (ch === '>') {
        foundGt = j;
        break;
      }
      if (ch === '<') {
        foundNextLt = j;
        break;
      }
    }

    // 正常情况：找到形如 <...> 的完整标签，直接输出
    if (foundGt !== -1 && (foundNextLt === -1 || foundGt < foundNextLt)) {
      out += text.slice(lt, foundGt + 1);
      i = foundGt + 1;
      continue;
    }

    // 如果在遇到下一个 `<` 之前没有 `>`，认为当前 `<...` 未闭合，需要补一个 `>`
    if (foundNextLt === -1) {
      const segment = text.slice(lt);
      out += segment.endsWith('>') ? segment : segment + '>';
      break;
    } else {
      const segment = text.slice(lt, foundNextLt);
      out += segment.endsWith('>') ? segment : segment + '>';
      i = foundNextLt;
    }
  }

  return out;
}

/**
 * 修复 XML/HTML 未闭合标签
 * 自动补全缺失的结束标签
 */
export function fixXMLorHTML(input = '', opts = {}) {
  const voidTags = opts.voidTags || DEFAULT_VOID_TAGS;
  const treatAsHTML = opts.html !== false;
  const src = (input || '').replace(/\ufeff/g, '').replace(/[\u200B-\u200D\u2060]/g, '');

  // 先整体补一遍缺失 `>` 的 `<...` 片段，例如：`</mxCell \n <!-- ... -->`
  const text = autoCloseAngleBrackets(src);

  const tagRe = /<([^>]+)>/g;
  const stack = [];
  let out = '';
  let lastIndex = 0;

  const normalize = (name) => (treatAsHTML ? String(name || '').toLowerCase() : String(name || ''));

  let m;
  while ((m = tagRe.exec(text)) !== null) {
    out += text.slice(lastIndex, m.index);
    lastIndex = tagRe.lastIndex;

    const rawTag = m[1].trim();

    // 注释 / DOCTYPE / CDATA / 处理指令
    if (
      rawTag.startsWith('!--') ||
      rawTag.startsWith('!DOCTYPE') ||
      rawTag.startsWith('![CDATA[') ||
      rawTag.startsWith('?')
    ) {
      out += '<' + rawTag + '>';
      continue;
    }

    // 结束标签
    if (rawTag.startsWith('/')) {
      const name = normalize(rawTag.slice(1).split(/\s+/)[0] || '');
      out += '<' + rawTag + '>';
      if (stack.length && normalize(stack[stack.length - 1]) === name) {
        stack.pop();
      }
      continue;
    }

    // 开始标签
    const selfClosing = /\/$/.test(rawTag);
    const name = normalize(rawTag.split(/\s+/)[0] || '');

    out += '<' + rawTag + '>';

    if (!selfClosing && !voidTags.has(name)) {
      stack.push(name);
    }
  }

  out += text.slice(lastIndex);

  // 按栈顺序补全所有未闭合标签
  for (let i = stack.length - 1; i >= 0; i--) {
    out += `</${stack[i]}>`;
  }

  return out;
}

/**
 * 统一入口：根据模式自动修复内容
 * @param {string} input - 原始文本
 * @param {{ mode?: 'auto'|'json'|'xml', html?: boolean, voidTags?: Set<string> }} opts - 修复选项
 * @returns {string} 修复后的文本
 */
export function fixUnclosed(input = '', opts = {}) {
  const mode = opts.mode || 'auto';
  const text = String(input ?? '');

  if (mode === 'json' || (mode === 'auto' && isLikelyJSON(text))) {
    return fixJSON(text);
  }

  return fixXMLorHTML(text, opts);
}

export default fixUnclosed;

