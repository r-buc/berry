/**
 * Berry language built-in functions, classes, and module documentation.
 */

export interface BuiltinParam {
    name: string;
    description: string;
    optional?: boolean;
}

export interface BuiltinItem {
    name: string;
    /** Full signature, e.g. `print(...)` */
    signature: string;
    documentation: string;
    parameters: BuiltinParam[];
    returnType?: string;
    /** Module this belongs to, undefined = global */
    module?: string;
}

// ---------------------------------------------------------------------------
// Global functions
// ---------------------------------------------------------------------------

export const GLOBAL_FUNCTIONS: BuiltinItem[] = [
    {
        name: 'assert',
        signature: 'assert(condition [, message])',
        documentation:
            'Raises an `assert_failed` exception if `condition` is `false` or `nil`.\n\n' +
            'An optional `message` string is included in the exception.',
        parameters: [
            { name: 'condition', description: 'Value to test; the assertion passes when truthy.' },
            { name: 'message', description: 'Error message string (optional).', optional: true },
        ],
        returnType: 'nil',
    },
    {
        name: 'print',
        signature: 'print(...args)',
        documentation:
            'Prints all arguments to standard output, separated by spaces, followed by a newline.',
        parameters: [
            { name: '...args', description: 'Zero or more values to print.' },
        ],
        returnType: 'nil',
    },
    {
        name: 'input',
        signature: 'input([prompt])',
        documentation:
            'Reads a line from standard input and returns it as a string. ' +
            'If `prompt` is given it is written to stdout first (without a trailing newline).',
        parameters: [
            { name: 'prompt', description: 'Optional prompt string.', optional: true },
        ],
        returnType: 'string',
    },
    {
        name: 'type',
        signature: 'type(value)',
        documentation:
            'Returns a string describing the type of `value`.\n\n' +
            'Possible return values: `"nil"`, `"bool"`, `"int"`, `"real"`, `"string"`, ' +
            '`"function"`, `"class"`, `"instance"`, `"module"`, `"list"`, `"map"`, ' +
            '`"range"`, `"comptr"`.',
        parameters: [
            { name: 'value', description: 'Any Berry value.' },
        ],
        returnType: 'string',
    },
    {
        name: 'classname',
        signature: 'classname(instance)',
        documentation: 'Returns the name of the class that `instance` belongs to, as a string.',
        parameters: [
            { name: 'instance', description: 'A class instance.' },
        ],
        returnType: 'string',
    },
    {
        name: 'classof',
        signature: 'classof(instance)',
        documentation: 'Returns the class object that `instance` belongs to.',
        parameters: [
            { name: 'instance', description: 'A class instance.' },
        ],
        returnType: 'class',
    },
    {
        name: 'number',
        signature: 'number(value)',
        documentation:
            'Converts `value` to a number. Strings are parsed; booleans become 0 or 1.',
        parameters: [
            { name: 'value', description: 'Value to convert.' },
        ],
        returnType: 'int | real',
    },
    {
        name: 'int',
        signature: 'int(value)',
        documentation:
            'Converts `value` to an integer. Real numbers are truncated towards zero.',
        parameters: [
            { name: 'value', description: 'Value to convert.' },
        ],
        returnType: 'int',
    },
    {
        name: 'real',
        signature: 'real(value)',
        documentation: 'Converts `value` to a floating-point (real) number.',
        parameters: [
            { name: 'value', description: 'Value to convert.' },
        ],
        returnType: 'real',
    },
    {
        name: 'str',
        signature: 'str(value)',
        documentation: 'Converts `value` to its string representation.',
        parameters: [
            { name: 'value', description: 'Value to convert.' },
        ],
        returnType: 'string',
    },
    {
        name: 'bool',
        signature: 'bool(value)',
        documentation:
            'Converts `value` to a boolean. `nil` and `false` are `false`; everything else is `true`.',
        parameters: [
            { name: 'value', description: 'Value to convert.' },
        ],
        returnType: 'bool',
    },
    {
        name: 'super',
        signature: 'super(instance)',
        documentation:
            'Returns a super-instance view of `instance`, giving access to members of the superclass.',
        parameters: [
            { name: 'instance', description: 'A class instance (usually `self`).' },
        ],
        returnType: 'instance',
    },
    {
        name: 'isinstance',
        signature: 'isinstance(object, class)',
        documentation:
            'Returns `true` if `object` is an instance of `class` or any subclass of it.',
        parameters: [
            { name: 'object', description: 'Value to test.' },
            { name: 'class', description: 'The class to test against.' },
        ],
        returnType: 'bool',
    },
    {
        name: 'issubclass',
        signature: 'issubclass(subclass, superclass)',
        documentation: 'Returns `true` if `subclass` is the same as or a subclass of `superclass`.',
        parameters: [
            { name: 'subclass', description: 'The class to test.' },
            { name: 'superclass', description: 'The expected parent class.' },
        ],
        returnType: 'bool',
    },
    {
        name: 'compile',
        signature: 'compile(code [, name])',
        documentation:
            'Compiles the Berry source `code` string and returns a closure. ' +
            '`name` is an optional string used in error messages (defaults to `"(string)"`). ' +
            'Call the returned closure to execute the code.',
        parameters: [
            { name: 'code', description: 'Berry source code string.' },
            { name: 'name', description: 'Optional name for error messages.', optional: true },
        ],
        returnType: 'function',
    },
    {
        name: 'module',
        signature: 'module([name])',
        documentation:
            'Creates and returns a new empty module object, or returns the existing module ' +
            'with the given `name` if one already exists in the module registry.',
        parameters: [
            { name: 'name', description: 'Optional module name string.', optional: true },
        ],
        returnType: 'module',
    },
    {
        name: 'size',
        signature: 'size(value)',
        documentation:
            'Returns the number of elements in `value`. Works for strings (byte count), ' +
            'lists, maps, and any object that implements `size()`.',
        parameters: [
            { name: 'value', description: 'A string, list, map, or sized object.' },
        ],
        returnType: 'int',
    },
    {
        name: 'format',
        signature: 'format(fmt, ...args)',
        documentation:
            'Returns a formatted string. The format string uses `printf`-style placeholders: ' +
            '`%d` (integer), `%f` (real), `%s` (string), `%g` (shorter of `%e`/`%f`), ' +
            '`%x` / `%X` (hex), `%o` (octal), `%b` (binary), `%%` (literal `%`).',
        parameters: [
            { name: 'fmt', description: 'Format string.' },
            { name: '...args', description: 'Values substituted into the format string.' },
        ],
        returnType: 'string',
    },
    {
        name: 'iter',
        signature: 'iter(value)',
        documentation:
            'Returns an iterator for `value`. For objects that support it (list, map, range, ' +
            'custom classes with `iter()`), this returns a function that yields successive values.',
        parameters: [
            { name: 'value', description: 'An iterable object.' },
        ],
        returnType: 'function',
    },
];

