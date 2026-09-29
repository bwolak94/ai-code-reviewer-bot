import { UserService } from '../domain/user.service.js';

export class UserRepository {
  constructor(private readonly userService: UserService) {}

  save(user: ReturnType<UserService['getUser']>): void {
    void user;
  }
}
