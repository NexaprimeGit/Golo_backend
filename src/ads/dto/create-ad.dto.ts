import { 
  IsString, 
  IsNotEmpty, 
  IsEnum, 
  IsNumber, 
  IsOptional, 
  IsArray, 
  IsBoolean,
  ValidateNested,
  Min,
  IsLatitude,
  IsLongitude,
  IsUrl,
  IsObject
} from 'class-validator';
import { Type } from 'class-transformer';
import { VehicleDto } from './category-dtos/vehicle.dto';
import { PropertyDto } from './category-dtos/property.dto';
import { ServiceDto } from './category-dtos/service.dto';
import { MobileDto } from './category-dtos/mobiles.dto';
import { ElectronicsDto } from './category-dtos/electronics.dto';
import { FurnitureDto } from './category-dtos/furniture.dto';
import { EducationDto } from './category-dtos/education.dto';
import { PetsDto } from './category-dtos/pets.dto';
import { MatrimonialDto } from './category-dtos/matrimonial.dto';
import { BusinessDto } from './category-dtos/business.dto';
import { TravelDto } from './category-dtos/travel.dto';
import { AstrologyDto } from './category-dtos/astrology.dto';
import { EmploymentDto } from './category-dtos/employment.dto';
import { LostFoundDto } from './category-dtos/lost-found.dto';
import { PersonalDto } from './category-dtos/personal.dto';
import { ContactInfoDto } from './contact-info.dto';
import { MetadataDto } from './metadata.dto';
import { Prop } from '@nestjs/mongoose';

export class CreateAdDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsEnum([
    'Education', 'Matrimonial', 'Vehicle', 'Business', 'Travel',
    'Astrology', 'Property', 'Public Notice', 'Lost & Found',
    'Service', 'Personal', 'Employment', 'Pets', 'Mobiles',
    'Electronics & Home appliances', 'Furniture', 'Greetings & Tributes', 'Other'
  ])
  category: string;

  @IsString()
  @IsNotEmpty()
  subCategory: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  userId: string;

  @IsEnum(['Customer', 'Admin'])  // ← Should match your schema
  userType: string;

  @IsArray()
  @IsUrl({}, { each: true })
  images: string[];

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  videos?: string[];

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price: number;

  @IsOptional()
  @IsBoolean()
  negotiable?: boolean;

  @IsString()
  @IsNotEmpty()
  location: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  pincode?: string;

  @IsOptional()
  @IsLatitude()
  @Type(() => Number)
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  @Type(() => Number)
  longitude?: number;

  @ValidateNested()
  @Type(() => ContactInfoDto)
  contactInfo: ContactInfoDto;

   // ==================== NEW FIELDS FROM FRONTEND ====================
  
  @IsOptional()
  @IsString()
  language?: string;  // From frontend language selector

  @IsOptional()
  @IsString()
  primaryContact?: string;  // From frontend primary contact field

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cities?: string[];  // Multiple locations from frontend

  @IsOptional()
  @IsArray()
  @Type(() => Date)
  selectedDates?: Date[];  // Selected dates from scheduling

  @IsOptional()
  @IsNumber()
  templateId?: number;  // Template ID for UI (1, 2, or 3)


  // For Property category
  @IsOptional()
  @ValidateNested()
  @Type(() => PropertyDto)
  propertyData?: PropertyDto;

  // For Vehicle category
  @IsOptional()
  @ValidateNested()
  @Type(() => VehicleDto)
  vehicleData?: VehicleDto;

  // For Service category
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceDto)
  serviceData?: ServiceDto;

  // For Mobile category
  @IsOptional()
  @ValidateNested()
  @Type(() => MobileDto)
  mobileData?: MobileDto;

  // For Electronics category
  @IsOptional()
  @ValidateNested()
  @Type(() => ElectronicsDto)
  electronicsData?: ElectronicsDto;

  // For Furniture category
  @IsOptional()
  @ValidateNested()
  @Type(() => FurnitureDto)
  furnitureData?: FurnitureDto;

  // For Education category
  @IsOptional()
  @ValidateNested()
  @Type(() => EducationDto)
  educationData?: EducationDto;

  // For Pets category
  @IsOptional()
  @ValidateNested()
  @Type(() => PetsDto)
  petsData?: PetsDto;

  // For Matrimonial category
  @IsOptional()
  @ValidateNested()
  @Type(() => MatrimonialDto)
  matrimonialData?: MatrimonialDto;

  // For Business category
  @IsOptional()
  @ValidateNested()
  @Type(() => BusinessDto)
  businessData?: BusinessDto;

  // For Travel category
  @IsOptional()
  @ValidateNested()
  @Type(() => TravelDto)
  travelData?: TravelDto;

  // For Astrology category
  @IsOptional()
  @ValidateNested()
  @Type(() => AstrologyDto)
  astrologyData?: AstrologyDto;

  // For Employment category
  @IsOptional()
  @ValidateNested()
  @Type(() => EmploymentDto)
  employmentData?: EmploymentDto;

  // For Lost & Found category
  @IsOptional()
  @ValidateNested()
  @Type(() => LostFoundDto)
  lostFoundData?: LostFoundDto;

  // For Personal category
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalDto)
  personalData?: PersonalDto;

  // For Public Notice category
  @IsOptional()
  @IsObject()
  publicNoticeData?: Record<string, any>;

  // For Greetings & Tributes category
  @IsOptional()
  @IsObject()
  greetingsData?: Record<string, any>;

  // For Other category (and fallback category-specific payload)
  @IsOptional()
  @IsObject()
  otherData?: Record<string, any>;

  // Generic fallback container for category-specific payload
  @IsOptional()
  @IsObject()
  categorySpecificData?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @Type(() => Date)
  expiryDate?: Date;

  @IsOptional()
  @IsBoolean()
  isPromoted?: boolean;

  @IsOptional()
  @Type(() => Date)
  promotedUntil?: Date;

  @IsOptional()
  @IsString()
  promotionPackage?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetadataDto)
  metadata?: MetadataDto;
}