/** Infrastructure layer — database access class. */
export class DbRepository {
  private readonly tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  query(sql: string): string {
    return `SELECT * FROM ${this.tableName} WHERE ${sql}`;
  }
}
