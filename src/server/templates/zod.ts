import {
    PostgresColumn, PostgresFunction,
    PostgresMaterializedView, PostgresRelationship,
    PostgresSchema,
    PostgresTable, PostgresType,
    PostgresView
} from "../../lib/index.js";
import prettier from "prettier";
import {filterFromSchema, getSchemaFunctions} from "./_common.js";

type ColumnsPerTable = Record<string, PostgresColumn[]>;

export const apply = ({
                          schemas,
                          tables,
                          views,
                          materializedViews,
                          columns,
                          relationships,
                          functions,
                          types,
                          arrayTypes,
                          detectOneToOneRelationships,
                      }: {
    schemas: PostgresSchema[]
    tables: Omit<PostgresTable, 'columns'>[]
    views: Omit<PostgresView, 'columns'>[]
    materializedViews: Omit<PostgresMaterializedView, 'columns'>[]
    columns: PostgresColumn[]
    relationships: PostgresRelationship[]
    functions: PostgresFunction[]
    types: PostgresType[]
    arrayTypes: PostgresType[]
    detectOneToOneRelationships: boolean
}): string => {
    const columnsByTableId = columns
        .sort(({ name: a }, { name: b }) => a.localeCompare(b))
        .reduce((acc, curr) => {
            acc[curr.table_id] ??= []
            acc[curr.table_id].push(curr)
            return acc
        }, {} as ColumnsPerTable)

    /*
    Example:
    ```typescript
    public.tables.user.insert()
    ```
     */

    const output = `
    import * as z from 'zod'
    import { v4 as uuidv4 } from 'uuid'
    
    const schema = {
        ${schemas.map((schema) => `${schema.name}: ${writeSchema(
            schema, 
        filterFromSchema(tables, schema.name),
        columnsByTableId,
        getSchemaFunctions(functions, schema.name),
        filterFromSchema<any>([...views, ...materializedViews], schema.name),
        types,
        arrayTypes,
        )}`).join(',\n')}
    }
    `

    return prettier.format(output, {
        parser: 'typescript',
        semi: false,
    })
}

function writeSchema(
    schema: PostgresSchema,
    availableTables: PostgresTable[],
    columnsByTableId: ColumnsPerTable,
    functions: PostgresFunction[],
    views: PostgresView[],
    types: PostgresType[],
    arrayTypes: PostgresType[],
): string {
    return `{
        tables: {
            ${availableTables.map(table => `${table.name}: {
                row: ${writeRowTable(columnsByTableId[table.id], functions.filter(fn => fn.argument_types === table.name), types)},
                insert: ${writeInsertTable(columnsByTableId[table.id])},
                update: ${writeUpdateTable(columnsByTableId[table.id])},
            }`)}
        },
        enums: {
            ${types.filter(enumType => enumType.enums.length > 0).map(enumType => `${enumType.name}: z.enum([${enumType.enums.map((value) => `"${value}"`).join(', ')}] as const)`).join(',\n')}
        },
        functions: ${writeFunctions(functions, types, arrayTypes)},
        views: {
            ${views.map(view => `${JSON.stringify(view.name)}: ${writeView(columnsByTableId[view.id])}`)}
        }
    }`
}

function writeRowTable(columns: PostgresColumn[], readFunctions: PostgresFunction[], types: PostgresType[]): string {
    return `z.object({
        ${columns.map((column) => `"${column.name}": ${writeColumn(column)}`).join(',\n')},
        ${readFunctions.map((func) => `"${func.name}": ${writeReadFunction(func, types)}`).join(',\n')}
    })`
}

function writeInsertTable(columns: PostgresColumn[]): string {
    return `z.object({
        ${columns.filter(column => column.identity_generation !== "ALWAYS").map((column) => `"${column.name}": ${writeColumn(column)}`).join(',\n')},
    })`
}

function writeUpdateTable(columns: PostgresColumn[]): string {
    return `z.object({
        ${columns
        .filter(column => column.identity_generation !== "ALWAYS")
        .map((column) => `"${column.name}": z.${basicZodType(column.format)}${joinWithLeading(uniq([...extractGeneralZodMethods(column), "optional()"]), ".")}${joinWithLeading(extractExtraZodMethods(column), ".")}`).join(',\n')},
    })`
}

function writeColumn(column: PostgresColumn): string {
    return `z.${basicZodType(column.format)}${joinWithLeading(extractGeneralZodMethods(column), ".")}${joinWithLeading(extractExtraZodMethods(column), ".")}`
}

function writeView(columns: PostgresColumn[]): string {
    return `z.object({
        ${columns.filter(column => column.is_updatable).map((column) => `${JSON.stringify(column.name)}: ${writeColumn(column)}`).join(',\n')}
    })`
}

function writeReadFunction(func: PostgresFunction, types: PostgresType[]): string {
    const type = types.find(({ id }) => id === func.return_type_id)
    const zodType = type ? basicZodType(type.format) : 'unknown'

    return `z.${zodType}().nullable()`
}

