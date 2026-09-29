/** Intentionally empty service — business logic leaked into the controller. */
export class AppService {
  // No methods intentionally to simulate the anti-pattern
  // where logic was placed directly in the controller.
  getServiceName(): string {
    return 'AppService';
  }
}