// ---------------------------------------------------------------------------
// Built-in constant / special identifiers (not functions)
// ---------------------------------------------------------------------------

export const CONSTANT_DOCS: Record<string, string> = {
    true: 'Boolean true literal.',
    false: 'Boolean false literal.',
    nil: 'The nil (null) value.',
    self: 'Reference to the current class instance inside a method.',
    super: 'Refers to the superclass. Inside a method, `super` is also a function: `super(self)` returns the super-instance.',
    _class: 'Reference to the current class object inside a method (the class itself, not an instance).',
};

// ---------------------------------------------------------------------------
// Built-in string methods
// ---------------------------------------------------------------------------

export const STRING_METHODS: BuiltinItem[] = [
    {
        name: 'count',
        signature: 'string.count(sub [, start [, end]])',
        documentation: 'Returns the number of non-overlapping occurrences of `sub` in the string.',
        parameters: [
            { name: 'sub', description: 'Substring to count.' },
            { name: 'start', description: 'Optional start index.', optional: true },
            { name: 'end', description: 'Optional end index (exclusive).', optional: true },
        ],
        returnType: 'int',
    },
    {
        name: 'split',
        signature: 'string.split(sep)',
        documentation: 'Splits the string by `sep` and returns a list of sub-strings.',
        parameters: [
            { name: 'sep', description: 'Separator string.' },
        ],
        returnType: 'list',
    },
    {
        name: 'find',
        signature: 'string.find(sub [, start])',
        documentation:
            'Returns the index of the first occurrence of `sub`, or `-1` if not found. ' +
            'Search begins at `start` (default `0`).',
        parameters: [
            { name: 'sub', description: 'Substring to search for.' },
            { name: 'start', description: 'Start index for the search.', optional: true },
        ],
        returnType: 'int',
    },
    {
        name: 'upper',
        signature: 'string.upper()',
        documentation: 'Returns a copy of the string with all ASCII characters uppercased.',
        parameters: [],
        returnType: 'string',
    },
    {
        name: 'lower',
        signature: 'string.lower()',
        documentation: 'Returns a copy of the string with all ASCII characters lowercased.',
        parameters: [],
        returnType: 'string',
    },
    {
        name: 'format',
        signature: 'string.format(fmt, ...args)',
        documentation: 'Same as the global `format()` function: returns a `printf`-style formatted string.',
        parameters: [
            { name: 'fmt', description: 'Format string.' },
            { name: '...args', description: 'Values to substitute.' },
        ],
        returnType: 'string',
    },
    {
        name: 'escape',
        signature: 'string.escape()',
        documentation: 'Returns a copy of the string with special characters escaped (e.g. newlines become `\\n`).',
        parameters: [],
        returnType: 'string',
    },
    {
        name: 'hex',
        signature: 'string.hex()',
        documentation: 'Returns a hexadecimal representation of the string bytes.',
        parameters: [],
        returnType: 'string',
    },
    {
        name: 'byte',
        signature: 'string.byte([index])',
        documentation: 'Returns the integer byte value at `index` (default `0`).',
        parameters: [
            { name: 'index', description: 'Byte index (default 0).', optional: true },
        ],
        returnType: 'int',
    },
    {
        name: 'char',
        signature: 'string.char(code)',
        documentation: 'Returns a single-character string whose byte value is `code`.',
        parameters: [
            { name: 'code', description: 'Integer byte value.' },
        ],
        returnType: 'string',
    },
    {
        name: 'startswith',
        signature: 'string.startswith(prefix)',
        documentation: 'Returns `true` if the string starts with `prefix`.',
        parameters: [
            { name: 'prefix', description: 'Prefix string.' },
        ],
        returnType: 'bool',
    },
    {
        name: 'endswith',
        signature: 'string.endswith(suffix)',
        documentation: 'Returns `true` if the string ends with `suffix`.',
        parameters: [
            { name: 'suffix', description: 'Suffix string.' },
        ],
        returnType: 'bool',
    },
    {
        name: 'replace',
        signature: 'string.replace(old, new)',
        documentation: 'Returns a copy of the string with all occurrences of `old` replaced by `new`.',
        parameters: [
            { name: 'old', description: 'Substring to replace.' },
            { name: 'new', description: 'Replacement string.' },
        ],
        returnType: 'string',
    },
    {
        name: 'concat',
        signature: 'string.concat(other)',
        documentation: 'Concatenates `other` to this string and returns the result. Equivalent to `self .. other`.',
        parameters: [
            { name: 'other', description: 'String to concatenate.' },
        ],
        returnType: 'string',
    },
    {
        name: 'reverse',
        signature: 'string.reverse()',
        documentation: 'Returns a reversed copy of the string.',
        parameters: [],
        returnType: 'string',
    },
    {
        name: 'strip',
        signature: 'string.strip()',
        documentation: 'Returns a copy of the string with leading and trailing whitespace removed.',
        parameters: [],
        returnType: 'string',
    },
    {
        name: 'tr',
        signature: 'string.tr(from, to)',
        documentation:
            'Translates characters: each character in `from` is replaced by the corresponding character in `to`.',
        parameters: [
            { name: 'from', description: 'Characters to replace.' },
            { name: 'to', description: 'Replacement characters.' },
        ],
        returnType: 'string',
    },
    {
        name: 'item',
        signature: 'string.item(index)',
        documentation: 'Returns the character at `index` as a single-character string. Negative indices count from the end.',
        parameters: [
            { name: 'index', description: 'Character index.' },
        ],
        returnType: 'string',
    },
    {
        name: 'size',
        signature: 'string.size()',
        documentation: 'Returns the number of bytes in the string.',
        parameters: [],
        returnType: 'int',
    },
    {
        name: 'iter',
        signature: 'string.iter()',
        documentation: 'Returns an iterator that yields each character as a single-character string.',
        parameters: [],
        returnType: 'function',
    },
    {
        name: 'tostring',
        signature: 'string.tostring()',
        documentation: 'Returns the string itself.',
        parameters: [],
        returnType: 'string',
    },
    {
        name: 'toint',
        signature: 'string.toint([base])',
        documentation: 'Parses the string as an integer with the given `base` (default 10) and returns it.',
        parameters: [
            { name: 'base', description: 'Numeric base (default 10).', optional: true },
        ],
        returnType: 'int',
    },
];

