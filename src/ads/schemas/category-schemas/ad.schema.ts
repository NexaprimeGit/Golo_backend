import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Vehicle, VehicleSchema } from './vehicle.schema';
import { Property, PropertySchema } from './property.schema';
import { Service, ServiceSchema } from './service.schema';
import { Mobile, MobileSchema } from './mobiles.schema';
import { Electronics, ElectronicsSchema } from './electronics.schema';
import { Furniture, FurnitureSchema } from './furniture.schema';
import { Education, EducationSchema } from './education.schema';
import { Pets, PetsSchema } from './pets.schema';
import { Matrimonial, MatrimonialSchema } from './matrimonial.schema';
import { Business, BusinessSchema } from './business.schema';
import { Travel, TravelSchema } from './travel.schema';
import { Astrology, AstrologySchema } from './astrology.schema';
import { Employment, EmploymentSchema } from './employment.schema';
import { LostFound, LostFoundSchema } from './lost-found.schema';

export type AdDocument = Ad & Document;

@Schema({ timestamps: true, collection: 'ads' })
export class Ad {
  @Prop({ required: true })
  adId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({
    required: true, enum: [
      'Education', 'Matrimonial', 'Vehicle', 'Business', 'Travel',
      'Astrology', 'Property', 'Public Notice', 'Lost & Found',
      'Service', 'Personal', 'Employment', 'Pets', 'Mobiles',
      'Electronics & Home appliances', 'Furniture', 'Greetings & Tributes', 'Other'
    ]
  })
  category: string;

  @Prop({ required: true })
  subCategory: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, enum: ['Customer', 'Admin'] }) // ← Match your new roles
  userType: string;

  @Prop({ type: [String], required: true })
  images: string[];

  @Prop({ type: [String] })
  videos: string[];

  @Prop({ required: true })
  price: number;

  @Prop({ default: false })
  negotiable: boolean;

  @Prop({ required: true })
  location: string;

  @Prop()
  city: string;

  @Prop()
  state: string;

  @Prop()
  pincode: string;

  @Prop({
    type: {
      type: String,
      enum: ['Point']

    },
    coordinates: {
      type: [Number],
      required: false
    }
  })
  locationCoordinates: {
    type: string;
    coordinates: [number, number];
  };

  @Prop({
    type: {
      name: String,
      phone: String,
      email: String,
      whatsapp: String,
      preferredContactMethod: String
    }
  })
  contactInfo: {
    name: string;
    phone: string;
    email?: string;
    whatsapp?: string;
    preferredContactMethod: string;
  };

  @Prop({ type: MongooseSchema.Types.Mixed })
  categorySpecificData:
    | Vehicle
    | Property
    | Service
    | Mobile
    | Electronics
    | Furniture
    | Education
    | Pets
    | Matrimonial
    | Business
    | Travel
    | Astrology
    | Employment
    | LostFound
    | any;



  // ==================== NEW FIELDS FROM FRONTEND ====================

  @Prop({ type: [String], default: [] })
  cities: string[];  // Multiple locations

  @Prop({ default: 'english' })
  language: string;  // MongoDB text index compatible (ISO 639-1 lowercase)

  @Prop()
  primaryContact: string;  // Primary contact from form

  @Prop({ type: [Date], default: [] })
  selectedDates: Date[];  // Selected dates for scheduling

  @Prop({ default: 1 })
  templateId: number;  // Template ID (1, 2, or 3)

  @Prop({ default: 'active', enum: ['active', 'expired', 'deleted', 'pending', 'rejected'] })
  status: string;

  @Prop({ default: 0 })
  views: number;

  @Prop({ type: [String] })
  tags: string[];

  @Prop()
  expiryDate: Date;

  @Prop({ default: false })
  isPromoted: boolean;

  @Prop()
  promotedUntil: Date;

  @Prop()
  promotionPackage: string;

  @Prop({
    type: {
      ip: String,
      userAgent: String,
      platform: String,
      deviceId: String
    }
  })
  metadata: {
    ip: string;
    userAgent: string;
    platform: string;
    deviceId?: string;
  };

  @Prop()
  approvedBy: string;

  @Prop()
  approvedAt: Date;

  @Prop()
  rejectionReason: string;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

// Create indexes for better query performance


export const AdSchema = SchemaFactory.createForClass(Ad);

AdSchema.index({ locationCoordinates: '2dsphere' });
AdSchema.index({ title: 'text', description: 'text', tags: 'text' });
AdSchema.index({ userId: 1, createdAt: -1 });
AdSchema.index({ category: 1, status: 1, createdAt: -1 });
AdSchema.index({ location: 1, category: 1 });
AdSchema.index({ price: 1 });
AdSchema.index({ city: 1, category: 1 });
AdSchema.index({ expiryDate: 1 }, { expireAfterSeconds: 0 });
AdSchema.index({ isPromoted: 1, promotedUntil: 1 });
