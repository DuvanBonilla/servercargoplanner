import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  UnauthorizedException,
  Get,
  ValidationPipe,
  ForbiddenException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { LoginService } from './login.service';
import { CreateLoginDto } from './dto/create-login.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Public } from 'src/auth/decorators/public.decorator';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('login')
@Controller('login')
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({ summary: 'Iniciar sesión' })
  @ApiResponse({ status: 200, description: 'Login exitoso' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  async login(@Body() createLoginDto: CreateLoginDto) {
    const response = await this.loginService.login(createLoginDto);
    if (response === 'Invalid credentials') {
      throw new UnauthorizedException(response);
    }
    return response;
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cerrar sesión' })
  @ApiResponse({ status: 200, description: 'Logout exitoso' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  async logout(@Request() req) {
    const authHeader = req.headers.authorization;
    const token = authHeader.split(' ')[1];

    return this.loginService.logout(token);
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Refrescar token con nuevos valores de site/subsite',
  })
  @ApiResponse({ status: 200, description: 'Token refrescado exitosamente' })
  @ApiResponse({ status: 401, description: 'Token inválido' })
  @ApiResponse({ status: 403, description: 'Acceso denegado al site/subsite' })
  @ApiResponse({ status: 400, description: 'Datos de site/subsite inválidos' })
  @ApiResponse({ status: 404, description: 'Site o subsite no encontrados' })
  async refreshToken(
    @Request() req,
    @Body(new ValidationPipe({ 
      transform: true,
      transformOptions: {
        enableImplicitConversion: false
      }
    }))
    refreshTokenDto: RefreshTokenDto,
  ) {
    const authHeader = req.headers.authorization;
    const token = authHeader.split(' ')[1];

    // Verificar qué propiedades fueron enviadas en el body original
    const originalBody = req.body;
    const explicitParams = {
      siteProvided: 'id_site' in originalBody,
      subsiteProvided: 'id_subsite' in originalBody,
    };

    const response = await this.loginService.refreshToken(
      token,
      refreshTokenDto.id_site,
      refreshTokenDto.id_subsite,
      explicitParams,
    );

     if ('statusCode' in response) {
    if (response.statusCode === HttpStatus.UNAUTHORIZED) {
      throw new UnauthorizedException(response.message);
    } else if (response.statusCode === HttpStatus.FORBIDDEN) {
      throw new ForbiddenException(response.message);
    } else if (response.statusCode === HttpStatus.NOT_FOUND) {
      throw new NotFoundException(response.message);
    } else {
      throw new HttpException(response.message, response.statusCode);
    }
  }

    return response;
  }

  @Get('validation')
  @Public()
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Obtener información de la sesión' })
  async validationToken(@Request() req) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        console.warn('⚠️ /login/validation: No authorization header');
        throw new UnauthorizedException('No token provided');
      }
      const token = authHeader.split(' ')[1];
      if (!token) {
        console.warn('⚠️ /login/validation: Invalid token format');
        throw new UnauthorizedException('Invalid token format');
      }
      const response = await this.loginService.validationToken(token);
      if (response === 'Invalid token') {
        console.warn('⚠️ /login/validation: Invalid token');
        throw new UnauthorizedException(response);
      }
      return response;
    } catch (error) {
      console.error('❌ Error in /login/validation:', error.message);
      throw error;
    }
  }
}