// ---------------------------------------------------------------------------
// Built-in list methods
// ---------------------------------------------------------------------------

export const LIST_METHODS: BuiltinItem[] = [
    {
        name: 'init',
        signature: 'list.init()',
        documentation: 'Initializes the list (called automatically on construction).',
        parameters: [],
        returnType: 'nil',
    },
    {
        name: 'push',
        signature: 'list.push(value)',
        documentation: 'Appends `value` to the end of the list.',
        parameters: [{ name: 'value', description: 'Value to append.' }],
        returnType: 'nil',
    },
    {
        name: 'pop',
        signature: 'list.pop()',
        documentation: 'Removes and returns the last element of the list.',
        parameters: [],
        returnType: 'any',
    },
    {
        name: 'insert',
        signature: 'list.insert(index, value)',
        documentation: 'Inserts `value` before position `index`.',
        parameters: [
            { name: 'index', description: 'Position to insert at.' },
            { name: 'value', description: 'Value to insert.' },
        ],
        returnType: 'nil',
    },
    {
        name: 'remove',
        signature: 'list.remove(index)',
        documentation: 'Removes and returns the element at `index`.',
        parameters: [{ name: 'index', description: 'Index of the element to remove.' }],
        returnType: 'any',
    },
    {
        name: 'item',
        signature: 'list.item(index)',
        documentation: 'Returns the element at `index`. Negative indices count from the end.',
        parameters: [{ name: 'index', description: 'Element index.' }],
        returnType: 'any',
    },
    {
        name: 'setitem',
        signature: 'list.setitem(index, value)',
        documentation: 'Sets the element at `index` to `value`.',
        parameters: [
            { name: 'index', description: 'Index to set.' },
            { name: 'value', description: 'New value.' },
        ],
        returnType: 'nil',
    },
    {
        name: 'find',
        signature: 'list.find(value)',
        documentation: 'Returns the index of the first occurrence of `value`, or `-1` if not found.',
        parameters: [{ name: 'value', description: 'Value to search for.' }],
        returnType: 'int',
    },
    {
        name: 'size',
        signature: 'list.size()',
        documentation: 'Returns the number of elements in the list.',
        parameters: [],
        returnType: 'int',
    },
    {
        name: 'resize',
        signature: 'list.resize(size)',
        documentation: 'Resizes the list to `size` elements. New elements are `nil`.',
        parameters: [{ name: 'size', description: 'New size.' }],
        returnType: 'nil',
    },
    {
        name: 'iter',
        signature: 'list.iter()',
        documentation: 'Returns an iterator over the list elements.',
        parameters: [],
        returnType: 'function',
    },
    {
        name: 'reverse',
        signature: 'list.reverse()',
        documentation: 'Reverses the list in place and returns `self`.',
        parameters: [],
        returnType: 'list',
    },
    {
        name: 'copy',
        signature: 'list.copy()',
        documentation: 'Returns a shallow copy of the list.',
        parameters: [],
        returnType: 'list',
    },
    {
        name: 'concat',
        signature: 'list.concat(sep)',
        documentation: 'Joins all elements as strings, separated by `sep`, and returns the resulting string.',
        parameters: [{ name: 'sep', description: 'Separator string.' }],
        returnType: 'string',
    },
    {
        name: 'tostring',
        signature: 'list.tostring()',
        documentation: 'Returns a string representation of the list, e.g. `[1, 2, 3]`.',
        parameters: [],
        returnType: 'string',
    },
];

