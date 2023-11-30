import {PostgresFunction, PostgresType} from "../../lib/index.js";

export const filterFromSchema = <T extends {schema: string, name: string}>(items: T[], schemaName: string): T[] => {
    return items.filter((item) => item.schema === schemaName).sort(({name: a}, {name: b}) => a.localeCompare(b))
}

export const filterSchemaFunctions = (functions: PostgresFunction[], schemaName: string): PostgresFunction[] => {
    return functions
        .filter((func) => {
            if (func.schema !== schemaName) {
                return false
            }

            // Either:
            // 1. All input args are be named, or
            // 2. There is only one input arg which is unnamed
            const inArgs = func.args.filter(({ mode }) => ['in', 'inout', 'variadic'].includes(mode))

            return inArgs.length === 1 || !inArgs.some(({ name }) => name === '')
        })
        .sort(({ name: a }, { name: b }) => a.localeCompare(b))
}

export const filterSchemaEnums = (types: PostgresType[], schemaName: string): PostgresType[] =>
    types
        .filter((type) => type.schema === schemaName && type.enums.length > 0)
        .sort(({ name: a }, { name: b }) => a.localeCompare(b))

