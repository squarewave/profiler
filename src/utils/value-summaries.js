const JSVAL_TYPE_DOUBLE = 0x00;
const JSVAL_TYPE_INT32 = 0x01;
const JSVAL_TYPE_BOOLEAN = 0x02;
const JSVAL_TYPE_UNDEFINED = 0x03;
const JSVAL_TYPE_NULL = 0x04;
const JSVAL_TYPE_MAGIC = 0x05;
const JSVAL_TYPE_STRING = 0x06;
const JSVAL_TYPE_SYMBOL = 0x07;
const JSVAL_TYPE_PRIVATE_GCTHING = 0x08;
const JSVAL_TYPE_BIGINT = 0x09;
const JSVAL_TYPE_EXTENDED_PRIMITIVE = 0x0b;
const JSVAL_TYPE_OBJECT = 0x0c;

const GETTER_SETTER_MAGIC = 0xf;

const MAX_ARGUMENTS_TO_RECORD = 4;
const ZERO_ARGUMENTS_MAGIC = -2;
const EXPIRED_VALUES_MAGIC = -1;
const VOID_RETURN_MAGIC = -3;

const OBJECT_IS_INDEXED_FLAG = 1;
const OBJECT_IS_EXTENSIBLE_FLAG = 2;
const OBJECT_IS_SEALED_FLAG = 4;
const OBJECT_IS_FROZEN_FLAG = 8;

const NUMBER_IS_OUT_OF_LINE_MAGIC = 0xf;
const MIN_INLINE_INT = -1;
const MAX_INLINE_INT = 13;

const STRING_TOO_LONG_FLAG = 1;

const STRING_ENCODING_LATIN1 = 0;
const STRING_ENCODING_TWO_BYTE = 1;
const STRING_ENCODING_UTF8 = 2;

const OBJECT_KIND_NOT_IMPLEMENTED = 0;
const OBJECT_KIND_ARRAY_LIKE = 1;
const OBJECT_KIND_MAP_LIKE = 2;
const OBJECT_KIND_FUNCTION = 3;
const OBJECT_KIND_WRAPPED_PRIMITIVE_OBJECT = 4;
const OBJECT_KIND_NATIVE_OBJECT = 5;
const OBJECT_KIND_EXTERNAL = 6;
const OBJECT_KIND_PROXY_OBJECT = 7;

const EXTERNAL_SUMMARY_KIND_UNKNOWN = 0;
const EXTERNAL_SUMMARY_KIND_ELEMENT = 1;
const EXTERNAL_SUMMARY_KIND_OTHER_NODE = 2;

const MAX_COLLECTION_VALUES = 16;
const MAX_SHAPE_PROPERTIES = 16;

class BufferReader {
  #view;
  #index;

  constructor(buffer, index = 0) {
    this.#view = new DataView(buffer);
    this.#index = index;
  }

  peekUint8() {
    return this.#view.getUint8(this.#index);
  }

  readUint8() {
    let result = this.#view.getUint8(this.#index);
    this.#index += 1;
    return result;
  }

  readUint16() {
    let result = this.#view.getUint16(this.#index, true);
    this.#index += 2;
    return result;
  }

  readUint32() {
    let result = this.#view.getUint32(this.#index, true);
    this.#index += 4;
    return result;
  }

  readInt8() {
    let result = this.#view.getInt8(this.#index);
    this.#index += 1;
    return result;
  }

  readInt16() {
    let result = this.#view.getInt16(this.#index, true);
    this.#index += 2;
    return result;
  }

  readInt32() {
    let result = this.#view.getInt32(this.#index, true);
    this.#index += 4;
    return result;
  }

  readFloat32() {
    let result = this.#view.getFloat32(this.#index, true);
    this.#index += 4;
    return result;
  }

  readFloat64() {
    let result = this.#view.getFloat64(this.#index, true);
    this.#index += 8;
    return result;
  }