// ---------------------------------------------------------------------------
// Built-in map methods
// ---------------------------------------------------------------------------

export const MAP_METHODS: BuiltinItem[] = [
    {
        name: 'init',
        signature: 'map.init()',
        documentation: 'Initializes the map (called automatically on construction).',
        parameters: [],
        returnType: 'nil',
    },
    {
        name: 'insert',
        signature: 'map.insert(key, value)',
        documentation: 'Inserts `key → value` into the map.',
        parameters: [
            { name: 'key', description: 'Key (any hashable value).' },
            { name: 'value', description: 'Associated value.' },
        ],
        returnType: 'nil',
    },
    {
        name: 'remove',
        signature: 'map.remove(key)',
        documentation: 'Removes the entry with the given `key`.',
        parameters: [{ name: 'key', description: 'Key to remove.' }],
        returnType: 'nil',
    },
    {
        name: 'find',
        signature: 'map.find(key [, default])',
        documentation:
            'Returns the value associated with `key`, or `default` (nil if omitted) if the key is not present.',
        parameters: [
            { name: 'key', description: 'Key to look up.' },
            { name: 'default', description: 'Fallback value.', optional: true },
        ],
        returnType: 'any',
    },
    {
        name: 'contains',
        signature: 'map.contains(key)',
        documentation: 'Returns `true` if `key` exists in the map.',
        parameters: [{ name: 'key', description: 'Key to test.' }],
        returnType: 'bool',
    },
    {
        name: 'item',
        signature: 'map.item(key)',
        documentation: 'Returns the value for `key`. Raises an exception if the key is absent.',
        parameters: [{ name: 'key', description: 'Key to retrieve.' }],
        returnType: 'any',
    },
    {
        name: 'setitem',
        signature: 'map.setitem(key, value)',
        documentation: 'Sets or updates the entry `key → value`.',
        parameters: [
            { name: 'key', description: 'Key.' },
            { name: 'value', description: 'Value.' },
        ],
        returnType: 'nil',
    },
    {
        name: 'keys',
        signature: 'map.keys()',
        documentation: 'Returns a list of all keys in the map (in an unspecified order).',
        parameters: [],
        returnType: 'list',
    },
    {
        name: 'values',
        signature: 'map.values()',
        documentation: 'Returns a list of all values in the map (in an unspecified order).',
        parameters: [],
        returnType: 'list',
    },
    {
        name: 'iter',
        signature: 'map.iter()',
        documentation: 'Returns an iterator over the map keys.',
        parameters: [],
        returnType: 'function',
    },
    {
        name: 'copy',
        signature: 'map.copy()',
        documentation: 'Returns a shallow copy of the map.',
        parameters: [],
        returnType: 'map',
    },
    {
        name: 'size',
        signature: 'map.size()',
        documentation: 'Returns the number of key-value pairs in the map.',
        parameters: [],
        returnType: 'int',
    },
    {
        name: 'tostring',
        signature: 'map.tostring()',
        documentation: "Returns a string representation like `{'key': value, ...}`.",
        parameters: [],
        returnType: 'string',
    },
];

