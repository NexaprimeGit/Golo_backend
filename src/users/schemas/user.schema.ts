import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  USER = 'customer',
  ADMIN = 'admin'
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ type: [String], default: [] })
  passwordHistory: string[];

  @Prop({ required: true, enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Prop({ default: false })
  isEmailVerified: boolean;

  @Prop({ type: [String], default: [] })
  refreshTokens: string[];

  @Prop({
    type: {
      phone: String,
      address: String,
      city: String,
      state: String,
      pincode: String,
      avatar: String,
      bio: String
    }
  })
  profile: {
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    avatar?: string;
    bio?: string;
  };

  @Prop({ type: Object })
  metadata: {
    lastLoginAt?: Date;
    lastLoginIp?: string;
    registeredIp?: string;
  };

  @Prop()
  passwordChangeOTP?: string;

  @Prop()
  passwordChangeOTPExpiry?: Date;

  @Prop({ default: false })
  passwordChangeOTPVerified?: boolean;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Create indexes
UserSchema.index({ email: 1 });
UserSchema.index({ role: 1 });