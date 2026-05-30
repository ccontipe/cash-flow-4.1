import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * AuthController — somente disponível em NODE_ENV !== 'production'
 * Gera um token JWT de desenvolvimento para facilitar testes locais.
 * Sem necessidade de instalar jsonwebtoken globalmente ou usar scripts externos.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly jwtService: JwtService) {}

  /**
   * GET /auth/dev-token
   * Retorna um JWT de teste válido por 24h.
   * Bloqueado em produção.
   *
   * Exemplo de uso:
   *   TOKEN=$(curl -s http://localhost:3001/auth/dev-token | jq -r '.token')
   *   curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/lancamentos
   */
  @Get('dev-token')
  getDevToken() {
    if (process.env.NODE_ENV === 'production') {
      throw new HttpException(
        'Endpoint não disponível em produção',
        HttpStatus.FORBIDDEN,
      );
    }

    const token = this.jwtService.sign(
      { sub: 'dev-user-1', name: 'Dev User', role: 'comerciante' },
      { expiresIn: '24h' },
    );

    return {
      token,
      usage: 'Authorization: Bearer <token>',
      expiresIn: '24h',
      note: 'Apenas para desenvolvimento local. Bloqueado em produção.',
    };
  }
}