// ---------------------------------------------------------------------------
// Math module
// ---------------------------------------------------------------------------

export const MATH_FUNCTIONS: BuiltinItem[] = [
    { name: 'sin',   signature: 'math.sin(x)',   documentation: 'Sine of `x` (radians).',             parameters: [{ name: 'x', description: 'Angle in radians.' }], returnType: 'real', module: 'math' },
    { name: 'cos',   signature: 'math.cos(x)',   documentation: 'Cosine of `x` (radians).',           parameters: [{ name: 'x', description: 'Angle in radians.' }], returnType: 'real', module: 'math' },
    { name: 'tan',   signature: 'math.tan(x)',   documentation: 'Tangent of `x` (radians).',          parameters: [{ name: 'x', description: 'Angle in radians.' }], returnType: 'real', module: 'math' },
    { name: 'asin',  signature: 'math.asin(x)',  documentation: 'Arc-sine of `x` (returns radians).', parameters: [{ name: 'x', description: 'Value in [-1, 1].' }],  returnType: 'real', module: 'math' },
    { name: 'acos',  signature: 'math.acos(x)',  documentation: 'Arc-cosine of `x` (returns radians).', parameters: [{ name: 'x', description: 'Value in [-1, 1].' }], returnType: 'real', module: 'math' },
    { name: 'atan',  signature: 'math.atan(x [, y])', documentation: 'Arc-tangent of `x` (or `x/y` if two arguments given). Returns radians.', parameters: [{ name: 'x', description: 'Numerator.' }, { name: 'y', description: 'Denominator (optional).', optional: true }], returnType: 'real', module: 'math' },
    { name: 'sinh',  signature: 'math.sinh(x)',  documentation: 'Hyperbolic sine.',     parameters: [{ name: 'x', description: 'Value.' }], returnType: 'real', module: 'math' },
    { name: 'cosh',  signature: 'math.cosh(x)',  documentation: 'Hyperbolic cosine.',   parameters: [{ name: 'x', description: 'Value.' }], returnType: 'real', module: 'math' },
    { name: 'tanh',  signature: 'math.tanh(x)',  documentation: 'Hyperbolic tangent.',  parameters: [{ name: 'x', description: 'Value.' }], returnType: 'real', module: 'math' },
    { name: 'exp',   signature: 'math.exp(x)',   documentation: 'e raised to the power `x`.', parameters: [{ name: 'x', description: 'Exponent.' }], returnType: 'real', module: 'math' },
    { name: 'log',   signature: 'math.log(x [, base])', documentation: 'Natural logarithm of `x`, or log base `base` if given.', parameters: [{ name: 'x', description: 'Value.' }, { name: 'base', description: 'Logarithm base (optional, default e).', optional: true }], returnType: 'real', module: 'math' },
    { name: 'pow',   signature: 'math.pow(x, y)', documentation: '`x` raised to the power `y`.', parameters: [{ name: 'x', description: 'Base.' }, { name: 'y', description: 'Exponent.' }], returnType: 'real', module: 'math' },
    { name: 'sqrt',  signature: 'math.sqrt(x)',  documentation: 'Square root of `x`.', parameters: [{ name: 'x', description: 'Non-negative value.' }], returnType: 'real', module: 'math' },
    { name: 'abs',   signature: 'math.abs(x)',   documentation: 'Absolute value of `x`.', parameters: [{ name: 'x', description: 'Integer or real value.' }], returnType: 'int | real', module: 'math' },
    { name: 'ceil',  signature: 'math.ceil(x)',  documentation: 'Ceiling of `x` — smallest integer ≥ `x`.', parameters: [{ name: 'x', description: 'Real value.' }], returnType: 'int', module: 'math' },
    { name: 'floor', signature: 'math.floor(x)', documentation: 'Floor of `x` — largest integer ≤ `x`.', parameters: [{ name: 'x', description: 'Real value.' }], returnType: 'int', module: 'math' },
    { name: 'rand',  signature: 'math.rand()',   documentation: 'Returns a pseudo-random integer.', parameters: [], returnType: 'int', module: 'math' },
    { name: 'srand', signature: 'math.srand(seed)', documentation: 'Seeds the pseudo-random number generator with `seed`.', parameters: [{ name: 'seed', description: 'Integer seed.' }], returnType: 'nil', module: 'math' },
    { name: 'isinf', signature: 'math.isinf(x)', documentation: 'Returns `true` if `x` is positive or negative infinity.', parameters: [{ name: 'x', description: 'Real value.' }], returnType: 'bool', module: 'math' },
    { name: 'isnan', signature: 'math.isnan(x)', documentation: 'Returns `true` if `x` is NaN.', parameters: [{ name: 'x', description: 'Real value.' }], returnType: 'bool', module: 'math' },
    { name: 'max',   signature: 'math.max(a, b)', documentation: 'Returns the larger of `a` and `b`.', parameters: [{ name: 'a', description: 'First value.' }, { name: 'b', description: 'Second value.' }], returnType: 'int | real', module: 'math' },
    { name: 'min',   signature: 'math.min(a, b)', documentation: 'Returns the smaller of `a` and `b`.', parameters: [{ name: 'a', description: 'First value.' }, { name: 'b', description: 'Second value.' }], returnType: 'int | real', module: 'math' },
];

