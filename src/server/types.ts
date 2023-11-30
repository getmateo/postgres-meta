import {
    PostgresColumn, PostgresFunction,
    PostgresMaterializedView,
    PostgresRelationship,
    PostgresSchema,
    PostgresTable, PostgresType,
    PostgresView
} from "../lib/index.js";

export interface TemplateProps {
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
}
