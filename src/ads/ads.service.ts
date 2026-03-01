import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, SortOrder } from 'mongoose';
import { Ad, AdDocument } from './schemas/category-schemas/ad.schema';
import { CreateAdDto } from './dto/create-ad.dto';
import { UpdateAdDto } from './dto/update-ad.dto';
import { KafkaService } from '../kafka/kafka.service';
import { KAFKA_TOPICS } from '../common/constants/kafka-topics';
import { v4 as uuidv4 } from 'uuid';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);


  constructor(
    @InjectModel(Ad.name) private adModel: Model<AdDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private kafkaService: KafkaService,
  ) { }

  async createAd(createAdDto: CreateAdDto): Promise<Ad> {
    this.logger.log(`Creating new ad for user: ${createAdDto.userId}`);

    // =============================================
    // NEW: Verify user exists before creating ad
    // =============================================
    const userExists = await this.verifyUser(createAdDto.userId);
    this.logger.log(`User verification result: ${userExists}`);
    if (!userExists) {
      throw new BadRequestException(`User with ID ${createAdDto.userId} not found. Please register or login first.`);
    }
    this.logger.log(`User verified successfully: ${createAdDto.userId}`);
    // =============================================

    // Determine which category data to use
    let categorySpecificData = {};

    switch (createAdDto.category) {
      case 'Vehicle':
        categorySpecificData = createAdDto.vehicleData || {};
        break;
      case 'Property':
        categorySpecificData = createAdDto.propertyData || {};
        break;
      case 'Service':
        categorySpecificData = createAdDto.serviceData || {};
        break;
      case 'Mobiles':
        categorySpecificData = createAdDto.mobileData || {};
        break;
      case 'Electronics & Home appliances':
        categorySpecificData = createAdDto.electronicsData || {};
        break;
      case 'Furniture':
        categorySpecificData = createAdDto.furnitureData || {};
        break;
      case 'Education':
        categorySpecificData = createAdDto.educationData || {};
        break;
      case 'Pets':
        categorySpecificData = createAdDto.petsData || {};
        break;
      case 'Matrimonial':
        categorySpecificData = createAdDto.matrimonialData || {};
        break;
      case 'Business':
        categorySpecificData = createAdDto.businessData || {};
        break;
      case 'Travel':
        categorySpecificData = createAdDto.travelData || {};
        break;
      case 'Astrology':
        categorySpecificData = createAdDto.astrologyData || {};
        break;
      case 'Employment':
        categorySpecificData = createAdDto.employmentData || {};
        break;
      case 'Lost & Found':
        categorySpecificData = createAdDto.lostFoundData || {};
        break;
      case 'Personal':
        categorySpecificData = createAdDto.personalData || {};
        break;
      default:
        categorySpecificData = {};
    }

    // Validate category-specific data
    this.validateCategoryData(createAdDto.category, categorySpecificData);

    // Calculate expiry date (default: 30 days from now)
    const expiryDate = createAdDto.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Check if coordinates are provided and valid
    const hasValidCoordinates =
      createAdDto.latitude !== undefined &&
      createAdDto.longitude !== undefined &&
      !isNaN(Number(createAdDto.latitude)) &&
      !isNaN(Number(createAdDto.longitude)) &&
      Number(createAdDto.latitude) >= -90 &&
      Number(createAdDto.latitude) <= 90 &&
      Number(createAdDto.longitude) >= -180 &&
      Number(createAdDto.longitude) <= 180;

    // Sanitize language value — MongoDB text index only accepts ISO 639-1 lowercase codes
    // e.g. "english", "french", NOT "English (India)" or locale-variants
    const mongoLanguageMap: { [key: string]: string } = {
      'english': 'english', 'english (india)': 'english', 'hindi': 'none',
      'french': 'french', 'german': 'german', 'spanish': 'spanish',
      'portuguese': 'portuguese', 'italian': 'italian', 'dutch': 'dutch',
      'russian': 'russian', 'chinese': 'none', 'japanese': 'none',
      'arabic': 'none', 'turkish': 'turkish', 'danish': 'danish',
      'finnish': 'finnish', 'norwegian': 'norwegian', 'swedish': 'swedish',
    };
    const rawLanguage = (createAdDto.language || 'english').toLowerCase();
    const safeLanguage = mongoLanguageMap[rawLanguage] || 'english';

    // Prepare base ad data WITHOUT locationCoordinates
    const adData: any = {
      title: createAdDto.title,
      description: createAdDto.description,
      category: createAdDto.category,
      subCategory: createAdDto.subCategory,
      userId: createAdDto.userId,
      userType: createAdDto.userType,
      images: createAdDto.images,
      videos: createAdDto.videos || [],
      price: createAdDto.price,
      negotiable: createAdDto.negotiable || false,
      location: createAdDto.location,
      city: createAdDto.city,
      state: createAdDto.state,
      pincode: createAdDto.pincode,
      language: safeLanguage,
      contactInfo: {
        name: createAdDto.contactInfo.name,
        phone: createAdDto.contactInfo.phone,
        email: createAdDto.contactInfo.email,
        whatsapp: createAdDto.contactInfo.whatsapp,
        preferredContactMethod: createAdDto.contactInfo.preferredContactMethod || 'phone'
      },
      categorySpecificData,
      tags: createAdDto.tags || [],
      adId: uuidv4(),
      status: 'active',
      views: 0,
      expiryDate,
      isPromoted: createAdDto.isPromoted || false,
      promotedUntil: createAdDto.promotedUntil,
      promotionPackage: createAdDto.promotionPackage,
      metadata: {
        ip: createAdDto.metadata?.ip || '0.0.0.0',
        userAgent: createAdDto.metadata?.userAgent || 'system',
        platform: createAdDto.metadata?.platform || 'api',
        deviceId: createAdDto.metadata?.deviceId
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // ONLY add locationCoordinates if we have valid coordinates
    if (hasValidCoordinates) {
      adData.locationCoordinates = {
        type: 'Point',
        coordinates: [
          Number(createAdDto.longitude),
          Number(createAdDto.latitude)
        ]
      };
      this.logger.debug(`Added location coordinates: ${JSON.stringify(adData.locationCoordinates)}`);
    } else {
      // Explicitly NOT adding locationCoordinates field
      this.logger.debug('No valid coordinates provided - skipping locationCoordinates field');
    }

    // Log what we're saving (for debugging)
    this.logger.debug(`Saving ad with fields: ${Object.keys(adData).join(', ')}`);
    this.logger.debug(`Has locationCoordinates: ${hasValidCoordinates}`);

    // Create ad in database
    const createdAd = new this.adModel(adData);
    const savedAd = await createdAd.save();

    this.logger.log(`Ad created successfully: ${savedAd.adId}`);

    return savedAd;
  }

  async adminDeleteAd(adId: string): Promise<void> {
    // Admin can hard delete or soft delete
    await this.adModel.findOneAndDelete({ adId }).exec();
    // OR soft delete:
    // await this.adModel.findOneAndUpdate({ adId }, { status: 'deleted' });
  }

  async adminGetAllAds(): Promise<Ad[]> {
    return this.adModel.find().sort({ createdAt: -1 }).exec();
  }

  async verifyUser(userId: any): Promise<boolean> {
    try {
      this.logger.log(`🔍 VERIFYING USER: ${userId}`);

      // STEP 1: Convert to string safely
      let userIdStr: string;

      if (!userId) {
        this.logger.error('❌ UserId is null or undefined');
        return false;
      }

      if (typeof userId === 'string') {
        userIdStr = userId;
      } else if (userId.toString) {
        userIdStr = userId.toString();
      } else {
        userIdStr = String(userId);
      }

      this.logger.log(`🔍 UserId as string: ${userIdStr}`);

      // STEP 2: Validate format
      if (!userIdStr.match(/^[0-9a-fA-F]{24}$/)) {
        this.logger.warn(`❌ Invalid user ID format: ${userIdStr}`);
        return false;
      }

      // STEP 3: Find user
      const user = await this.userModel.findById(userIdStr).lean().exec();

      if (user) {
        this.logger.log(`✅ User FOUND: ${user.email}`);
        return true;
      } else {
        this.logger.warn(`❌ User NOT FOUND with ID: ${userIdStr}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`❌ Error verifying user: ${error.message}`);
      return false;
    }
  }
  async getAdById(adId: string): Promise<Ad> {
    const ad = await this.adModel.findOne({ adId }).exec();

    if (!ad) {
      throw new NotFoundException(`Ad with ID ${adId} not found`);
    }

    return ad;
  }

  async getAdsByCategory(
    category: string,
    page: number = 1,
    limit: number = 10,
    sortBy: string = 'createdAt',
    sortOrder: string = 'desc'
  ): Promise<{ ads: Ad[]; total: number }> {
    const skip = (page - 1) * limit;

    // Create sort object properly for MongoDB
    const sort: { [key: string]: SortOrder } = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const [ads, total] = await Promise.all([
      this.adModel
        .find({ category, status: 'active' })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.adModel.countDocuments({ category, status: 'active' })
    ]);

    return { ads, total };
  }

  async getAdsByUser(
    userId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ ads: Ad[]; total: number }> {
    const skip = (page - 1) * limit;

    const [ads, total] = await Promise.all([
      this.adModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.adModel.countDocuments({ userId })
    ]);

    return { ads, total };
  }

  async searchAds(
    query: string,
    filters: {
      category?: string;
      location?: string;
      minPrice?: number;
      maxPrice?: number;
    },
    page: number = 1,
    limit: number = 10
  ): Promise<{ ads: Ad[]; total: number }> {
    const skip = (page - 1) * limit;

    // Build search query
    const searchQuery: any = { status: 'active' };

    if (query) {
      searchQuery.$text = { $search: query };
    }

    if (filters.category) {
      searchQuery.category = filters.category;
    }

    if (filters.location) {
      searchQuery.location = { $regex: filters.location, $options: 'i' };
    }

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      searchQuery.price = {};
      if (filters.minPrice !== undefined) {
        searchQuery.price.$gte = filters.minPrice;
      }
      if (filters.maxPrice !== undefined) {
        searchQuery.price.$lte = filters.maxPrice;
      }
    }

    // Determine sort order
    let sort: any = {};
    if (query) {
      sort = { score: { $meta: 'textScore' } };
    } else {
      sort = { createdAt: -1 };
    }

    const [ads, total] = await Promise.all([
      this.adModel
        .find(searchQuery)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.adModel.countDocuments(searchQuery)
    ]);

    return { ads, total };
  }

  async getNearbyAds(
    latitude: number,
    longitude: number,
    maxDistance: number = 10000,
    category?: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ ads: Ad[]; total: number }> {
    const skip = (page - 1) * limit;

    const query: any = {
      status: 'active',
      locationCoordinates: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          $maxDistance: maxDistance
        }
      }
    };

    if (category) {
      query.category = category;
    }

    const [ads, total] = await Promise.all([
      this.adModel
        .find(query)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.adModel.countDocuments(query)
    ]);

    return { ads, total };
  }

  async updateAd(adId: string, userId: string, updateData: UpdateAdDto, isAdmin: boolean = false): Promise<Ad> {
    const ad = await this.getAdById(adId);

    // Check if user owns the ad
    if (ad.userId !== userId) {
      throw new ForbiddenException('You can only update your own ads');
    }
    if (!isAdmin && ad.userId !== userId) {
      throw new ForbiddenException('You can only update your own ads');
    }

    // Prepare update object
    const updateObj: any = { ...updateData, updatedAt: new Date() };

    // Handle category-specific data if category is being updated
    if (updateData.category) {
      let categorySpecificData = {};

      switch (updateData.category) {
        case 'Vehicle':
          categorySpecificData = updateData.vehicleData || {};
          break;
        case 'Property':
          categorySpecificData = updateData.propertyData || {};
          break;
        case 'Service':
          categorySpecificData = updateData.serviceData || {};
          break;
        case 'Mobiles':
          categorySpecificData = updateData.mobileData || {};
          break;
        case 'Electronics & Home appliances':
          categorySpecificData = updateData.electronicsData || {};
          break;
        case 'Furniture':
          categorySpecificData = updateData.furnitureData || {};
          break;
        case 'Education':
          categorySpecificData = updateData.educationData || {};
          break;
        case 'Pets':
          categorySpecificData = updateData.petsData || {};
          break;
        case 'Matrimonial':
          categorySpecificData = updateData.matrimonialData || {};
          break;
        case 'Business':
          categorySpecificData = updateData.businessData || {};
          break;
        case 'Travel':
          categorySpecificData = updateData.travelData || {};
          break;
        case 'Astrology':
          categorySpecificData = updateData.astrologyData || {};
          break;
        case 'Employment':
          categorySpecificData = updateData.employmentData || {};
          break;
        case 'Lost & Found':
          categorySpecificData = updateData.lostFoundData || {};
          break;
        case 'Personal':
          categorySpecificData = updateData.personalData || {};
          break;
      }

      // Validate category-specific data
      this.validateCategoryData(updateData.category, categorySpecificData);

      // Add to update object
      updateObj.categorySpecificData = categorySpecificData;
    }

    // Handle location coordinates update
    if (updateData.latitude !== undefined && updateData.longitude !== undefined) {
      const hasValidCoordinates =
        !isNaN(Number(updateData.latitude)) &&
        !isNaN(Number(updateData.longitude)) &&
        Number(updateData.latitude) >= -90 &&
        Number(updateData.latitude) <= 90 &&
        Number(updateData.longitude) >= -180 &&
        Number(updateData.longitude) <= 180;

      if (hasValidCoordinates) {
        updateObj.locationCoordinates = {
          type: 'Point',
          coordinates: [
            Number(updateData.longitude),
            Number(updateData.latitude)
          ]
        };
      } else {
        // If coordinates are provided but invalid, remove the field
        updateObj.locationCoordinates = null;
      }
    }

    // Remove the category-specific data fields from update object
    delete updateObj.vehicleData;
    delete updateObj.propertyData;
    delete updateObj.serviceData;
    delete updateObj.mobileData;
    delete updateObj.electronicsData;
    delete updateObj.furnitureData;
    delete updateObj.educationData;
    delete updateObj.petsData;
    delete updateObj.matrimonialData;
    delete updateObj.businessData;
    delete updateObj.travelData;
    delete updateObj.astrologyData;
    delete updateObj.employmentData;
    delete updateObj.lostFoundData;
    delete updateObj.personalData;

    const updatedAd = await this.adModel
      .findOneAndUpdate(
        { adId },
        { $set: updateObj },
        { new: true }
      )
      .exec();

    if (!updatedAd) {
      throw new NotFoundException(`Ad with ID ${adId} not found`);
    }

    return updatedAd;
  }

  async deleteAd(adId: string, userId: string): Promise<void> {
    const ad = await this.getAdById(adId);

    // Check if user owns the ad
    if (ad.userId !== userId) {
      throw new ForbiddenException('You can only delete your own ads');
    }

    // Soft delete by updating status
    await this.adModel
      .findOneAndUpdate(
        { adId },
        { $set: { status: 'deleted', updatedAt: new Date() } }
      )
      .exec();
  }

  async incrementViewCount(adId: string): Promise<void> {
    await this.adModel
      .findOneAndUpdate(
        { adId },
        { $inc: { views: 1 } }
      )
      .exec();
  }

  async emitAdCreated(ad: Ad, correlationId: string): Promise<void> {
    await this.kafkaService.emit(KAFKA_TOPICS.AD_CREATED, {
      adId: ad.adId,
      userId: ad.userId,
      category: ad.category,
      title: ad.title,
      price: ad.price,
      location: ad.location,
      timestamp: new Date().toISOString()
    }, correlationId);
  }

  async emitAdUpdated(ad: Ad, correlationId: string): Promise<void> {
    await this.kafkaService.emit(KAFKA_TOPICS.AD_UPDATED, {
      adId: ad.adId,
      userId: ad.userId,
      category: ad.category,
      title: ad.title,
      price: ad.price,
      timestamp: new Date().toISOString()
    }, correlationId);
  }

  async emitAdDeleted(adId: string, userId: string, correlationId: string): Promise<void> {
    await this.kafkaService.emit(KAFKA_TOPICS.AD_DELETED, {
      adId,
      userId,
      timestamp: new Date().toISOString()
    }, correlationId);
  }

  async getFeaturedDeals(limit: number = 10): Promise<Ad[]> {
    this.logger.log(`Fetching ${limit} featured deals`);

    return this.adModel.find({
      status: 'active',
      isPromoted: true
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async getTrendingSearches(limit: number = 10): Promise<any[]> {
    this.logger.log(`Fetching ${limit} trending searches`);

    // This could be based on search logs or most viewed categories
    // For now, return popular categories
    const categories = [
      { name: 'Mobiles', count: 1500 },
      { name: 'Vehicles', count: 1200 },
      { name: 'Properties', count: 900 },
      { name: 'Electronics', count: 800 },
      { name: 'Furniture', count: 600 },
      { name: 'Services', count: 500 },
    ];

    return categories.slice(0, limit);
  }

  async getRecommendedDeals(userId: string | null, limit: number = 10): Promise<Ad[]> {
    this.logger.log(`Fetching ${limit} recommended deals for user: ${userId || 'guest'}`);

    // Simple recommendation: latest active ads
    return this.adModel.find({ status: 'active' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async getPopularPlaces(limit: number = 10): Promise<any[]> {
    this.logger.log(`Fetching ${limit} popular places`);

    // This could be based on most tagged locations in ads
    // For now, return sample places
    const places = [
      { name: 'Mahalakshmi Temple', location: 'Mumbai', image: 'url', type: 'Temple' },
      { name: 'Rankala Lake', location: 'Kolhapur', image: 'url', type: 'Lake' },
      { name: 'New Palace', location: 'Kolhapur', image: 'url', type: 'Palace' },
      { name: 'Panhala Fort', location: 'Kolhapur', image: 'url', type: 'Fort' },
    ];

    return places.slice(0, limit);
  }

  private validateCategoryData(category: string, data: any): void {
    // Skip validation if no data provided
    if (!data) return;

    // Define required fields for each category
    const requiredFields: { [key: string]: string[] } = {
      'Property': ['type', 'propertyType', 'area', 'areaUnit', 'price'],
      'Service': ['serviceType', 'experience'],
      'Mobiles': ['brand', 'model', 'storage', 'ram', 'color', 'condition', 'price'],
      'Electronics & Home appliances': ['productType', 'brand', 'model', 'price'],
      'Furniture': ['furnitureType', 'material', 'price'],
      'Education': ['institutionType', 'institutionName'],
      'Pets': ['petType'],
      'Matrimonial': ['profileFor', 'name', 'age', 'gender'],
      'Business': ['type', 'businessName'],
      'Travel': ['type', 'destination'],
      'Astrology': ['serviceType'],
      'Employment': ['jobType', 'jobTitle', 'companyName'],
      'Lost & Found': ['type', 'itemName', 'contactNumber']
    };

    let missingFields: string[] = [];

    if (category === 'Vehicle') {
      if (!data.type) {
        missingFields.push('type');
      } else if (data.type === 'Sell') {
        const sellRequires = ['brand', 'model', 'year', 'fuelType', 'transmission', 'kilometersDriven', 'price'];
        missingFields = sellRequires.filter(field => !data[field]);
      } else if (data.type === 'Rent') {
        const rentRequires = ['vehicleType', 'brandModel', 'rentAmount', 'securityDeposit', 'includesDriver', 'minRentalDuration'];
        missingFields = rentRequires.filter(field => !data[field]);
      }
    } else if (requiredFields[category]) {
      missingFields = requiredFields[category].filter(field => !data[field]);
    }

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Missing required fields for category ${category}: ${missingFields.join(', ')}`
      );
    }
  }
}