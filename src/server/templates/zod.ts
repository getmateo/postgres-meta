import {
    PostgresColumn, PostgresFunction,
    PostgresMaterializedView, PostgresRelationship,
    PostgresSchema,
    PostgresTable, PostgresType,
    PostgresView
} from "../../lib/index.js";
import Tables from "../routes/tables.js";
import pg from "pg";
import prettier from "prettier";

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
    const schema = {
        ${schemas.map((schema) => `${schema.name}: ${writeSchema(schema, tables, columnsByTableId)}`).join(',\n')}
    }
    `

    return prettier.format(output, {
        parser: 'typescript',
        semi: false,
    })
}

function writeSchema(schema: PostgresSchema, availableTables: PostgresTable[], columnsByTableId: ColumnsPerTable): string {
    const schemaTables = availableTables
        .filter((table) => table.schema === schema.name)
        .sort(({ name: a }, { name: b }) => a.localeCompare(b))

    return `{
        insert: {
            ${schemaTables.map((table) => `${table.name}: ${writeTable(table, columnsByTableId[table.id])}`).join(',\n')}
        }
    }`
}

function writeTable(table: PostgresTable, columns: PostgresColumn[]): string {
    return `{
        ${columns.map((column) => `"${column.name}": ${writeColumn(column)}`).join(',\n')},
        _enums: {
            ${columns.filter(hasColumnEnum).map((column) => `${getColumnEnum(column)}`).join(',\n')}
        }
    }`
}

function writeColumn(column: PostgresColumn): string {
    return `z.${basicZodType(column.format)}()${joinWithLeading(extraZodMethods(column), ".")}`
}

function hasColumnEnum(column: PostgresColumn): boolean {
    return column.enums.length > 0
}

function getColumnEnum(column: PostgresColumn): string {
    return `${column.format}: z.enum([${column.enums.map((value) => `"${value}"`).join(', ')} as const])`
}

function basicZodType(pgType: string): string {
    if (pgType === "boolean") {
        return "boolean"
    }

    if (['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'integer'].includes(pgType)) {
        return 'number'
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
        ].includes(pgType)
    ) {
        return 'string'
    }

    if (["date", "time", "timetz", "timestamp", "timestamptz"].includes(pgType)) {
        return 'date'
    }

    console.info(`Unknown type ${pgType}`)

    // Everything else is an enum
    return "string"
}

function extraZodMethods(column: PostgresColumn): string[] {
    const methods: string[] = []

    if (column.format === "uuid") {
        methods.push("regex(/^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/)")
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

    // General constraints
    if (column.is_nullable) {
        methods.push("optional()")
    }

    return methods
}

function joinWithLeading<T>(arr: T[], join: string): string {
    if (arr.length === 0) {
        return ""
    }

    return join + arr.join(join)
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
