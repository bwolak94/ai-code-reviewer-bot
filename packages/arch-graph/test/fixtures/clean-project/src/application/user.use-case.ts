import { UserService } from '../domain/user.service.js';

export class UserUseCase {
  constructor(private readonly userService: UserService) {}

  execute(id: string): string {
    return this.userService.getUser(id);
  }
}