/** Math module constants */
export const MATH_CONSTANTS: Record<string, string> = {
    pi:  'The mathematical constant π ≈ 3.14159…',
    nan: 'IEEE 754 Not-a-Number value.',
};

// ---------------------------------------------------------------------------
// JSON module
// ---------------------------------------------------------------------------

export const JSON_FUNCTIONS: BuiltinItem[] = [
    {
        name: 'load',
        signature: 'json.load(text)',
        documentation:
            'Parses the JSON string `text` and returns the equivalent Berry value ' +
            '(map, list, string, number, bool, or nil).',
        parameters: [{ name: 'text', description: 'JSON string.' }],
        returnType: 'any',
        module: 'json',
    },
    {
        name: 'dump',
        signature: 'json.dump(value)',
        documentation: 'Serializes the Berry `value` to a JSON string.',
        parameters: [{ name: 'value', description: 'Value to serialize.' }],
        returnType: 'string',
        module: 'json',
    },
];

// ---------------------------------------------------------------------------
// OS module
// ---------------------------------------------------------------------------

export const OS_FUNCTIONS: BuiltinItem[] = [
    {
        name: 'getcwd',
        signature: 'os.getcwd()',
        documentation: 'Returns the current working directory as a string.',
        parameters: [],
        returnType: 'string',
        module: 'os',
    },
    {
        name: 'chdir',
        signature: 'os.chdir(path)',
        documentation: 'Changes the current working directory to `path`.',
        parameters: [{ name: 'path', description: 'Directory path string.' }],
        returnType: 'nil',
        module: 'os',
    },
    {
        name: 'mkdir',
        signature: 'os.mkdir(path)',
        documentation: 'Creates a new directory at `path`.',
        parameters: [{ name: 'path', description: 'Directory path to create.' }],
        returnType: 'nil',
        module: 'os',
    },
    {
        name: 'remove',
        signature: 'os.remove(path)',
        documentation: 'Deletes the file or empty directory at `path`.',
        parameters: [{ name: 'path', description: 'Path to delete.' }],
        returnType: 'nil',
        module: 'os',
    },
    {
        name: 'listdir',
        signature: 'os.listdir([path])',
        documentation: 'Returns a list of filenames in `path` (default: current directory).',
        parameters: [{ name: 'path', description: 'Directory path (default `.`).', optional: true }],
        returnType: 'list',
        module: 'os',
    },
    {
        name: 'path.exists',
        signature: 'os.path.exists(path)',
        documentation: 'Returns `true` if `path` exists on the filesystem.',
        parameters: [{ name: 'path', description: 'Path string.' }],
        returnType: 'bool',
        module: 'os',
    },
    {
        name: 'path.join',
        signature: 'os.path.join(a, b)',
        documentation: 'Joins two path components with the OS path separator.',
        parameters: [
            { name: 'a', description: 'First path component.' },
            { name: 'b', description: 'Second path component.' },
        ],
        returnType: 'string',
        module: 'os',
    },
    {
        name: 'path.isdir',
        signature: 'os.path.isdir(path)',
        documentation: 'Returns `true` if `path` is an existing directory.',
        parameters: [{ name: 'path', description: 'Path string.' }],
        returnType: 'bool',
        module: 'os',
    },
    {
        name: 'path.isfile',
        signature: 'os.path.isfile(path)',
        documentation: 'Returns `true` if `path` is an existing regular file.',
        parameters: [{ name: 'path', description: 'Path string.' }],
        returnType: 'bool',
        module: 'os',
    },
    {
        name: 'path.split',
        signature: 'os.path.split(path)',
        documentation: 'Splits `path` into a (directory, filename) pair and returns them as a list.',
        parameters: [{ name: 'path', description: 'Path string.' }],
        returnType: 'list',
        module: 'os',
    },
    {
        name: 'path.splitext',
        signature: 'os.path.splitext(path)',
        documentation: 'Splits `path` into (root, extension) and returns them as a list.',
        parameters: [{ name: 'path', description: 'Path string.' }],
        returnType: 'list',
        module: 'os',
    },
    {
        name: 'path.basename',
        signature: 'os.path.basename(path)',
        documentation: 'Returns the filename component of `path`.',
        parameters: [{ name: 'path', description: 'Path string.' }],
        returnType: 'string',
        module: 'os',
    },
    {
        name: 'path.dirname',
        signature: 'os.path.dirname(path)',
        documentation: 'Returns the directory component of `path`.',
        parameters: [{ name: 'path', description: 'Path string.' }],
        returnType: 'string',
        module: 'os',
    },
];

