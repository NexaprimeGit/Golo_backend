import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
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
    @InjectModel(Ad.name) private readonly adModel: Model<AdDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,

    // ✅ Kafka OPTIONAL
    @Optional() private readonly kafkaService?: KafkaService,
  ) {}

  /* ============================================================
     CREATE AD
  ============================================================ */

  async createAd(createAdDto: CreateAdDto): Promise<Ad> {
    this.logger.log(`Creating new ad for user: ${createAdDto.userId}`);

    const userExists = await this.verifyUser(createAdDto.userId);
    if (!userExists) {
      throw new BadRequestException(
        `User with ID ${createAdDto.userId} not found.`,
      );
    }

    let categorySpecificData: any = {};
    const payload: any = createAdDto as any;

    switch (createAdDto.category) {
      case 'Vehicle':
        categorySpecificData = payload.vehicleData || {};
        break;
      case 'Property':
        categorySpecificData = payload.propertyData || {};
        break;
      case 'Service':
        categorySpecificData = payload.serviceData || {};
        break;
      case 'Mobiles':
        categorySpecificData = payload.mobileData || {};
        break;
      case 'Electronics':
      case 'Electronics & Home appliances':
        categorySpecificData = payload.electronicsData || {};
        break;
      case 'Furniture':
        categorySpecificData = payload.furnitureData || {};
        break;
      case 'Education':
        categorySpecificData = payload.educationData || {};
        break;
      case 'Pets':
        categorySpecificData = payload.petsData || {};
        break;
      case 'Matrimonial':
        categorySpecificData = payload.matrimonialData || {};
        break;
      case 'Business':
        categorySpecificData = payload.businessData || {};
        break;
      case 'Travel':
        categorySpecificData = payload.travelData || {};
        break;
      case 'Astrology':
        categorySpecificData = payload.astrologyData || {};
        break;
      case 'Employment':
        categorySpecificData = payload.employmentData || {};
        break;
      case 'Lost & Found':
        categorySpecificData = payload.lostFoundData || payload.lostAndFoundData || {};
        break;
      case 'Personal':
        categorySpecificData = payload.personalData || {};
        break;
      case 'Public Notice':
        categorySpecificData = payload.publicNoticeData || {};
        break;
      case 'Greetings & Tributes':
        categorySpecificData = payload.greetingsData || payload.otherData || {};
        break;
      case 'Other':
        categorySpecificData = payload.otherData || {};
        break;
    }

    if (!categorySpecificData || Object.keys(categorySpecificData).length === 0) {
      categorySpecificData = payload.categorySpecificData || {};
    }

    this.validateCategoryData(createAdDto.category, categorySpecificData);

    const expiryDate =
      createAdDto.expiryDate ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const adData: any = {
      ...createAdDto,
      categorySpecificData,
      adId: uuidv4(),
      status: 'active',
      views: 0,
      expiryDate,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const savedAd = await new this.adModel(adData).save();

    this.logger.log(`Ad created successfully: ${savedAd.adId}`);

    await this.emitAdCreated(savedAd, uuidv4());

    return savedAd;
  }

  /* ============================================================
     ADMIN
  ============================================================ */

  async adminDeleteAd(adId: string): Promise<void> {
    await this.adModel.findOneAndDelete({ adId }).exec();
  }

  async adminGetAllAds(): Promise<Ad[]> {
    return this.adModel.find().sort({ createdAt: -1 }).exec();
  }

  /* ============================================================
     USER VERIFY
  ============================================================ */

  async verifyUser(userId: any): Promise<boolean> {
    try {
      if (!userId) return false;

      const userIdStr = String(userId);

      if (!userIdStr.match(/^[0-9a-fA-F]{24}$/)) return false;

      const user = await this.userModel
        .findById(userIdStr)
        .lean()
        .exec();

      return !!user;
    } catch (error: any) {
      this.logger.error(`User verify error: ${error.message}`);
      return false;
    }
  }

  /* ============================================================
     GETTERS
  ============================================================ */

  async getAdById(adId: string): Promise<Ad> {
    let ad = await this.adModel.findOne({ adId }).exec();

    if (!ad && /^[0-9a-fA-F]{24}$/.test(adId)) {
      ad = await this.adModel.findById(adId).exec();
    }

    if (!ad) throw new NotFoundException(`Ad ${adId} not found`);
    return ad;
  }

  async getAdsByCategory(
    category: string,
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  ): Promise<{ ads: Ad[]; total: number }> {
    const skip = (page - 1) * limit;

    const sort: { [key: string]: SortOrder } = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const [ads, total] = await Promise.all([
      this.adModel
        .find({ category, status: 'active' })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.adModel.countDocuments({
        category,
        status: 'active',
      }),
    ]);

    return { ads, total };
  }

  /* ============================================================
     SEARCH / LISTING HELPERS
  ============================================================ */

  async searchAds(
    query: string,
    filters: any = {},
    page = 1,
    limit = 10,
  ): Promise<{ ads: Ad[]; total: number }> {
    const skip = (page - 1) * limit;

    const mongoQuery: any = { status: 'active' };

    if (filters?.category) mongoQuery.category = filters.category;
    if (filters?.location) mongoQuery.location = filters.location;
    if (typeof filters?.minPrice === 'number') mongoQuery.price = { ...(mongoQuery.price || {}), $gte: filters.minPrice };
    if (typeof filters?.maxPrice === 'number') mongoQuery.price = { ...(mongoQuery.price || {}), $lte: filters.maxPrice };

    if (query && query.trim().length > 0) {
      // Prefer text index when available
      mongoQuery.$text = { $search: query };
    }

    const [ads, total] = await Promise.all([
      this.adModel
        .find(mongoQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.adModel.countDocuments(mongoQuery),
    ]);

    return { ads, total };
  }

  async getNearbyAds(
    lat: number,
    lng: number,
    maxDistance = 10000,
    category?: string,
    page = 1,
    limit = 10,
  ): Promise<{ ads: Ad[]; total: number }> {
    const skip = (page - 1) * limit;

    const geoQuery: any = { status: 'active' };
    if (category) geoQuery.category = category;

    // Try geo query if coordinates are stored
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      geoQuery.locationCoordinates = {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: maxDistance,
        },
      } as any;
    }

    const [ads, total] = await Promise.all([
      this.adModel
        .find(geoQuery)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.adModel.countDocuments(geoQuery),
    ]);

    return { ads, total };
  }

  async getAdsByUser(userId: string, page = 1, limit = 10): Promise<{ ads: Ad[]; total: number }> {
    const skip = (page - 1) * limit;
    const query = { userId, status: 'active' };

    const [ads, total] = await Promise.all([
      this.adModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.adModel.countDocuments(query),
    ]);

    return { ads, total };
  }

  async getFeaturedDeals(limit = 10): Promise<Ad[]> {
    const now = new Date();
    return this.adModel
      .find({ isPromoted: true, promotedUntil: { $gt: now }, status: 'active' })
      .sort({ promotedUntil: -1 })
      .limit(limit)
      .exec();
  }

  async getTrendingSearches(limit = 10): Promise<string[]> {
    // Return top ad titles as trending searches
    const docs = await this.adModel
      .find({ status: 'active' })
      .sort({ views: -1 })
      .limit(limit)
      .select('title')
      .lean()
      .exec();

    // Extract just the titles and remove duplicates
    const titles = [...new Set(docs.map(doc => doc.title).filter(Boolean))];
    return titles.slice(0, limit);
  }

  async getRecommendedDeals(userId: string | undefined, limit = 10): Promise<Ad[]> {
    // Simple recommendation: if user provided, try same city from user's profile
    if (userId) {
      try {
        const user = await this.userModel.findById(String(userId)).lean().exec();
        const city = user?.profile?.city;
        if (city) {
          return this.adModel
            .find({ city, status: 'active' })
            .sort({ createdAt: -1 })
            .limit(limit)
            .exec();
        }
      } catch (e) {
        this.logger.warn(`Recommendation lookup failed: ${e.message}`);
      }
    }

    // Fallback: most recent active ads
    return this.adModel.find({ status: 'active' }).sort({ createdAt: -1 }).limit(limit).exec();
  }

  async getPopularPlaces(limit = 10): Promise<string[]> {
    // Aggregate top cities by ad count and return just city names
    const pipeline = [
      { $match: { status: 'active', city: { $exists: true, $ne: null } } },
      { $group: { _id: '$city', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
      { $project: { _id: 1 } },
    ];

    const results = await (this.adModel as any).aggregate(pipeline).exec();
    return results.map(r => r._id).filter(Boolean);
  }

  async incrementViewCount(adId: string): Promise<void> {
    try {
      let updated = await this.adModel.findOneAndUpdate(
        { adId },
        { $inc: { views: 1 }, $set: { updatedAt: new Date() } },
      ).exec();

      if (!updated && /^[0-9a-fA-F]{24}$/.test(adId)) {
        await this.adModel.findByIdAndUpdate(
          adId,
          { $inc: { views: 1 }, $set: { updatedAt: new Date() } },
        ).exec();
      }
    } catch (error: any) {
      this.logger.error(`Failed to increment view count for ${adId}: ${error.message}`);
    }
  }

  /* ============================================================
     UPDATE / DELETE
  ============================================================ */

  async updateAd(
    adId: string,
    userId: string,
    updateData: UpdateAdDto,
  ): Promise<Ad> {
    const ad = await this.getAdById(adId);

    if (ad.userId !== userId) {
      throw new ForbiddenException(
        'You can only update your own ads',
      );
    }

    const updatedAd = await this.adModel
      .findOneAndUpdate(
        { adId },
        { $set: { ...updateData, updatedAt: new Date() } },
        { new: true },
      )
      .exec();

    if (!updatedAd)
      throw new NotFoundException(`Ad ${adId} not found`);

    await this.emitAdUpdated(updatedAd, uuidv4());

    return updatedAd;
  }

  async deleteAd(adId: string, userId: string): Promise<void> {
    const ad = await this.getAdById(adId);

    if (ad.userId !== userId) {
      throw new ForbiddenException(
        'You can only delete your own ads',
      );
    }

    await this.adModel
      .findOneAndUpdate(
        { adId },
        { status: 'deleted', updatedAt: new Date() },
      )
      .exec();

    await this.emitAdDeleted(adId, userId, uuidv4());
  }

  /* ============================================================
     ✅ SAFE KAFKA EVENTS (PUBLIC NOW)
  ============================================================ */

  async emitAdCreated(ad: Ad, correlationId: string): Promise<void> {
    if (!this.kafkaService) {
      this.logger.warn('Kafka disabled - AD_CREATED skipped');
      return;
    }

    await this.kafkaService.emit(
      KAFKA_TOPICS.AD_CREATED,
      {
        adId: ad.adId,
        userId: ad.userId,
        title: ad.title,
        category: ad.category,
        price: ad.price,
        timestamp: new Date().toISOString(),
      },
      correlationId,
    );
  }

  async emitAdUpdated(ad: Ad, correlationId: string): Promise<void> {
    if (!this.kafkaService) return;

    await this.kafkaService.emit(
      KAFKA_TOPICS.AD_UPDATED,
      {
        adId: ad.adId,
        userId: ad.userId,
        timestamp: new Date().toISOString(),
      },
      correlationId,
    );
  }

  async emitAdDeleted(
    adId: string,
    userId: string,
    correlationId: string,
  ): Promise<void> {
    if (!this.kafkaService) return;

    await this.kafkaService.emit(
      KAFKA_TOPICS.AD_DELETED,
      {
        adId,
        userId,
        timestamp: new Date().toISOString(),
      },
      correlationId,
    );
  }

  /* ============================================================
     VALIDATION
  ============================================================ */

  private validateCategoryData(category: string, data: any): void {
    if (!data) return;
  }
}