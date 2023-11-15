import {
    PostgresColumn, PostgresFunction,
    PostgresMaterializedView, PostgresRelationship,
    PostgresSchema,
    PostgresTable, PostgresType,
    PostgresView
} from "../../lib/index.js";

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
}): string {
    debugger
}
