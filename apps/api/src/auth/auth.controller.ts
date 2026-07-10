import { Body, Controller, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

function context(req: Request) {
  return { ipAddress: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate and receive access + refresh tokens' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, context(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair (rotating)' })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, context(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(
    @Body() dto: RefreshDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.authService.logout(dto.refreshToken, user.id, context(req));
  }

  @Patch('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change my own password (requires the current password); revokes all other sessions' })
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.changePassword(user.id, dto);
  }
}
