import * as path from "path";
import {
  GraphQLNullableType,
  GraphQLNamedType,
  isCompositeType,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLScalarType,
  GraphQLEnumType,
  GraphQLNonNull,
  getNamedType,
  getNullableType
} from "graphql";
import {
  FinalOptions,
  TypeEncoders,
  TypeEncoder,
  TypeDecoders,
  TypeDecoder
} from "./options";
import {
  cachedValue,
  findByIdIn,
  getMaxOrder,
  nextValidName,
  validNameUpper,
  validModuleName,
  validTypeName,
  validTypeConstructorName,
  validVariableName,
  validFieldName
} from "./utils";
import {
  QueryIntel,
  QueryItem,
  QueryInputItem,
  QueryOutputItem
} from "./queryIntel";
import { wrappedType } from "./generateElm";
import {
  ElmIntel,
  ElmItem,
  ElmEncodeItem,
  ElmDecodeItem
} from "./elmIntelTypes";

export * from "./elmIntelTypes";

export const queryToElmIntel = (
  queryIntel: QueryIntel,
  options: FinalOptions
): ElmIntel => {
  let dest;
  let module;

  if (!queryIntel.src) {
    dest = "./Query.elm";
    module = "Query";
  } else {
    const srcPath = path.relative(options.src, queryIntel.src);
    const srcInfo = path.parse(srcPath);

    const moduleParts = srcInfo.dir
      .split(/[\\/]/)
      .filter(x => !!x)
      .concat(srcInfo.name)
      .map(validModuleName);

    dest = path.resolve(options.dest, ...moduleParts) + ".elm";
    module = moduleParts.join(".");
  }

  const intel: ElmIntel = {
    dest,
    module,
    query: queryIntel.query,
    usedNames: getReservedNames(),
    typesBySignature: {},
    encode: {
      items: [],
      encodersByType: {}
    },
    decode: {
      items: [],
      decodersByType: {}
    }
  };

  queryIntel.inputs
    .sort((a, b) => b.depth - a.depth || a.order - b.order)
    .forEach(addEncodeItem(intel, options));

  let nextDecodeId = queryIntel.outputs.length;
  const getNextDecodeId = () => ++nextDecodeId;

  queryIntel.outputs
    .sort((a, b) => b.depth - a.depth || a.order - b.order)
    .forEach(addDecodeItem(intel, getNextDecodeId, options));

  // console.log("elm intel", JSON.stringify(intel, null, "  "));

  return intel;
};

const addEncodeItem = (intel: ElmIntel, options: FinalOptions) => (
  queryItem: QueryInputItem
): void => {
  const info = getItemInfo(queryItem);
  const namedType: GraphQLNamedType = getNamedType(queryItem.type);

  info.isOptional = info.isNullable;
  info.isListOfOptionals = info.isListOfNullables;

  let item: ElmEncodeItem;

  if (info.id === 0) {
    setRecordFieldNames(info.children, intel.encode.items);
    item = {
      ...info,
      isOptional: false,
      isNullable: false,
      isList: false,
      kind: "record",
      type: "Variables",
      encoder: "encodeVariables"
    };
  } else if (namedType instanceof GraphQLInputObjectType) {
    setRecordFieldNames(info.children, intel.encode.items);
    const type = newRecordType(info, intel.encode.items, intel);
    item = {
      ...info,
      kind: "record",
      type,
      encoder: newEncoderName(type, intel)
    };
  } else if (namedType instanceof GraphQLScalarType) {
    const scalarEncoder: TypeEncoder | undefined =
      options.scalarEncoders[namedType.name] ||
      defaultScalarEncoders[namedType.name];

    if (!scalarEncoder) {
      `No encoder defined for scalar type: ${
        queryItem.type
      }. Please add one to options.scalarEncoders`;
    }

    item = {
      ...info,
      kind: "scalar",
      type: scalarEncoder.type,
      encoder: scalarEncoder.encoder
    };
  } else if (namedType instanceof GraphQLEnumType) {
    const typeName: string = namedType.name;
    const enumEncoder: TypeEncoder | undefined = options.enumEncoders[typeName];

    if (!enumEncoder) {
      throw new Error(
        `No encoder defined for enum type: ${
          queryItem.type
        }. Please add one to options.enumEncoders`
      );
    }

    item = {
      ...info,
      kind: "enum",
      type: enumEncoder.type,
      encoder: enumEncoder.encoder
    };
  } else {
    throw new Error(`Unhandled query input type: ${queryItem.type}`);
  }

  intel.encode.items.push(item);
};

