import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const correlationId = request.headers['x-correlation-id'] ?? 'no-correlation-id';

    this.logger.error(
      JSON.stringify({
        correlationId,
        path: request.url,
        method: request.method,
        statusCode: status,
        error: message,
      }),
    );

    response.status(status).json({
      statusCode: status,
      error: message,
      path: request.url,
      timestamp: new Date().toISOString(),
      correlationId,
    });
  }
}