function writeFunctions(
    functions: PostgresFunction[],
    types: PostgresType[],
    arrayTypes: PostgresType[],
): string {
    const schemaFunctionsGroupedByName = functions.reduce((acc, curr) => {
        acc[curr.name] ??= []
        acc[curr.name].push(curr)
        return acc
    }, {} as Record<string, PostgresFunction[]>)

    return `{
        ${Object.entries(schemaFunctionsGroupedByName).map(([name, functions]) => {
            if (functions.length === 1) {
                return `"${functions[0].name}": ${writeFunction(functions[0], types, arrayTypes)}`
            }
            
            return "test: 1"
    }).join(',\n')}
    }`
}

function writeFunction(func: PostgresFunction, types: PostgresType[], arrayTypes: PostgresType[]): string {
    const inArgs = func.args.filter(({ mode }) => mode === 'in')

    return `z.object({
        ${inArgs.map(arg => `${JSON.stringify(arg.name)}: ${writeFunctionArg(arg, types, arrayTypes)}`).join(',\n')}
    })`
}

function writeFunctionArg(arg: PostgresFunction['args'][0], types: PostgresType[], arrayTypes: PostgresType[]): string {
    let type = arrayTypes.find(({ id }) => id === arg.type_id)
    if (type) {
        // If it's an array type, the name looks like `_int8`.
        const elementTypeName = type.name.substring(1)
        return `z.array(z.${basicZodType(elementTypeName)})` + (arg.has_default ? '.optional()' : '')
    }
    type = types.find(({ id }) => id === arg.type_id)
    if (type) {
        return "z." + basicZodType(type.format) + (arg.has_default ? '.optional()' : '')
    }

    console.info(`Function: Unknown type ${arg.type_id}`)

    return `z.unknown()` + (arg.has_default ? '.optional()' : '')
}

function basicZodType(pgType: string): string {
    // Array
    if (pgType.startsWith("_")) {
        return basicZodType(pgType.substring(1)) + ".array()"
    }

    if ([ 'bool', 'boolean' ].includes(pgType)) {
        return "boolean()"
    }

    if (['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'integer', 'bigint', 'oid'].includes(pgType)) {
        return 'number()'
    }

    if (
        [
            'bytea',
            'bpchar',
            'varchar',
            'text',
            'citext',
            'uuid',
            'vector',
            'json',
            'jsonb',
            'inet'
        ].includes(pgType)
    ) {
        return 'string()'
    }

    if (["date", "time", "timetz", "timestamp", "timestamptz"].includes(pgType)) {
        return 'date()'
    }


    console.info(`Basic Zod Type: Unknown type ${pgType}`)

    // Everything else is an enum
    return "string()"
}

const IP_REGEX = "^((((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))|((([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))))\\/[0-9]{1,3}$"

function extractExtraZodMethods(column: PostgresColumn): string[] {
    const methods: string[] = []

    // UUID
    if (column.format === "uuid") {
        methods.push("regex(/^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/)")

        if (column.default_value === "gen_random_uuid()") {
            methods.push("default(() => uuidv4())")
        }
    }

    // Date and time types
    if (["date", "time", "timetz", "timestamp", "timestamptz"].includes(column.format)) {
        if (column.default_value === "now()") {
            methods.push("default(() => new Date())")
        }
    }

    // Enums
    if (column.data_type === "USER-DEFINED") {
        methods.push(`enum([${column.enums.map((value) => `"${value}"`).join(', ')}] as const)`)
    }

    if (column.format === "inet") {
        // Zods `ip` method doesn't check for subnets, so we use our own regex instead.
        methods.push(`regex(/${IP_REGEX}/)`)
    }

    return methods
}

function extractGeneralZodMethods(column: PostgresColumn): string[] {
    const methods: string[] = []

    if (
        column.is_nullable ||
        column.is_identity ||
        column.default_value !== null
    ) {
        methods.push("optional()")
    }
    if (column.is_nullable) {
        methods.push("nullable()")
    }

    return methods
}

function joinWithLeading<T>(arr: T[], join: string): string {
    if (arr.length === 0) {
        return ""
    }

    return join + arr.join(join)
}

/** Remove duplicate values from an array.
 * Creates a new array.
 * @param arr - The array to remove duplicates from.
 */
function uniq<T>(arr: T[]): T[] {
    return [...new Set(arr)]
}

/** Create a zod object type for a table.
 * You probably don't want to call this function, unless you're writing a custom template.
 * Example:
 * Given a table that looks like this:
 * ```sql
 * CREATE TABLE public.users (
 * id uuid NOT NULL,
 * name text,
 * email text NOT NULL,
 * created_at timestamp without time zone NOT NULL DEFAULT now()
 * );
 * The generated zod object would look like this:
 * ```typescript
 * const User = z.object({
 *  // uuid
 *  id: z.number().regex(/^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/),
 *  name: z.string().nullable(),
 *  email: z.string(),
 *  created_at: z.date().default(() => new Date()),
 * })
 *  ```
 * @param tableName - The name of the table; e.g. `users` will be snake cased and used as the variable name.
 * @param columns - The columns of the table.
 * @returns A zod object type.
 */
function createTableObject(tableName: string, columns: PostgresColumn[]) {}
