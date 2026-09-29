export class UserRepository {
  findById(id: string): string {
    return `db-user-${id}`;
  }
}