const addDecodeItem = (
  intel: ElmIntel,
  nextId: () => number,
  options: FinalOptions
) => (queryItem: QueryOutputItem): void => {
  if (!queryItem.isValid) {
    return;
  }

  const info = getItemInfo(queryItem);
  const namedType: GraphQLNamedType = getNamedType(queryItem.type);

  info.isOptional = queryItem.withDirective;

  let item: ElmDecodeItem;

  if (isCompositeType(namedType)) {
    if (info.id === 0) {
      setRecordFieldNames(info.children, intel.decode.items);
      item = {
        ...info,
        kind: "record",
        type: "Data",
        decoder: "decoder",
        unionConstructor: ""
      };
      intel.typesBySignature[""] = item.type;
      intel.decode.decodersByType[item.type] = item.decoder;
    } else if (queryItem.isFragmented) {
      checkUnionChildSignatures(queryItem.children, intel.decode.items);

      const prefix = queryItem.isFragmentedOn ? "On" : "";
      const type = newUnionType(
        `${prefix}${namedType.name}`,
        info.children,
        intel
      );

      item = {
        ...info,
        kind: queryItem.isFragmentedOn ? "union-on" : "union",
        type,
        decoder: newDecoderName(type, intel),
        unionConstructor: ""
      };

      if (!queryItem.hasAllPosibleFragmentTypes) {
        const children = item.children.map(findByIdIn(intel.decode.items));
        const otherItem: ElmDecodeItem = {
          id: nextId(),
          name: "",
          queryTypename: "",
          fieldName: "",
          order: getMaxOrder(children) + 0.5,
          children: [],
          isOptional: false,
          isListOfOptionals: false,
          isNullable: false,
          isList: false,
          isListOfNullables: false,
          kind: "empty",
          type: `Other${namedType.name}`,
          decoder: queryItem.isFragmentedOn
            ? "Json.Decode.succeed"
            : "GraphqlToElm.DecodeHelpers.emptyObjectDecoder",
          unionConstructor: ""
        };

        item.children.push(otherItem.id);
        intel.decode.items.push(otherItem);
      }

      setUnionConstructorNames(item, intel);
    } else {
      setRecordFieldNames(info.children, intel.decode.items);
      const type = newRecordType(info, intel.decode.items, intel);

      item = {
        ...info,
        kind: "record",
        type,
        decoder: newDecoderName(type, intel),
        unionConstructor: ""
      };
    }
  } else if (namedType instanceof GraphQLScalarType) {
    const scalarDecoder: TypeDecoder | undefined =
      options.scalarDecoders[namedType.name] ||
      defaultScalarDecoders[namedType.name];

    if (!scalarDecoder) {
      throw new Error(
        `No decoder defined for scalar type: ${
          queryItem.type
        }. Please add one to options.scalarDecoders`
      );
    }

    item = {
      ...info,
      kind: "scalar",
      type: scalarDecoder.type,
      decoder: scalarDecoder.decoder,
      unionConstructor: ""
    };
  } else if (namedType instanceof GraphQLEnumType) {
    const typeName: string = namedType.name;
    const enumDecoder: TypeDecoder | undefined = options.enumDecoders[typeName];

    if (!enumDecoder) {
      throw new Error(
        `No decoder defined for enum type: ${
          queryItem.type
        }. Please add one to options.enumDecoders`
      );
    }

    item = {
      ...info,
      kind: "enum",
      type: enumDecoder.type,
      decoder: enumDecoder.decoder,
      unionConstructor: ""
    };
  } else {
    throw new Error(`Unhandled query output type: ${queryItem.type}`);
  }

  intel.decode.items.push(item);
};

const defaultScalarEncoders: TypeEncoders = {
  Int: {
    type: "Int",
    encoder: "Json.Encode.int"
  },
  Float: {
    type: "Float",
    encoder: "Json.Encode.float"
  },
  Boolean: {
    type: "Bool",
    encoder: "Json.Encode.bool"
  },
  String: {
    type: "String",
    encoder: "Json.Encode.string"
  },
  ID: {
    type: "String",
    encoder: "Json.Encode.string"
  }
};

const defaultScalarDecoders: TypeDecoders = {
  Int: {
    type: "Int",
    decoder: "Json.Decode.int"
  },
  Float: {
    type: "Float",
    decoder: "Json.Decode.float"
  },
  Boolean: {
    type: "Bool",
    decoder: "Json.Decode.bool"
  },
  String: {
    type: "String",
    decoder: "Json.Decode.string"
  },
  ID: {
    type: "String",
    decoder: "Json.Decode.string"
  }
};

