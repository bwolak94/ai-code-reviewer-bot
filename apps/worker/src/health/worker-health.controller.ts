import {
  Controller,
  Get,
  HttpCode,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Health endpoint for the worker service.
 * Used by load balancers and Kubernetes readiness probes.
 *
 * During graceful shutdown (SIGTERM received), returns 503 to prevent
 * the load balancer from routing new traffic to a shutting-down instance.
 *
 * Per devops-review.md Section 2.2, the 90-second shutdown window gives
 * in-flight jobs time to complete before the process exits.
 */
@Controller('health')
export class WorkerHealthController {
  constructor(
    @Inject('SHUTDOWN_STATE')
    private readonly shutdownState: { isShuttingDown: boolean },
  ) {}

  @Get()
  @HttpCode(200)
  getHealth(): { status: string } {
    if (this.shutdownState.isShuttingDown) {
      throw new ServiceUnavailableException({ status: 'shutting_down' });
    }
    return { status: 'ok' };
  }
}