  readString() {
    let encoding = this.readUint8();
    let length = this.readUint32();
    if (length == 0) {
      return "";
    }
    let result = "";
    if (encoding == STRING_ENCODING_LATIN1) {
      let decoder = new TextDecoder("latin1");
      result = decoder.decode(this.#view.buffer.slice(this.#index, this.#index + length));
      this.#index += length;
    } else if (encoding == STRING_ENCODING_UTF8) {
      let decoder = new TextDecoder("utf-8");
      result = decoder.decode(this.#view.buffer.slice(this.#index, this.#index + length));
      this.#index += length;
    } else if (encoding == STRING_ENCODING_TWO_BYTE) {
      let decoder = new TextDecoder("utf-16"); // this isn't quite right, is it? ugh.
      let size = length * 2;
      result = decoder.decode(this.#view.buffer.slice(this.#index, this.#index + size));
      this.#index += size;
    }
    return result;
  }
}

function readArrayLikeSummary(result, reader, flags, depth, shapes) {
  let shapeId = reader.readUint32();
  let shape = shapes[shapeId];

  if (!shape || shape.length <= 0) {
    return;
  }
  result.class = shape[0];

  let preview = {};
  preview.kind = "ArrayLike";

  if (depth > 1) {
    return;
  }

  preview.items = [];
  preview.length = reader.readUint32();
  for (let i = 0; i < preview.length && i < MAX_COLLECTION_VALUES; i++) {
    let nestedSummary = readValueSummary(reader, depth, shapes);
    preview.items.push({
      configurable: true,
      enumerable: true,
      writable: true,
      value: nestedSummary,
    });
  }

  result.preview = preview;
}

function readFunctionSummary(result, reader, flags, depth) {
  result.class = "Function";
  result.name  = reader.readString();
  result.parameterNames = [];
  let numParameterNames = reader.readUint32();
  for (let i = 0; i < numParameterNames && i < MAX_COLLECTION_VALUES; i++) {
    result.parameterNames.push(reader.readString());
  }

  result.userDisplayName = reader.readString();
}

function readMapLikeSummary(result, reader, flags, depth, shapes) {
  let shapeId = reader.readUint32();
  let shape = shapes[shapeId];

  if (!shape || shape.length <= 0) {
    return;
  }
  result.class = shape[0];

  let preview = {};
  preview.kind = "MapLike";

  if (depth > 1) {
    return;
  }

  preview.entries = [];
  preview.size = reader.readUint32();
  for (let i = 0; i < preview.length && i < MAX_COLLECTION_VALUES; i++) {
    let keySummary = readValueSummary(reader, depth, shapes);
    let valueSummary = readValueSummary(reader, depth, shapes);
    preview.entries.push([{
      configurable: true,
      enumerable: true,
      writable: true,
      value: keySummary,
    }, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: valueSummary,
    }]);
  }

  result.preview = preview;
}

function readNativeObjectSummary(result, reader, flags, depth, shapes) {
  let shapeId = reader.readUint32();
  let shape = shapes[shapeId];

  if (!shape || shape.length <= 0) {
    return;
  }
  result.class = shape[0];

  if (depth > 1) {
    return;
  }

  let preview = {};
  preview.kind = "Object";

  let indexed = !!(flags & OBJECT_IS_INDEXED_FLAG);
  let ownProperties = {};
  let ownPropertiesLength = 0;

  if (indexed) {
    let elementsLength = reader.readUint32();
    for (let i = 0; i < elementsLength && i < MAX_COLLECTION_VALUES; i++) {
      ownPropertiesLength++;
      let nestedSummary = readValueSummary(reader, depth, shapes);
      ownProperties[i] = {
        configurable: true,
        enumerable: true,
        writable: true,
        value: nestedSummary,
      };
    }
  }

  for (let i = 1; i < shape.length && i <= MAX_SHAPE_PROPERTIES; i++) {
    ownPropertiesLength++;
    let header = reader.peekUint8();
    let id = shape[i];
    let desc = {
      configurable: true,
      enumerable: true,
      get: undefined,
      set: undefined,
    };
    if ((header & 0xf) == GETTER_SETTER_MAGIC) {
      reader.readUint8();
      desc.get = readValueSummary(reader, depth, shapes);
      desc.set = readValueSummary(reader, depth, shapes);
    } else {
      let nestedSummary = readValueSummary(reader, depth, shapes);
      desc.writable = true;
      desc.value = nestedSummary;
    }
    ownProperties[id] = desc;
  }

  preview.ownProperties = ownProperties;
  preview.ownPropertiesLength = ownPropertiesLength;

  result.preview = preview;
}

function readExternalObjectSummary(result, reader, flags, depth, shapes) {
  let preview = {};
  
  result.class = reader.readString();
  let kind = reader.readUint8();

  if (kind == EXTERNAL_SUMMARY_KIND_UNKNOWN) {
    return;
  }

  let isConnected = !!reader.readUint8();
  let nodeType = reader.readUint16();
  preview.kind = "DOMNode";
  preview.isConnected = isConnected;
  preview.nodeType = nodeType;
  
  if (kind == EXTERNAL_SUMMARY_KIND_ELEMENT) {
    preview.nodeName = reader.readString();
    let numAttributes = reader.readUint32();
    preview.attributes = {};
    preview.attributesLength = numAttributes;
    for (let i = 0; i < numAttributes; i++) {
      let attrName = reader.readString();
      let attrVal = reader.readString();
      preview.attributes[attrName] = attrVal;      
    }
  }

  result.preview = preview;
}

function readObjectSummary(reader, flags, depth, shapes) {
  let extensible = !!(flags & OBJECT_IS_EXTENSIBLE_FLAG);
  let frozen = !!(flags & OBJECT_IS_FROZEN_FLAG);
  let sealed = !!(flags & OBJECT_IS_SEALED_FLAG);

  let result = {
    type: "object",
    class: undefined,
    ownPropertyLength: 0,
    isError: false,
    extensible,
    sealed,
    frozen,
  };

  let kind = reader.readUint8();
  switch (kind) {
    case OBJECT_KIND_NOT_IMPLEMENTED:
      result.class = reader.readString();
      break;
    case OBJECT_KIND_ARRAY_LIKE:
      readArrayLikeSummary(result, reader, flags, depth + 1, shapes);
      break;
    case OBJECT_KIND_MAP_LIKE:
      readMapLikeSummary(result, reader, flags, depth + 1, shapes);
      break;
    case OBJECT_KIND_FUNCTION:
      readFunctionSummary(result, reader, flags, depth + 1, shapes);
      break;
    case OBJECT_KIND_EXTERNAL:
      readExternalObjectSummary(result, reader, flags, depth + 1, shapes);
      break;
    case OBJECT_KIND_WRAPPED_PRIMITIVE_OBJECT: {
      result.wrappedValue = readValueSummary(reader, depth + 1, shapes);
      readNativeObjectSummary(result, reader, flags, depth + 1, shapes);
      break;
    }
    case OBJECT_KIND_NATIVE_OBJECT: {
      readNativeObjectSummary(result, reader, flags, depth + 1, shapes);
      break;
    }
    case OBJECT_KIND_PROXY_OBJECT: {
      result.class = "Proxy";
      result.preview = {
        kind: "Object",
        ownProperties: Object.create(null),
        ownPropertiesLength: 0,
      };
      break;
    }
    default:
      throw new Error("Bad object kind");
  }

  return result;
}

function readValueSummary(reader, depth, shapes) {
  let header = reader.readUint8();
  let type = header & 0x0f;
  let flags = (header & 0xf0) >> 4;
  switch (type) {
    case JSVAL_TYPE_DOUBLE:
      if (flags == NUMBER_IS_OUT_OF_LINE_MAGIC) {
        let value = reader.readFloat64();
        if (value === Infinity) {
          return { type: "Infinity" };
        } else if (value === -Infinity) {
          return { type: "-Infinity" };
        } else if (Number.isNaN(value)) {
          return { type: "NaN" };
        } else if (!value && 1 / value === -Infinity) {
          return { type: "-0" };
        }
        return value;
      } else {
        return 0;
      }
    case JSVAL_TYPE_INT32:
      if (flags == NUMBER_IS_OUT_OF_LINE_MAGIC) {
        return reader.readInt32();
      } else {
        return flags + MIN_INLINE_INT;
      }
    case JSVAL_TYPE_BOOLEAN:
      return !!flags;
    case JSVAL_TYPE_NULL:
      return { type: "null" };
    case JSVAL_TYPE_UNDEFINED:
      return { type: "undefined" };
    case JSVAL_TYPE_MAGIC:
    case JSVAL_TYPE_PRIVATE_GCTHING:
    case JSVAL_TYPE_EXTENDED_PRIMITIVE:
      return { type: "unexpected" };
    case JSVAL_TYPE_SYMBOL:
      var result = reader.readString();
      if (flags & STRING_TOO_LONG_FLAG) {
        result += "...";
      }
      return {
        type: "Symbol",
        name: result
      };
    case JSVAL_TYPE_BIGINT:
      var result = reader.readString();
      if (flags & STRING_TOO_LONG_FLAG) {
        result += "...";
      }
      return {
        type: "BigInt",
        text: result
      };
    case JSVAL_TYPE_STRING: {
      var result = reader.readString();
      if (flags & STRING_TOO_LONG_FLAG) {
        result += "...";
      }
      return result;
    }
    case JSVAL_TYPE_OBJECT: {
      return readObjectSummary(reader, flags, depth, shapes);
    }
    default:
      throw new Error("Bad value type");
  }
}

export function getArgumentSummaries(thread, valuesBufferIndex) {
  if (valuesBufferIndex == ZERO_ARGUMENTS_MAGIC) {
    return [];
  }
  if (valuesBufferIndex == EXPIRED_VALUES_MAGIC) {
    return "<missing>";
  }

  try {
    let reader = new BufferReader(thread.valuesBuffer, valuesBufferIndex);
    let argc = reader.readUint32();
    let args = new Array(argc);
    for (let i = 0; i < argc; i++) {
      args[i] = readValueSummary(reader, 0, thread.shapes);
    }
    return args;
  } catch(e) {
    let reader = new BufferReader(thread.valuesBuffer, valuesBufferIndex);
    let argc = reader.readUint32();
    let args = new Array(argc);
    for (let i = 0; i < argc; i++) {
      args[i] = readValueSummary(reader, 0, thread.shapes);
    }
    return args;
  }
}

export function getReturnValueSummary(thread, valuesBufferIndex) {
  if (valuesBufferIndex == VOID_RETURN_MAGIC) {
    return undefined;
  }
  if (valuesBufferIndex == EXPIRED_VALUES_MAGIC) {
    return "<missing>";
  }
  let reader = new BufferReader(thread.valuesBuffer, valuesBufferIndex);
  return readValueSummary(reader, 0, thread.shapes);
}

export function base64StringToArrayBuffer(str) {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(str).buffer;
  }
  return null;
}