const getItemInfo = (queryItem: QueryItem) => {
  const nullableType: GraphQLNullableType = getNullableType(queryItem.type);

  return {
    id: queryItem.id,
    name: queryItem.name,
    queryTypename: queryItem.type ? getNamedType(queryItem.type).name : "",
    fieldName: "",
    order: queryItem.order,
    children: queryItem.children.slice(),
    isOptional: false,
    isListOfOptionals: false,
    isNullable: !(queryItem.type instanceof GraphQLNonNull),
    isList: nullableType instanceof GraphQLList,
    isListOfNullables:
      nullableType instanceof GraphQLList &&
      !(nullableType.ofType instanceof GraphQLNonNull)
  };
};

const reservedNames = [
  "Int",
  "Float",
  "Bool",
  "String",
  "List",
  "Variables",
  "Data",
  "query",
  "encodeVariables",
  "decoder"
];

const getReservedNames = () => [...reservedNames];

const newName = (name: string, intel: ElmIntel): string =>
  nextValidName(name, intel.usedNames);

const setRecordFieldNames = (fieldItems: number[], items: ElmItem[]) => {
  const usedFieldNames = [];
  fieldItems.map(findByIdIn(items)).forEach(item => {
    if (!item.name) {
      throw new Error(`Elm intel field item ${item.type} does not have a name`);
    }
    item.fieldName = nextValidName(validFieldName(item.name), usedFieldNames);
  });
};

const newRecordType = (
  item: { queryTypename: string; children: number[] },
  items: ElmItem[],
  intel: ElmIntel
): string => {
  let signature = `${item.queryTypename}: ${getRecordFieldsSignature(
    item,
    items
  )}`;

  return cachedValue(signature, intel.typesBySignature, () =>
    newName(validTypeName(item.queryTypename), intel)
  );
};

const getRecordFieldsSignature = (
  item: { queryTypename: string; children: number[] },
  items: ElmItem[]
): string =>
  item.children
    .map(findByIdIn(items))
    .map(child => {
      if (!child.fieldName) {
        throw new Error(
          `Elm intel field item ${child.type} does not have a fieldName`
        );
      }
      return child.name === "__typename"
        ? `${child.fieldName} : ${wrappedType(child)} ${item.queryTypename}`
        : `${child.fieldName} : ${wrappedType(child)}`;
    })
    .sort()
    .join(", ");

const getRecordFieldsJsonSignature = (
  item: ElmItem,
  items: ElmItem[]
): string =>
  item.children
    .map(findByIdIn(items))
    .map(child => getRecordFieldJsonSignature(child, item, items))
    .sort()
    .join(", ");

const getRecordFieldJsonSignature = (
  item: ElmItem,
  parent: ElmItem,
  items: ElmItem[]
): string => {
  if (!item.name) {
    throw new Error(`Elm intel field item ${item.type} does not have a name`);
  }

  let signature;

  if (item.kind === "record") {
    signature = `{${getRecordFieldsJsonSignature(item, items)}}`;
  } else if (item.name === "__typename") {
    signature = parent.type;
  } else {
    signature = item.type;
  }

  if (item.isList) {
    signature = `[${signature}]`;
  }

  return `${item.name} : ${signature}`;
};

const checkUnionChildSignatures = (
  children: number[],
  items: ElmDecodeItem[]
) => {
  const childSignatures = children
    .map(findByIdIn(items))
    .map(item => getRecordFieldsJsonSignature(item, items));

  childSignatures.forEach((signatue, index) => {
    if (childSignatures.indexOf(signatue) !== index) {
      throw Error(
        `multiple union children with the same json signature: ${signatue}`
      );
    }
  });
};

const newUnionType = (
  type: string,
  children: number[],
  intel: ElmIntel
): string => {
  const childSignatures = children
    .map(findByIdIn(intel.decode.items))
    .map(item => item.type);

  const signature = `${type}: ${childSignatures.join(", ")}`;

  return cachedValue(signature, intel.typesBySignature, () =>
    newName(validTypeName(type), intel)
  );
};

const setUnionConstructorNames = (item: ElmDecodeItem, intel: ElmIntel) =>
  item.children.map(findByIdIn(intel.decode.items)).forEach(child => {
    child.unionConstructor = newUnionConstructor(item.type, child.type, intel);
  });

const newUnionConstructor = (
  unionType: string,
  constructorType: string,
  intel: ElmIntel
): string =>
  cachedValue(`${unionType} On${constructorType}`, intel.typesBySignature, () =>
    newName(validTypeConstructorName(`On${constructorType}`), intel)
  );

const newEncoderName = (type: string, intel: ElmIntel) =>
  cachedValue(type, intel.encode.encodersByType, () =>
    newName(`encode${validNameUpper(type)}`, intel)
  );

const newDecoderName = (type: string, intel: ElmIntel) =>
  cachedValue(type, intel.decode.decodersByType, () =>
    newName(validVariableName(`${type}Decoder`), intel)
  );
