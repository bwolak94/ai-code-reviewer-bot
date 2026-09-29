export class UserService {
  getUser(id: string): string {
    return `user-${id}`;
  }
}
