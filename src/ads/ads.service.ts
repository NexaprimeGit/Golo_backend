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
import { Report, ReportDocument, ReportReason, ReportStatus } from './schemas/report.schema';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);
  private emailTransporter: any;
  private emailEnabled: boolean;

  constructor(
    @InjectModel(Ad.name) private readonly adModel: Model<AdDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Report.name) private readonly reportModel: Model<ReportDocument>,
    private configService: ConfigService,

    // ✅ Kafka OPTIONAL
    @Optional() private readonly kafkaService?: KafkaService,
  ) {
    // Initialize email transporter
    this.emailEnabled = !!this.configService.get('EMAIL_USER');
    
    if (this.emailEnabled) {
      this.emailTransporter = nodemailer.createTransport({
        host: this.configService.get('EMAIL_HOST'),
        port: this.configService.get('EMAIL_PORT'),
        secure: false,
        auth: {
          user: this.configService.get('EMAIL_USER'),
          pass: this.configService.get('EMAIL_PASSWORD'),
        },
      });

      this.emailTransporter.verify((error: any, success: any) => {
        if (error) {
          this.logger.error(`Email service verification failed: ${error.message}`);
          this.emailEnabled = false;
        } else {
          this.logger.log('✅ Email service ready and connected');
        }
      });
    } else {
      this.logger.warn('⚠️ Email service not configured - emails will be logged only');
    }
  }

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
     ANALYTICS
  ============================================================ */

  /**
   * Track a view for authenticated users only — views always equals viewHistory.length.
   * visitorId should be userId from JWT token (no anonymous tracking).
   */
  async trackViewWithVisitor(adId: string, userId: string): Promise<void> {
    try {
      if (!userId) {
        this.logger.warn(`trackViewWithVisitor: No userId provided for ad ${adId}`);
        return;
      }

      // Resolve to UUID adId if a MongoDB _id was passed
      let resolvedAdId = adId;
      if (/^[0-9a-fA-F]{24}$/.test(adId)) {
        const found = await this.adModel.findById(adId).select('adId').lean().exec();
        if (found?.adId) resolvedAdId = found.adId;
      }

      // Add userId to viewHistory and sync views = viewHistory.length atomically
      const updated = await this.adModel.findOneAndUpdate(
        { adId: resolvedAdId },
        [
          {
            $set: {
              viewHistory: {
                $cond: {
                  if: { $in: [userId, { $ifNull: ['$viewHistory', []] }] },
                  then: '$viewHistory',
                  else: { $concatArrays: [{ $ifNull: ['$viewHistory', []] }, [userId]] },
                },
              },
              updatedAt: new Date(),
            },
          },
          {
            $set: {
              views: { $size: '$viewHistory' },
            },
          },
        ],
        { new: true },
      ).exec();

      if (!updated) {
        this.logger.warn(`trackViewWithVisitor: ad not found for adId=${resolvedAdId}`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to track view for user ${userId} on ad ${adId}: ${error.message}`);
    }
  }

  /**
   * Increment contact click count when a user clicks Chat or Call on an ad.
   */
  async trackContactClick(adId: string): Promise<void> {
    try {
      let updated = await this.adModel.findOneAndUpdate(
        { adId },
        { $inc: { contactClicks: 1 }, $set: { updatedAt: new Date() } },
      ).exec();

      if (!updated && /^[0-9a-fA-F]{24}$/.test(adId)) {
        await this.adModel.findByIdAndUpdate(
          adId,
          { $inc: { contactClicks: 1 }, $set: { updatedAt: new Date() } },
        ).exec();
      }
    } catch (error: any) {
      this.logger.error(`Failed to track contact click for ${adId}: ${error.message}`);
    }
  }

  /**
   * Get analytics summary for all ads posted by a specific user.
   */
  async getMyAnalytics(userId: string): Promise<{
    summary: {
      totalAds: number;
      activeAds: number;
      totalViews: number;
      uniqueVisitors: number;
      totalContactClicks: number;
      promotedAds: number;
      totalWishlistSaves: number;
    };
    ads: any[];
  }> {
    const owner = await this.userModel
      .findById(userId)
      .select('name email role profile metadata createdAt')
      .lean()
      .exec();

    const ads = await this.adModel
      .find({ userId })
      .select('adId title description category subCategory status views viewHistory contactClicks isPromoted promotedUntil createdAt updatedAt price images videos city state pincode location locationCoordinates contactInfo primaryContact cities language selectedDates templateId tags expiryDate metadata categorySpecificData reportCount isUnderReview autoDisabled disabledAt disabledReason negotiable')
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const adIds = ads.map(a => a.adId).filter(Boolean);

    // Count how many users have each ad in their wishlist
    const wishlistCounts: Record<string, number> = {};
    if (adIds.length > 0) {
      const wishlistAgg = await this.userModel.aggregate([
        { $match: { wishlist: { $in: adIds } } },
        { $unwind: '$wishlist' },
        { $match: { wishlist: { $in: adIds } } },
        { $group: { _id: '$wishlist', count: { $sum: 1 } } },
      ]).exec();
      for (const item of wishlistAgg) {
        wishlistCounts[item._id] = item.count;
      }
    }

    const totalAds = ads.length;
    const activeAds = ads.filter(a => a.status === 'active').length;
    const promotedAds = ads.filter(a => a.isPromoted && a.promotedUntil && new Date(a.promotedUntil) > new Date()).length;
    // views = unique visitors only (viewHistory.length is the source of truth)
    const totalViews = ads.reduce((sum, a) => sum + (a.viewHistory?.length || 0), 0);
    const uniqueVisitors = totalViews; // same — views IS unique visitors
    const totalContactClicks = ads.reduce((sum, a) => sum + (a.contactClicks || 0), 0);
    const totalWishlistSaves = Object.values(wishlistCounts).reduce((sum, c) => sum + c, 0);

    const adsWithAnalytics = ads.map(ad => ({
      adId: ad.adId,
      title: ad.title,
      description: ad.description,
      category: ad.category,
      subCategory: ad.subCategory,
      status: ad.status,
      price: ad.price,
      negotiable: ad.negotiable || false,
      location: ad.location,
      city: ad.city,
      state: ad.state,
      pincode: ad.pincode,
      cities: ad.cities || [],
      language: ad.language || 'english',
      image: ad.images?.[0] || null,
      imageCount: ad.images?.length || 0,
      videoCount: ad.videos?.length || 0,
      templateId: ad.templateId || 1,
      views: ad.viewHistory?.length || 0,          // unique visitors = views
      uniqueVisitors: ad.viewHistory?.length || 0, // kept for compatibility
      viewerIds: ad.viewHistory || [],
      contactClicks: ad.contactClicks || 0,
      wishlistCount: wishlistCounts[ad.adId] || 0,
      clickThroughRate: (ad.viewHistory?.length || 0) > 0 ? Number((((ad.contactClicks || 0) / (ad.viewHistory?.length || 0)) * 100).toFixed(2)) : 0,
      wishlistRate: (ad.viewHistory?.length || 0) > 0 ? Number((((wishlistCounts[ad.adId] || 0) / (ad.viewHistory?.length || 0)) * 100).toFixed(2)) : 0,
      isPromoted: ad.isPromoted || false,
      promotedUntil: ad.promotedUntil || null,
      expiryDate: ad.expiryDate || null,
      reportCount: ad.reportCount || 0,
      isUnderReview: ad.isUnderReview || false,
      autoDisabled: ad.autoDisabled || false,
      disabledAt: ad.disabledAt || null,
      disabledReason: ad.disabledReason || null,
      tags: ad.tags || [],
      selectedDates: ad.selectedDates || [],
      primaryContact: ad.primaryContact || null,
      contactInfo: ad.contactInfo || null,
      metadata: ad.metadata || null,
      locationCoordinates: ad.locationCoordinates || null,
      categorySpecificData: ad.categorySpecificData || null,
      ownerName: owner?.name || null,
      ownerEmail: owner?.email || null,
      ownerRole: owner?.role || null,
      ownerProfile: owner?.profile || null,
      ownerMetadata: owner?.metadata || null,
      ownerCreatedAt: owner?.createdAt || null,
      createdAt: ad.createdAt,
      updatedAt: ad.updatedAt,
    }));

    return {
      summary: { totalAds, activeAds, totalViews, uniqueVisitors, totalContactClicks, promotedAds, totalWishlistSaves },
      ads: adsWithAnalytics,
    };
  }

  /**
   * Count how many users have a specific ad in their wishlist.
   * The adId stored in User.wishlist is always the UUID adId field.
   * We resolve it first in case a MongoDB _id is passed.
   */
  async getAdWishlistCount(adId: string): Promise<number> {
    try {
      // Resolve to UUID adId — needed when URL contains MongoDB _id
      let resolvedAdId = adId;
      const ad = await this.adModel
        .findOne({ adId })
        .select('adId')
        .lean()
        .exec();

      if (!ad && /^[0-9a-fA-F]{24}$/.test(adId)) {
        // Passed a MongoDB _id — look up the real UUID
        const adById = await this.adModel
          .findById(adId)
          .select('adId')
          .lean()
          .exec();
        if (adById?.adId) resolvedAdId = adById.adId;
      } else if (ad?.adId) {
        resolvedAdId = ad.adId;
      }

      const count = await this.userModel
        .countDocuments({ wishlist: resolvedAdId })
        .exec();
      return count;
    } catch (error: any) {
      this.logger.error(`Failed to get wishlist count for ${adId}: ${error.message}`);
      return 0;
    }
  }

  /* ============================================================
     UPDATE / DELETE
  ============================================================ */

  /**
   * One-time migration: set views = viewHistory.length for every ad.
   * Fixes all existing ads that have inflated view counts from non-unique tracking.
   */
  async resyncViewCounts(): Promise<{ updated: number }> {
    const result = await (this.adModel as any).updateMany(
      {},
      [
        { $set: { views: { $size: { $ifNull: ['$viewHistory', []] } } } },
      ],
    ).exec();
    return { updated: result.modifiedCount ?? result.nModified ?? 0 };
  }

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
     REPORTING & MODERATION
  ============================================================ */

  /**
   * Submit a report for an ad - auto-disables at 10 reports
   */
  async submitReport(
    adId: string,
    userId: string,
    reason: ReportReason,
    description?: string,
  ): Promise<{ success: boolean; message: string; reportId: string }> {
    try {
      this.logger.log(`User ${userId} reporting ad ${adId} for reason: ${reason}`);

      // Resolve adId - could be UUID or MongoDB _id
      let resolvedAdId = adId;
      if (/^[0-9a-fA-F]{24}$/.test(adId)) {
        // If it looks like MongoDB _id, get the UUID adId
        const found = await this.adModel.findById(adId).select('adId').lean().exec();
        if (found?.adId) {
          resolvedAdId = found.adId;
        }
      }

      // Check if ad exists
      const ad = await this.adModel.findOne({ adId: resolvedAdId }).exec();
      if (!ad) {
        throw new NotFoundException('Ad not found');
      }

      // Prevent owner from reporting their own ad
      if (ad.userId === userId) {
        throw new ForbiddenException('You cannot report your own ad');
      }

      // Check if user already reported this ad
      const existingReport = await this.reportModel
        .findOne({ adId: resolvedAdId, reportedBy: userId })
        .exec();
      
      if (existingReport) {
        throw new BadRequestException('You have already reported this ad');
      }

      // Create report
      const report = await this.reportModel.create({
        reportId: uuidv4(),
        adId: resolvedAdId,
        reportedBy: userId,
        reason,
        description: description || '',
        status: ReportStatus.PENDING,
      });

      // Increment report count on ad
      const updatedAd = await this.adModel.findOneAndUpdate(
        { adId: resolvedAdId },
        {
          $inc: { reportCount: 1 },
          $set: { isUnderReview: true },
        },
        { new: true },
      ).exec();

      // Auto-disable if 10 or more reports
      if ((updatedAd?.reportCount ?? 0) >= 10) {
        await this.autoDisableAd(resolvedAdId, `Auto-disabled: ${updatedAd?.reportCount} reports`);
      }

      // Emit Kafka event for notifications
      if (this.kafkaService) {
        await this.kafkaService.emit(KAFKA_TOPICS.AD_REPORT_SUBMITTED, {
          reportId: report.reportId,
          adId: resolvedAdId,
          reportedBy: userId,
          reason,
          reportCount: updatedAd?.reportCount,
          timestamp: new Date().toISOString(),
        });
      }

      // Send email notification to admin
      if (this.emailEnabled && this.emailTransporter) {
        try {
          const adData = await this.adModel.findOne({ adId: resolvedAdId }).select('title').lean().exec();
          const adminEmail = this.configService.get('ADMIN_EMAIL');
          
          if (adminEmail) {
            const mailOptions = {
              from: this.configService.get('EMAIL_FROM'),
              to: adminEmail,
              subject: `🚨 Ad Reported: ${reason.toUpperCase()} (${updatedAd?.reportCount || 1} reports)`,
              html: this.generateReportEmailHTML({
                adId: resolvedAdId,
                adTitle: adData?.title || 'Unknown',
                reason,
                description: description || '',
                reportedBy: userId,
                reportCount: updatedAd?.reportCount || 1,
              }),
            };

            await this.emailTransporter.sendMail(mailOptions);
            this.logger.log(`✅ Email sent to admin: ${adminEmail}`);
          }
        } catch (emailError: any) {
          this.logger.error(`Failed to send report email: ${emailError.message}`);
          // Don't throw - email failure shouldn't break report submission
        }
      }

      return {
        success: true,
        message: 'Report submitted successfully',
        reportId: report.reportId,
      };
    } catch (error: any) {
      this.logger.error(`Error submitting report: ${error.message}`);
      throw error;
    }
  }

  /**
   * Auto-disable ad when it reaches 10 reports
   */
  async autoDisableAd(adId: string, reason: string): Promise<void> {
    try {
      this.logger.warn(`Auto-disabling ad ${adId}: ${reason}`);

      await this.adModel.findOneAndUpdate(
        { adId },
        {
          $set: {
            autoDisabled: true,
            disabledAt: new Date(),
            disabledReason: reason,
            status: 'expired', // Mark as expired so it won't show in listings
          },
        },
      ).exec();

      // Get ad owner to notify
      const ad = await this.adModel.findOne({ adId }).select('userId title').exec();
      
      if (ad && this.kafkaService) {
        await this.kafkaService.emit(KAFKA_TOPICS.AD_AUTO_DISABLED, {
          adId,
          userId: ad.userId,
          adTitle: ad.title,
          reason,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      this.logger.error(`Error auto-disabling ad: ${error.message}`);
    }
  }

  /**
   * Get all reports for a specific ad (admin only)
   */
  async getAdReports(adId: string): Promise<any[]> {
    try {
      this.logger.log(`Fetching reports for ad: ${adId}`);

      const reports = await this.reportModel
        .find({ adId })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      return reports;
    } catch (error: any) {
      this.logger.error(`Error fetching reports: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get pending reports queue (admin only)
   */
  async getPendingReports(): Promise<any[]> {
    try {
      this.logger.log('Fetching pending reports queue');

      const reports = await this.reportModel.aggregate([
        {
          $match: { status: ReportStatus.PENDING },
        },
        {
          $lookup: {
            from: 'ads',
            localField: 'adId',
            foreignField: 'adId',
            as: 'ad',
          },
        },
        {
          $unwind: '$ad',
        },
        {
          $project: {
            reportId: 1,
            adId: 1,
            reportedBy: 1,
            reason: 1,
            description: 1,
            createdAt: 1,
            'ad.title': 1,
            'ad.status': 1,
            'ad.reportCount': 1,
          },
        },
        {
          $sort: { createdAt: -1 },
        },
      ]);

      return reports;
    } catch (error: any) {
      this.logger.error(`Error fetching pending reports: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update report status (admin only)
   */
  async updateReportStatus(
    reportId: string,
    status: ReportStatus,
    adminNotes?: string,
    reviewerId?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`Updating report ${reportId} status to: ${status}`);

      const report = await this.reportModel.findOneAndUpdate(
        { reportId },
        {
          $set: {
            status,
            adminNotes: adminNotes || '',
            reviewedAt: new Date(),
            reviewedBy: reviewerId || '',
          },
        },
        { new: true },
      ).exec();

      if (!report) {
        throw new NotFoundException('Report not found');
      }

      return {
        success: true,
        message: 'Report status updated successfully',
      };
    } catch (error: any) {
      this.logger.error(`Error updating report status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Admin review of flagged ad
   */
  async reviewAd(
    adId: string,
    decision: 'approve' | 'remove' | 'request_changes',
    adminNotes?: string,
    reviewerId?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`Admin reviewing ad ${adId}, decision: ${decision}`);

      // Update ad based on decision
      const updateData: any = {
        isUnderReview: false,
        reviewedBy: reviewerId || '',
        reviewedAt: new Date(),
      };

      if (decision === 'approve') {
        updateData.status = 'active';
        updateData.autoDisabled = false;
        updateData.disabledReason = '';
      } else if (decision === 'remove') {
        updateData.status = 'deleted';
        updateData.rejectionReason = adminNotes || 'Removed by admin after review';
      } else if (decision === 'request_changes') {
        updateData.status = 'pending';
        updateData.rejectionReason = adminNotes || 'Changes requested by admin';
      }

      await this.adModel.findOneAndUpdate({ adId }, { $set: updateData }).exec();

      // Mark all pending reports for this ad as action_taken
      await this.reportModel.updateMany(
        { adId, status: ReportStatus.PENDING },
        {
          $set: {
            status: ReportStatus.ACTION_TAKEN,
            reviewedAt: new Date(),
            reviewedBy: reviewerId || '',
          },
        },
      ).exec();

      return {
        success: true,
        message: `Ad ${decision === 'approve' ? 'approved' : decision.replace('_', ' ')} successfully`,
      };
    } catch (error: any) {
      this.logger.error(`Error reviewing ad: ${error.message}`);
      throw error;
    }
  }

  /**
   * Recalculate report counts for all ads (utility)
   */
  async resyncReportCounts(): Promise<{ updated: number }> {
    try {
      this.logger.log('Resyncing report counts for all ads');

      const result = await this.reportModel.aggregate([
        {
          $group: {
            _id: '$adId',
            count: { $sum: 1 },
          },
        },
      ]);

      let updated = 0;
      for (const item of result) {
        await this.adModel.updateOne(
          { adId: item._id },
          { $set: { reportCount: item.count } },
        ).exec();
        updated++;
      }

      return { updated };
    } catch (error: any) {
      this.logger.error(`Error resyncing report counts: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate HTML email for ad report notification
   */
  private generateReportEmailHTML(data: {
    adId: string;
    adTitle: string;
    reason: string;
    description?: string;
    reportedBy: string;
    reportCount: number;
  }): string {
    const urgencyColor = data.reportCount >= 10 ? '#dc2626' : data.reportCount >= 5 ? '#ea580c' : '#ca8a04';
    const urgencyText = data.reportCount >= 10 ? 'CRITICAL - Auto-Disabled' : data.reportCount >= 5 ? 'High Priority' : 'New Report';

    const emojis: Record<string, string> = {
      spam: '📢',
      inappropriate: '⚠️',
      fraud: '🚫',
      duplicate: '📋',
      other: '📝',
    };

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .urgency-badge { display: inline-block; padding: 6px 12px; border-radius: 20px; color: white; font-weight: bold; font-size: 12px; }
            .report-count { font-size: 32px; font-weight: bold; color: ${urgencyColor}; margin: 20px 0; }
            .detail-row { margin: 15px 0; padding: 15px; background: white; border-left: 4px solid ${urgencyColor}; border-radius: 5px; }
            .label { font-weight: bold; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
            .value { margin-top: 5px; color: #1f2937; }
            .button { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 20px; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 2px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚨 Ad Reported for Review</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">GOLO Content Moderation System</p>
            </div>
            
            <div class="content">
              <div style="text-align: center;">
                <span class="urgency-badge" style="background: ${urgencyColor};">${urgencyText}</span>
                <div class="report-count">${data.reportCount} Report${data.reportCount !== 1 ? 's' : ''}</div>
              </div>

              <div class="detail-row">
                <div class="label">Ad Title</div>
                <div class="value"><strong>${data.adTitle}</strong></div>
                <div class="label" style="margin-top: 10px;">Ad ID</div>
                <div class="value"><code>${data.adId}</code></div>
              </div>

              <div class="detail-row">
                <div class="label">Report Reason</div>
                <div class="value" style="font-size: 18px; color: ${urgencyColor};">
                  ${emojis[data.reason] || '📝'} ${data.reason.charAt(0).toUpperCase() + data.reason.slice(1)}
                </div>
              </div>

              ${data.description ? `
                <div class="detail-row">
                  <div class="label">Reporter's Description</div>
                  <div class="value" style="font-style: italic;">"${data.description}"</div>
                </div>
              ` : ''}

              <div class="detail-row">
                <div class="label">Reported By (User ID)</div>
                <div class="value"><code>${data.reportedBy}</code></div>
              </div>

              <div style="text-align: center;">
                <a href="https://golo-frontend.vercel.app/admin/reports" class="button">
                  Review This Ad →
                </a>
              </div>

              ${data.reportCount >= 10 ? `
                <div style="margin-top: 20px; padding: 15px; background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px;">
                  <strong style="color: #dc2626;">⚠️ AUTO-DISABLED</strong>
                  <p style="margin: 10px 0 0 0; color: #991b1b; font-size: 14px;">
                    This ad has been automatically disabled due to reaching 10 reports. Please review immediately.
                  </p>
                </div>
              ` : ''}

              <div class="footer">
                <p>This is an automated notification from GOLO's content moderation system.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /* ============================================================
     VALIDATION
  ============================================================ */

  private validateCategoryData(category: string, data: any): void {
    if (!data) return;
  }
}