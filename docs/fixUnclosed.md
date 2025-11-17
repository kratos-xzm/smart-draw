# JSON/XML 修复算法说明

## 概述

`lib/fixUnclosed.js` 提供了修复 LLM 生成的不完整 JSON 和 XML 代码的功能。由于 LLM 可能在流式输出中途中断，或者生成格式不完整的代码，该工具可以自动补全缺失的结构。

## JSON 修复算法

### 核心策略

1. **括号栈追踪**: 扫描时维护一个栈，追踪所有未匹配的开括号 `{` 和 `[`
2. **智能插入**: 当遇到不匹配的闭括号时（例如遇到 `]` 但栈顶是 `{`），在该位置前自动插入缺失的闭括号
3. **末尾补全**: 扫描结束后，补全栈中剩余的所有未闭合括号
4. **逗号清理**: 清理多余的尾部逗号（如 `[1, 2,]` → `[1, 2]`）

### 修复示例

#### 示例 1: 不匹配的闭括号顺序

**问题**: 数组的闭合括号 `]` 出现在对象的闭合括号 `}` 之前

```json
// 输入 (不完整)
[{
    "type": "arrow",
    "start": {"id": "a"},
    "end": {"id": "b"}
  },
  {
    "type": "rect",
    "start": {"id": "c"},
    "end": {"id": "d"}
]

// 输出 (已修复)
[{
    "type": "arrow",
    "start": {"id": "a"},
    "end": {"id": "b"}
  },
  {
    "type": "rect",
    "start": {"id": "c"},
    "end": {"id": "d"}
}]  // 自动在 ] 前插入了 }
```

**处理过程**:
1. 扫描到第二个对象的开始 `{` (位置 235)
2. 继续扫描，遇到数组的闭合 `]` (位置 465)
3. 算法检测到栈顶是 `{` 而不是 `[`，说明有未闭合的对象
4. **自动在 `]` 之前插入 `}`**，先闭合对象，再闭合数组

#### 示例 2: 多层嵌套缺失闭合

```json
// 输入
{
  "data": {
    "items": [
      {"name": "a", "value": 1
    ]
}

// 输出
{
  "data": {
    "items": [
      {"name": "a", "value": 1}  // 补全 }
    ]
  }  // 补全 }
}
```

#### 示例 3: 尾部逗号清理

```json
// 输入
[{"a": 1}, {"b": 2},]

// 输出
[{"a": 1}, {"b": 2}]  // 删除了 ] 前的逗号
```

### 字符串处理

算法正确处理 JSON 字符串中的内容，不会误将字符串内的括号计入栈：

```json
{
  "code": "function test() { return [1, 2]; }",  // 字符串内的括号被忽略
  "data": {"value": 123
}  // 只有这个 { 需要补全
```

## XML 修复算法

### 功能

- 补全未闭合的标签 (`<div>content</div>`)
- 识别自闭合标签 (`<br />`, `<mxGeometry />`)
- 补全缺失的 `>` 符号 (`</mxCell` → `</mxCell>`)

### Draw.io 特殊标签

算法内置了 Draw.io 的自闭合标签识别：

```xml
<mxCell id="1">
  <mxGeometry x="10" y="20" width="100" height="50" />
  <mxPoint x="0" y="0" />
</mxCell>  <!-- 会自动补全 -->
```

## API 使用

### `fixJSON(input)`

修复 JSON 字符串。

```javascript
import { fixJSON } from './lib/fixUnclosed.js';

const broken = '[{"a": 1}, {"b": 2';
const fixed = fixJSON(broken);  // '[{"a": 1}, {"b": 2}]'
const parsed = JSON.parse(fixed);
```

### `fixXMLorHTML(input, options)`

修复 XML/HTML 字符串。

```javascript
import { fixXMLorHTML } from './lib/fixUnclosed.js';

const broken = '<div><p>Hello</div>';
const fixed = fixXMLorHTML(broken);  // '<div><p>Hello</p></div>'
```

### `fixUnclosed(input, options)`

自动检测格式并修复。

```javascript
import fixUnclosed from './lib/fixUnclosed.js';

const json = fixUnclosed('[{...}');  // 自动识别为 JSON
const xml = fixUnclosed('<div>...');  // 自动识别为 XML
```

## 测试覆盖

算法已通过以下场景测试：

- ✅ 不匹配的闭括号顺序
- ✅ 多层嵌套缺失闭合
- ✅ 已有效的 JSON（不做修改）
- ✅ 尾部逗号清理
- ✅ 缺失多个闭合括号
- ✅ 未闭合字符串
- ✅ 空数组和空对象
- ✅ 复杂嵌套结构

## 限制与注意事项

1. **不保证语义正确性**: 算法只能修复结构问题，不能修复逻辑错误
2. **可能过度修复**: 某些极端情况下可能添加不必要的括号
3. **依赖启发式规则**: 如果输入严重损坏，修复结果可能不符合预期

## 版本历史

- **v2.0** (2025-01): 改进 JSON 算法，支持不匹配的闭括号顺序自动插入
- **v1.0**: 初始版本，基础括号补全功能
