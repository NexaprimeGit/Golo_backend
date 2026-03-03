import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    
    this.logger.debug(`[JWT Guard] Authorization header: ${authHeader ? 'Present' : 'Missing'}`);
    
    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        this.logger.debug(`[JWT Guard] Token format valid (Bearer)`);
      } else {
        this.logger.warn(`[JWT Guard] Invalid token format: ${parts[0]}`);
      }
    }
    
    return super.canActivate(context);
  }

  handleRequest(err, user, info) {
    if (err) {
      this.logger.error(`[JWT Guard] Error: ${err.message}`);
      throw err;
    }
    
    if (!user) {
      this.logger.warn(`[JWT Guard] No user found. Info: ${info?.message}`);
      throw new UnauthorizedException('Authentication required');
    }
    
    this.logger.debug(`[JWT Guard] User authenticated: ${user.id}`);
    return user;
  }
}