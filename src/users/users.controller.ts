import { 
  Controller, Post, Body, Get, Put, Delete, Param, 
  UseGuards, Query, Ip, InternalServerErrorException, NotFoundException 
} from '@nestjs/common';
import { UsersService } from './users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SocialAuthDto } from './dto/social-auth.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from './schemas/user.schema';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ==================== PUBLIC ROUTES ====================

  @Post('register')
  async register(@Body() registerDto: RegisterDto, @Ip() ip: string) {
    const user = await this.usersService.register(registerDto);
    return {
      success: true,
      message: 'User registered successfully',
      data: user,
    };
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto, @Ip() ip: string) {
    const result = await this.usersService.login(loginDto, ip);
    return {
      success: true,
      message: 'Login successful',
      data: result,
    };
  }

  @Post('social-auth')
  async socialAuth(@Body() socialAuthDto: SocialAuthDto, @Ip() ip: string) {
    const result = await this.usersService.socialAuth(socialAuthDto, ip);
    return {
      success: true,
      message: 'Social login successful',
      data: result,
    };
  }

  @Post('refresh')
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    const result = await this.usersService.refreshToken(refreshTokenDto.refreshToken);
    return {
      success: true,
      data: result,
    };
  }

  // ==================== USER ROUTES (Any logged-in user) ====================
  // 🔴 IMPORTANT: Specific routes must come BEFORE dynamic :id routes

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: any, @Body() refreshTokenDto: RefreshTokenDto) {
    await this.usersService.logout(user.id, refreshTokenDto.refreshToken);
    return {
      success: true,
      message: 'Logout successful',
    };
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    const profile = await this.usersService.getProfile(user.id);
    return {
      success: true,
      data: profile,
    };
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@CurrentUser() user: any, @Body() updateData: any) {
    const profile = await this.usersService.updateProfile(user.id, updateData);
    return {
      success: true,
      message: 'Profile updated successfully',
      data: profile,
    };
  }

  // ==================== PASSWORD CHANGE with OTP ====================

  @Post('send-password-otp')
  @UseGuards(JwtAuthGuard)
  async sendPasswordChangeOTP(@CurrentUser() user: any) {
    const result = await this.usersService.sendPasswordChangeOTP(user.id);
    return {
      success: true,
      message: 'OTP sent to your registered email address',
      data: result,
    };
  }

  @Post('verify-password-otp')
  @UseGuards(JwtAuthGuard)
  async verifyPasswordChangeOTP(@CurrentUser() user: any, @Body() body: any) {
    const result = await this.usersService.verifyPasswordChangeOTP(user.id, body.otp);
    return {
      success: true,
      message: 'OTP verified successfully',
      data: result,
    };
  }

  @Post('change-password-otp')
  @UseGuards(JwtAuthGuard)
  async changePasswordWithOTP(@CurrentUser() user: any, @Body() body: any) {
    const result = await this.usersService.changePasswordWithOTP(user.id, body.otp, body.newPassword);
    return {
      success: true,
      message: 'Password changed successfully',
      data: result,
    };
  }

  // ==================== WISHLIST ROUTES ====================

  @Get('wishlist')
  @UseGuards(JwtAuthGuard)
  async getWishlistAds(@CurrentUser() user: any) {
    const data = await this.usersService.getWishlistAds(user.id);
    return { success: true, data };
  }

  @Get('wishlist/ids')
  @UseGuards(JwtAuthGuard)
  async getWishlistIds(@CurrentUser() user: any) {
    const data = await this.usersService.getWishlistIds(user.id);
    return { success: true, data };
  }

  @Post('wishlist/:adId')
  @UseGuards(JwtAuthGuard)
  async toggleWishlist(@CurrentUser() user: any, @Param('adId') adId: string) {
    const result = await this.usersService.toggleWishlist(user.id, adId);
    return {
      success: true,
      message: result.added ? 'Added to wishlist' : 'Removed from wishlist',
      data: result,
    };
  }

  @Get('all')
  @UseGuards(JwtAuthGuard)
  async getAllUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
  ) {
    const users = await this.usersService.getAllUsers(parseInt(page), parseInt(limit));
    return {
      success: true,
      data: users,
    };
  }

  // 🔴 FIXED: Debug route - must come BEFORE the dynamic :id route
  @Get('debug/check/:id')
@UseGuards(JwtAuthGuard)
async debugCheckUser(@Param('id') id: string) {
  try {
    console.log(`Debug: Checking user with ID: ${id}`); // Add console.log for debugging
    const user = await this.usersService.getUserById(id);
    return {
      success: true,
      message: 'User found in UsersService',
      data: user,
    };
  } catch (error) {
    console.error(`Debug error: ${error.message}`); // Add error logging
    return {
      success: false,
      message: 'User not found in UsersService',
      error: error.message,
    };
  }
}

  // 🔴 FIXED: Dynamic route - must come AFTER all specific routes
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getUserById(@Param('id') id: string) {
    try {
      const user = await this.usersService.getUserById(id);
      return {
        success: true,
        data: user,
      };
    } catch (error) {
      if (error.name === 'NotFoundException') {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  // ==================== ADMIN ONLY ROUTES ====================

  @Get('admin/users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminGetAllUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
  ) {
    const users = await this.usersService.adminGetAllUsers(parseInt(page), parseInt(limit));
    return {
      success: true,
      data: users,
    };
  }

  @Get('admin/users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminGetUserById(@Param('id') id: string) {
    const user = await this.usersService.adminGetUserById(id);
    return {
      success: true,
      data: user,
    };
  }

  @Put('admin/users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminUpdateUser(@Param('id') id: string, @Body() updateData: any) {
    const user = await this.usersService.adminUpdateUser(id, updateData);
    return {
      success: true,
      message: 'User updated successfully by admin',
      data: user,
    };
  }

  @Delete('admin/users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminDeleteUser(@Param('id') id: string) {
    await this.usersService.adminDeleteUser(id);
    return {
      success: true,
      message: 'User deleted successfully by admin',
    };
  }

  @Get('admin/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminGetStats() {
    const stats = await this.usersService.adminGetStats();
    return {
      success: true,
      data: stats,
    };
  }

  @Get('debug/exists/:id')
async debugUserExists(@Param('id') id: string) {
  try {
    const user = await this.usersService.findById(id);
    return {
      success: true,
      message: 'User found',
      data: user
    };
  } catch (error) {
    return {
      success: false,
      message: 'User not found',
      error: error.message,
      id: id
    };
  }
}
}