// ---------------------------------------------------------------------------
// Debug module
// ---------------------------------------------------------------------------

export const DEBUG_FUNCTIONS: BuiltinItem[] = [
    {
        name: 'attrdump',
        signature: 'debug.attrdump(object)',
        documentation: 'Prints all attributes of `object`.',
        parameters: [{ name: 'object', description: 'Object to inspect.' }],
        returnType: 'nil',
        module: 'debug',
    },
    {
        name: 'calldepth',
        signature: 'debug.calldepth()',
        documentation: 'Returns the current call stack depth.',
        parameters: [],
        returnType: 'int',
        module: 'debug',
    },
    {
        name: 'codedump',
        signature: 'debug.codedump(closure)',
        documentation: 'Dumps the bytecode of `closure` to stdout.',
        parameters: [{ name: 'closure', description: 'A Berry closure.' }],
        returnType: 'nil',
        module: 'debug',
    },
    {
        name: 'countvars',
        signature: 'debug.countvars([level])',
        documentation: 'Returns the number of local variables at call stack `level`.',
        parameters: [{ name: 'level', description: 'Stack level (default 0 = current).', optional: true }],
        returnType: 'int',
        module: 'debug',
    },
    {
        name: 'name',
        signature: 'debug.name(closure)',
        documentation: 'Returns the name of `closure` as a string.',
        parameters: [{ name: 'closure', description: 'A Berry closure.' }],
        returnType: 'string',
        module: 'debug',
    },
    {
        name: 'traceback',
        signature: 'debug.traceback()',
        documentation: 'Prints the current call stack traceback to stdout.',
        parameters: [],
        returnType: 'nil',
        module: 'debug',
    },
    {
        name: 'top',
        signature: 'debug.top()',
        documentation: 'Returns the number of values on the Berry stack.',
        parameters: [],
        returnType: 'int',
        module: 'debug',
    },
    {
        name: 'varname',
        signature: 'debug.varname(closure, index)',
        documentation: 'Returns the name of the local variable at `index` inside `closure`.',
        parameters: [
            { name: 'closure', description: 'A Berry closure.' },
            { name: 'index', description: 'Variable index (0-based).' },
        ],
        returnType: 'string',
        module: 'debug',
    },
];

// ---------------------------------------------------------------------------
// Introspect module
// ---------------------------------------------------------------------------

