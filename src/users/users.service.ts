import { Injectable, ConflictException, UnauthorizedException, NotFoundException, BadRequestException, ForbiddenException, Logger, InternalServerErrorException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { User, UserDocument, UserRole } from './schemas/user.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { KafkaService } from '../kafka/kafka.service';
import { KAFKA_TOPICS } from '../common/constants/kafka-topics';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  private mailTransporter: nodemailer.Transporter | null = null;
  private mailFrom: string | null = null;

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
    @Optional() private kafkaService?: KafkaService,
  ) {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = Number(this.configService.get<string>('SMTP_PORT') || '587');
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    this.mailFrom = this.configService.get<string>('SMTP_FROM') || smtpUser || null;

    this.logger.debug(`SMTP config host=${!!smtpHost} port=${smtpPort} user=${!!smtpUser}`);

    if (smtpHost && smtpUser && smtpPass && this.mailFrom) {
      this.mailTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    } else {
      this.logger.warn('SMTP credentials missing; email OTP functionality disabled');
    }
  }

  // ==================== PUBLIC METHODS ====================

  async register(registerDto: RegisterDto): Promise<UserResponseDto> {
    this.logger.log(`Registering new user: ${registerDto.email}`);
    
    // Check if user exists
    const existingUser = await this.userModel.findOne({ email: registerDto.email }).exec();
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Create user (always USER role by default)
    const user = new this.userModel({
      name: registerDto.name,
      email: registerDto.email,
      password: hashedPassword,
      role: UserRole.USER,
      profile: {
        phone: registerDto.phone,
      },
      metadata: {
        registeredIp: '0.0.0.0',
      },
      refreshTokens: [],
    });

    const savedUser = await user.save();

    // Emit Kafka event
    if (this.kafkaService) {
      await this.kafkaService.emit(KAFKA_TOPICS.USER_REGISTERED, {
        userId: savedUser._id,
        email: savedUser.email,
        role: savedUser.role,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.logger.warn('Kafka disabled - USER_REGISTERED event skipped');
    }

    return this.toResponseDto(savedUser);
  }

  async login(loginDto: LoginDto, ip?: string): Promise<{ accessToken: string; refreshToken: string; user: UserResponseDto }> {
    this.logger.log(`Login attempt: ${loginDto.email}`);
    
    const user = await this.userModel.findOne({ email: loginDto.email }).exec();
    if (!user) {
      this.logger.warn(`Login failed - user not found: ${loginDto.email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      this.logger.warn(`Login failed - invalid password: ${loginDto.email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate tokens
    const payload = { sub: user._id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: this.configService.get('JWT_EXPIRATION') || '15m',
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRATION') || '7d',
    });

    // Save refresh token
    await this.userModel.updateOne(
      { _id: user._id },
      {
        $push: { refreshTokens: refreshToken },
        $set: { 'metadata.lastLoginAt': new Date(), 'metadata.lastLoginIp': ip },
      }
    ).exec();

    // Emit Kafka event
    if (this.kafkaService) {
      await this.kafkaService.emit(KAFKA_TOPICS.USER_LOGGED_IN, {
        userId: user._id,
        email: user.email,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.logger.warn('Kafka disabled - USER_LOGGED_IN event skipped');
    }

    this.logger.log(`Login successful: ${user.email}`);

    return {
      accessToken,
      refreshToken,
      user: this.toResponseDto(user),
    };
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      const user = await this.userModel.findById(payload.sub).exec();
      if (!user || !user.refreshTokens.includes(refreshToken)) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const newPayload = { sub: user._id, email: user.email, role: user.role };
      const accessToken = this.jwtService.sign(newPayload, {
        secret: this.configService.get('JWT_SECRET'),
        expiresIn: this.configService.get('JWT_EXPIRATION') || '15m',
      });

      return { accessToken };
    } catch (error) {
      this.logger.error(`Refresh token failed: ${error.message}`);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    this.logger.log(`Logout user: ${userId}`);
    
    await this.userModel.updateOne(
      { _id: userId },
      { $pull: { refreshTokens: refreshToken } }
    ).exec();

    if (this.kafkaService) {
      await this.kafkaService.emit(KAFKA_TOPICS.USER_LOGGED_OUT, {
        userId,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.logger.warn('Kafka disabled - USER_LOGGED_OUT event skipped');
    }
  }

  // ==================== USER METHODS ====================

  async getProfile(userId: string): Promise<UserResponseDto> {
    this.logger.log(`Getting profile for user: ${userId}`);
    
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toResponseDto(user);
  }

  async updateProfile(userId: string, updateData: any): Promise<UserResponseDto> {
    this.logger.log(`Updating profile for user: ${userId}`);
    this.logger.debug(`Update data received: ${JSON.stringify(updateData)}`);
    
    // Check if email is being changed and if it's already taken
    if (updateData.email) {
      this.logger.log(`Checking if email ${updateData.email} is already in use`);
      const existingUser = await this.userModel.findOne({ 
        email: updateData.email,
        _id: { $ne: userId }
      }).exec();
      
      if (existingUser) {
        throw new ConflictException('Email is already in use');
      }
    }
    
    // Only allow updating specific fields
    const allowedUpdates: any = {};
    
    if (updateData.name) allowedUpdates.name = updateData.name;
    if (updateData.email) allowedUpdates.email = updateData.email;
    if (updateData.profile?.phone) allowedUpdates['profile.phone'] = updateData.profile.phone;
    if (updateData.profile?.address) allowedUpdates['profile.address'] = updateData.profile.address;
    if (updateData.profile?.city) allowedUpdates['profile.city'] = updateData.profile.city;
    if (updateData.profile?.state) allowedUpdates['profile.state'] = updateData.profile.state;
    if (updateData.profile?.pincode) allowedUpdates['profile.pincode'] = updateData.profile.pincode;
    if (updateData.profile?.avatar) allowedUpdates['profile.avatar'] = updateData.profile.avatar;
    if (updateData.profile?.bio) allowedUpdates['profile.bio'] = updateData.profile.bio;

    this.logger.debug(`Allowed updates: ${JSON.stringify(allowedUpdates)}`);

    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: { ...allowedUpdates, updatedAt: new Date() } },
      { new: true }
    ).exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toResponseDto(user);
  }

  async findById(userId: string): Promise<UserResponseDto> {
    try {
      this.logger.log(`Find by ID: ${userId}`);
      
      // Check if userId is a valid ObjectId format
      if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
        throw new BadRequestException('Invalid user ID format');
      }
      
      const user = await this.userModel.findById(userId).exec();
      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }
      return this.toResponseDto(user);
    } catch (error) {
      if (error.name === 'CastError') {
        throw new BadRequestException('Invalid user ID format');
      }
      this.logger.error(`Error in findById: ${error.message}`);
      throw error;
    }
  }

  // 🔴 FIXED: getUserById method with proper logging
  async getUserById(userId: string): Promise<UserResponseDto> {
    try {
      this.logger.log(`Getting user by ID: ${userId}`);
      
      // Check if userId is a valid ObjectId format
      if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
        this.logger.warn(`Invalid user ID format: ${userId}`);
        throw new BadRequestException('Invalid user ID format');
      }
      
      // Find user in database
      const user = await this.userModel.findById(userId).exec();
      
      // Check if user exists
      if (!user) {
        this.logger.warn(`User not found: ${userId}`);
        throw new NotFoundException(`User with ID ${userId} not found`);
      }
      
      this.logger.log(`User found: ${user.email}`);
      return this.toResponseDto(user);
      
    } catch (error) {
      // Handle different types of errors
      if (error.name === 'CastError') {
        this.logger.error(`Cast error for ID ${userId}`);
        throw new BadRequestException('Invalid user ID format');
      }
      
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error getting user ${userId}: ${error.message}`);
      throw new InternalServerErrorException('Failed to get user');
    }
  }

  async findByEmail(email: string): Promise<UserResponseDto | null> {
    const user = await this.userModel.findOne({ email }).exec();
    return user ? this.toResponseDto(user) : null;
  }

  async getAllUsers(page: number = 1, limit: number = 10): Promise<{ users: UserResponseDto[]; total: number }> {
    this.logger.log(`Getting all users - Page: ${page}, Limit: ${limit}`);
    
    const skip = (page - 1) * limit;
    
    const [users, total] = await Promise.all([
      this.userModel
        .find()
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .exec(),
      this.userModel.countDocuments()
    ]);

    return {
      users: users.map(user => this.toResponseDto(user)),
      total,
    };
  }

  // ==================== ADMIN METHODS ====================

  async adminGetAllUsers(page: number = 1, limit: number = 10): Promise<{ users: UserResponseDto[]; total: number }> {
    this.logger.log(`Admin getting all users - Page: ${page}, Limit: ${limit}`);
    return this.getAllUsers(page, limit);
  }

  async adminGetUserById(userId: string): Promise<UserResponseDto> {
    this.logger.log(`Admin getting user by ID: ${userId}`);
    return this.findById(userId);
  }

  async adminUpdateUser(userId: string, updateData: any): Promise<UserResponseDto> {
    this.logger.log(`Admin updating user: ${userId}`);
    
    // Admin can update any field
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: { ...updateData, updatedAt: new Date() } },
      { new: true }
    ).exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toResponseDto(user);
  }

  async adminDeleteUser(userId: string): Promise<void> {
    this.logger.log(`Admin deleting user: ${userId}`);
    
    const result = await this.userModel.deleteOne({ _id: userId }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException('User not found');
    }

    if (this.kafkaService) {
      await this.kafkaService.emit(KAFKA_TOPICS.USER_DELETED, {
        userId,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.logger.warn('Kafka disabled - USER_DELETED event skipped');
    }
  }

  async adminGetStats(): Promise<any> {
    this.logger.log('Admin getting stats');
    
    const totalUsers = await this.userModel.countDocuments();
    const totalAdmins = await this.userModel.countDocuments({ role: UserRole.ADMIN });
    const totalRegularUsers = await this.userModel.countDocuments({ role: UserRole.USER });
    const recentUsers = await this.userModel
      .find()
      .sort({ createdAt: -1 })
      .limit(5)
      .exec();

    return {
      totalUsers,
      totalAdmins,
      totalRegularUsers,
      recentUsers: recentUsers.map(u => this.toResponseDto(u)),
    };
  }

  // ==================== PASSWORD CHANGE with OTP ====================

  private generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendPasswordChangeOTP(userId: string): Promise<any> {
    this.logger.log(`Sending password change OTP email for user: ${userId}`);
    
    try {
      // Validate userId - handle both string and ObjectId
      if (!userId) {
        throw new BadRequestException('User ID is required');
      }
      
      const userIdStr = userId.toString();
      this.logger.debug(`Processing userId: ${userIdStr}`);

      // Get full user document with all fields
      const user = await this.userModel.findById(userIdStr).exec();
      if (!user) {
        this.logger.warn(`User not found with ID: ${userIdStr}`);
        throw new NotFoundException('User not found');
      }
      
      this.logger.debug(`User found: ${user.email}`);
      this.logger.debug(`User email: ${user.email || 'NOT SET'}`);
      
      if (!user.email) {
        throw new BadRequestException('Registered email not found for this account.');
      }

      const otp = this.generateOTP();
      const expiryTime = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      // Save OTP and reset verification status
      await this.userModel.findByIdAndUpdate(
        userIdStr,
        {
          $set: {
            passwordChangeOTP: otp,
            passwordChangeOTPExpiry: expiryTime,
            passwordChangeOTPVerified: false,
            updatedAt: new Date(),
          }
        },
        { new: true }
      ).exec();

      if (!this.mailTransporter || !this.mailFrom) {
        throw new InternalServerErrorException('Email service not configured. Please contact support.');
      }

      await this.mailTransporter.sendMail({
        from: this.mailFrom,
        to: user.email,
        subject: 'GOLO Password Change OTP',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
            <h2 style="color: #157A4F; margin-bottom: 12px;">GOLO Password Verification</h2>
            <p style="margin-bottom: 16px; color: #333;">Use this OTP to verify your password change request:</p>
            <div style="font-size: 28px; letter-spacing: 6px; font-weight: 700; color: #111; margin: 18px 0;">${otp}</div>
            <p style="color: #555; margin-bottom: 8px;">This OTP is valid for 5 minutes.</p>
            <p style="color: #777; font-size: 13px;">If you did not request this, please ignore this email.</p>
          </div>
        `,
      });

      this.logger.log(`OTP email sent successfully to ${user.email}`);

      return {
        message: 'OTP sent to your registered email address',
        expiresIn: 300, // 5 minutes in seconds
      };
    } catch (error) {
      this.logger.error(`Error in sendPasswordChangeOTP: ${error.message}`);
      this.logger.error(`Stack: ${error.stack}`);
      throw error;
    }
  }

  async verifyPasswordChangeOTP(userId: string, otp: string): Promise<any> {
    this.logger.log(`Verifying password change OTP for user: ${userId}`);
    
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.passwordChangeOTP) {
      throw new BadRequestException('No OTP found. Please request a new one.');
    }

    if (new Date() > user.passwordChangeOTPExpiry) {
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }

    if (user.passwordChangeOTP !== otp) {
      throw new UnauthorizedException('Invalid OTP');
    }

    // Mark OTP as verified
    await this.userModel.findByIdAndUpdate(
      userId,
      {
        $set: {
          passwordChangeOTPVerified: true,
          updatedAt: new Date(),
        }
      }
    ).exec();

    return { message: 'OTP verified successfully' };
  }

  async changePasswordWithOTP(userId: string, otp: string, newPassword: string): Promise<UserResponseDto> {
    this.logger.log(`Changing password with OTP for user: ${userId}`);
    
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.passwordChangeOTPVerified) {
      throw new BadRequestException('OTP not verified. Please verify OTP first.');
    }

    if (user.passwordChangeOTP !== otp) {
      throw new UnauthorizedException('OTP mismatch');
    }

    if (new Date() > user.passwordChangeOTPExpiry) {
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }

    const isCurrentPassword = await bcrypt.compare(newPassword, user.password);
    if (isCurrentPassword) {
      throw new BadRequestException('New password cannot be the same as your current password.');
    }

    const passwordHistory = Array.isArray(user.passwordHistory) ? user.passwordHistory : [];
    for (const oldPasswordHash of passwordHistory) {
      const isReusedPassword = await bcrypt.compare(newPassword, oldPasswordHash);
      if (isReusedPassword) {
        throw new BadRequestException('Previously used passwords are not allowed. Please choose a different password.');
      }
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear OTP
    const updatedUser = await this.userModel.findByIdAndUpdate(
      userId,
      {
        $set: {
          password: hashedPassword,
          passwordChangeOTP: null,
          passwordChangeOTPExpiry: null,
          passwordChangeOTPVerified: false,
          updatedAt: new Date(),
        },
        $push: {
          passwordHistory: {
            $each: [user.password],
            $slice: -5,
          },
        },
      },
      { new: true }
    ).exec();

    this.logger.log(`Password changed successfully for user: ${userId}`);

    return this.toResponseDto(updatedUser);
  }

  // ==================== HELPER METHODS ====================

  private toResponseDto(user: UserDocument): UserResponseDto {
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      isEmailVerified: user.isEmailVerified || false,
      profile: user.profile || {},
      createdAt: user.createdAt,
    };
  }
}