export const INTROSPECT_FUNCTIONS: BuiltinItem[] = [
    {
        name: 'members',
        signature: 'introspect.members(object)',
        documentation: 'Returns a list of member names of `object`.',
        parameters: [{ name: 'object', description: 'Class, instance, or module.' }],
        returnType: 'list',
        module: 'introspect',
    },
    {
        name: 'get',
        signature: 'introspect.get(object, name)',
        documentation: 'Returns the value of attribute `name` from `object`.',
        parameters: [
            { name: 'object', description: 'Object to inspect.' },
            { name: 'name', description: 'Attribute name string.' },
        ],
        returnType: 'any',
        module: 'introspect',
    },
    {
        name: 'set',
        signature: 'introspect.set(object, name, value)',
        documentation: 'Sets attribute `name` on `object` to `value`.',
        parameters: [
            { name: 'object', description: 'Object to modify.' },
            { name: 'name', description: 'Attribute name string.' },
            { name: 'value', description: 'New value.' },
        ],
        returnType: 'nil',
        module: 'introspect',
    },
    {
        name: 'vcall',
        signature: 'introspect.vcall(object, name, ...args)',
        documentation: 'Calls method `name` on `object` with `args`.',
        parameters: [
            { name: 'object', description: 'Object to call on.' },
            { name: 'name', description: 'Method name.' },
            { name: '...args', description: 'Arguments.' },
        ],
        returnType: 'any',
        module: 'introspect',
    },
    {
        name: 'name',
        signature: 'introspect.name(object)',
        documentation: 'Returns the name of a function or class.',
        parameters: [{ name: 'object', description: 'Function or class.' }],
        returnType: 'string',
        module: 'introspect',
    },
    {
        name: 'module',
        signature: 'introspect.module(closure)',
        documentation: 'Returns the module that `closure` was defined in.',
        parameters: [{ name: 'closure', description: 'A Berry closure.' }],
        returnType: 'module',
        module: 'introspect',
    },
    {
        name: 'ismethod',
        signature: 'introspect.ismethod(closure)',
        documentation: 'Returns `true` if `closure` is a method (has a `self` parameter).',
        parameters: [{ name: 'closure', description: 'A Berry closure.' }],
        returnType: 'bool',
        module: 'introspect',
    },
    {
        name: 'toptr',
        signature: 'introspect.toptr(value)',
        documentation: 'Converts the internal pointer of `value` to a `comptr`.',
        parameters: [{ name: 'value', description: 'Berry value.' }],
        returnType: 'comptr',
        module: 'introspect',
    },
    {
        name: 'fromptr',
        signature: 'introspect.fromptr(ptr)',
        documentation: 'Reconstructs a Berry value from the `comptr` pointer `ptr`.',
        parameters: [{ name: 'ptr', description: 'A comptr value.' }],
        returnType: 'any',
        module: 'introspect',
    },
    {
        name: 'isptr',
        signature: 'introspect.isptr(value)',
        documentation: 'Returns `true` if `value` is a `comptr`.',
        parameters: [{ name: 'value', description: 'Berry value.' }],
        returnType: 'bool',
        module: 'introspect',
    },
    {
        name: 'iscode',
        signature: 'introspect.iscode(closure)',
        documentation: 'Returns `true` if `closure` is a Berry closure (not a native function).',
        parameters: [{ name: 'closure', description: 'A Berry closure or native function.' }],
        returnType: 'bool',
        module: 'introspect',
    },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a lookup map from function name → BuiltinItem for the given list. */
export function buildFunctionMap(items: BuiltinItem[]): Map<string, BuiltinItem> {
    return new Map(items.map(f => [f.name, f]));
}

export const GLOBAL_FUNCTION_MAP = buildFunctionMap(GLOBAL_FUNCTIONS);
export const MATH_FUNCTION_MAP = buildFunctionMap(MATH_FUNCTIONS);
export const JSON_FUNCTION_MAP = buildFunctionMap(JSON_FUNCTIONS);
export const OS_FUNCTION_MAP = buildFunctionMap(OS_FUNCTIONS);
export const DEBUG_FUNCTION_MAP = buildFunctionMap(DEBUG_FUNCTIONS);
export const INTROSPECT_FUNCTION_MAP = buildFunctionMap(INTROSPECT_FUNCTIONS);
export const STRING_METHOD_MAP = buildFunctionMap(STRING_METHODS);
export const LIST_METHOD_MAP = buildFunctionMap(LIST_METHODS);
export const MAP_METHOD_MAP = buildFunctionMap(MAP_METHODS);

/** All known importable module names. */
export const MODULE_NAMES = ['math', 'json', 'os', 'debug', 'introspect', 'global', 'solidify', 'strict', 'sys', 'string', 'path'];

/** All Berry keywords. */
export const KEYWORDS = [
    'if', 'elif', 'else', 'end', 'for', 'while', 'do',
    'break', 'continue', 'return', 'try', 'except', 'raise',
    'def', 'class', 'var', 'static', 'import', 'as',
    'true', 'false', 'nil', 'self', 'super', '_class',
];
