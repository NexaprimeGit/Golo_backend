import {
  Controller, Get, Post, Put, Delete, Body, Param, Query,
  UsePipes, ValidationPipe, Logger, HttpCode, HttpStatus, UseGuards
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdsService } from './ads.service';
import { CreateAdDto } from './dto/create-ad.dto';
import { UpdateAdDto } from './dto/update-ad.dto';
import { KAFKA_TOPICS } from '../common/constants/kafka-topics';
import { KafkaService } from '../kafka/kafka.service';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '../users/schemas/user.schema';
import { Optional } from '@nestjs/common';

@Controller('ads')
export class AdsController {
  private readonly logger = new Logger(AdsController.name);

  constructor(
    private readonly adsService: AdsService,
    @Optional() private readonly kafkaService?: KafkaService
  ) { }

  // ==================== PUBLIC ROUTES (No Auth Required) ====================

  /**
   * Get all ads with pagination
   */
  @Get()
  async getAllAds(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('category') category?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string
  ) {
    this.logger.log(`REST: Getting all ads - Page: ${page}, Limit: ${limit}`);

    try {
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      let result;
      if (category) {
        result = await this.adsService.getAdsByCategory(
          category,
          pageNum,
          limitNum,
          sortBy || 'createdAt',
          sortOrder || 'desc'
        );
      } else {
        result = await this.adsService.searchAds('', {}, pageNum, limitNum);
      }

      return {
        success: true,
        data: result.ads,
        pagination: {
          total: result.total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(result.total / limitNum)
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error getting ads: ${error.message}`);

      return {
        success: false,
        message: 'Failed to get ads',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Search ads with filters
   */
  @Get('search')
  async searchAds(
    @Query('q') query: string = '',
    @Query('category') category?: string,
    @Query('location') location?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
  ) {
    this.logger.log(`REST: Searching ads with query: ${query}`);

    try {
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      const filters = {
        category,
        location,
        minPrice: minPrice ? parseInt(minPrice, 10) : undefined,
        maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined
      };

      const result = await this.adsService.searchAds(query, filters, pageNum, limitNum);

      return {
        success: true,
        data: result.ads,
        pagination: {
          total: result.total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(result.total / limitNum)
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error searching ads: ${error.message}`);

      return {
        success: false,
        message: 'Failed to search ads',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get nearby ads by location
   */
  @Get('nearby')
  async getNearbyAds(
    @Query('lat') latitude: string,
    @Query('lng') longitude: string,
    @Query('distance') distance: string = '10000',
    @Query('category') category?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
  ) {
    this.logger.log(`REST: Getting nearby ads at (${latitude}, ${longitude})`);

    try {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const maxDistance = parseInt(distance, 10);
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      const result = await this.adsService.getNearbyAds(
        lat,
        lng,
        maxDistance,
        category,
        pageNum,
        limitNum
      );

      return {
        success: true,
        data: result.ads,
        pagination: {
          total: result.total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(result.total / limitNum)
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error getting nearby ads: ${error.message}`);

      return {
        success: false,
        message: 'Failed to get nearby ads',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get ads by category
   */
  @Get('category/:category')
  async getAdsByCategory(
    @Param('category') category: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string
  ) {
    this.logger.log(`REST: Getting ads by category: ${category}`);

    try {
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      const result = await this.adsService.getAdsByCategory(
        category,
        pageNum,
        limitNum,
        sortBy || 'createdAt',
        sortOrder || 'desc'
      );

      return {
        success: true,
        data: result.ads,
        pagination: {
          total: result.total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(result.total / limitNum)
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error getting ads by category: ${error.message}`);

      return {
        success: false,
        message: 'Failed to get ads by category',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get promoted ads
   */
  @Get('promoted/all')
  async getPromotedAds(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
  ) {
    this.logger.log('REST: Getting promoted ads');

    try {
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      const result = await this.adsService.searchAds('', {}, pageNum, limitNum);

      const promotedAds = result.ads.filter(ad => ad.isPromoted && ad.promotedUntil > new Date());

      return {
        success: true,
        data: promotedAds,
        pagination: {
          total: promotedAds.length,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(promotedAds.length / limitNum)
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error getting promoted ads: ${error.message}`);

      return {
        success: false,
        message: 'Failed to get promoted ads',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get ads statistics
   */
  @Get('stats/overview')
  async getAdsStatistics() {
    this.logger.log('REST: Getting ads statistics');

    try {
      const totalAds = await this.adsService.searchAds('', {}, 1, 1);

      const categories = [
        'Education', 'Matrimonial', 'Vehicle', 'Business', 'Travel',
        'Astrology', 'Property', 'Public Notice', 'Lost & Found',
        'Service', 'Personal', 'Employment', 'Pets', 'Mobiles',
        'Electronics & Home appliances', 'Furniture', 'Other'
      ];

      const categoryStats = await Promise.all(
        categories.map(async (category) => {
          const result = await this.adsService.getAdsByCategory(category, 1, 1);
          return {
            category,
            count: result.total
          };
        })
      );

      return {
        success: true,
        data: {
          totalAds: totalAds.total,
          activeAds: totalAds.total,
          promotedAds: 0,
          categoryDistribution: categoryStats
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error getting statistics: ${error.message}`);

      return {
        success: false,
        message: 'Failed to get statistics',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Health check endpoint
   */
  @Get('health/status')
  healthCheck() {
    return {
      status: 'healthy',
      service: 'ads-microservice',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
  }

  // ==================== USER ROUTES (Any logged-in user) ====================

  /**
   * Create a new ad (Authenticated users only)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async createAd(@Body() createAdDto: CreateAdDto, @CurrentUser() user: any) {
    this.logger.log(`REST: Creating new ad for user: ${user.id}`);

    try {
      // Set userId from token (security - prevents spoofing)
      createAdDto.userId = user.id;
      createAdDto.userType = user.role === UserRole.ADMIN ? 'Admin' : 'Customer';

      const ad = await this.adsService.createAd(createAdDto);

      // Emit event to Kafka
      await this.adsService.emitAdCreated(ad, uuidv4());

      return {
        success: true,
        message: 'Ad created successfully',
        data: ad,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error creating ad: ${error.message}`);

      return {
        success: false,
        message: 'Failed to create ad',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Create ad via Kafka (async) - Authenticated users only
   */
  @Post('async')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  async createAdAsync(@Body() createAdDto: CreateAdDto, @CurrentUser() user: any) {
    this.logger.log(`REST: Sending async ad creation request for user: ${user.id}`);

    // Set userId from token (security)
    createAdDto.userId = user.id;
    createAdDto.userType = user.role === UserRole.ADMIN ? 'Admin' : 'Customer';

    const correlationId = uuidv4();

    try {
      if (!this.kafkaService) {
        return {
          success: false,
          message: 'Kafka is disabled on server',
          timestamp: new Date().toISOString(),
        };
      }

      await this.kafkaService.send(KAFKA_TOPICS.AD_CREATE, createAdDto, correlationId);

      return {
        success: true,
        message: 'Ad creation request submitted successfully',
        correlationId,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error sending async ad creation: ${error.message}`);

      return {
        success: false,
        message: 'Failed to submit ad creation request',
        error: error.message,
        correlationId,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get ads by current user
   */
  @Get('user/me')
  @UseGuards(JwtAuthGuard)
  async getMyAds(
    @CurrentUser() user: any,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
  ) {
    this.logger.log(`REST: Getting ads for current user: ${user.id}`);

    try {
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      const result = await this.adsService.getAdsByUser(user.id, pageNum, limitNum);

      return {
        success: true,
        data: result.ads,
        pagination: {
          total: result.total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(result.total / limitNum)
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error getting user ads: ${error.message}`);

      return {
        success: false,
        message: 'Failed to get your ads',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get ads by specific user (public - anyone can view)
   */
  @Get('user/:userId')
  async getAdsByUser(
    @Param('userId') userId: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
  ) {
    this.logger.log(`REST: Getting ads by user: ${userId}`);

    try {
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      const result = await this.adsService.getAdsByUser(userId, pageNum, limitNum);

      return {
        success: true,
        data: result.ads,
        pagination: {
          total: result.total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(result.total / limitNum)
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error getting ads by user: ${error.message}`);

      return {
        success: false,
        message: 'Failed to get ads by user',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Update ad (Authenticated users only - can only update their own)
   */
  @Put(':adId')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateAd(
    @Param('adId') adId: string,
    @Body() updateData: UpdateAdDto,
    @CurrentUser() user: any
  ) {
    this.logger.log(`REST: Updating ad: ${adId} by user: ${user.id}`);

    try {
      // Users can only update their own ads (handled in service)
      const updatedAd = await this.adsService.updateAd(adId, user.id, updateData);

      // Emit update event
      await this.adsService.emitAdUpdated(updatedAd, uuidv4());

      return {
        success: true,
        message: 'Ad updated successfully',
        data: updatedAd,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error updating ad: ${error.message}`);

      return {
        success: false,
        message: 'Failed to update ad',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Update ad via Kafka (async) - Authenticated users only
   */
  @Put(':adId/async')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  async updateAdAsync(
    @Param('adId') adId: string,
    @Body() updateData: UpdateAdDto,
    @CurrentUser() user: any
  ) {
    this.logger.log(`REST: Sending async update request for ad: ${adId}`);

    const correlationId = uuidv4();

    try {
      if (!this.kafkaService) {
        return {
          success: false,
          message: 'Kafka is disabled on server',
          timestamp: new Date().toISOString(),
        };
      }

      await this.kafkaService.send(KAFKA_TOPICS.AD_UPDATE, {
        adId,
        userId: user.id,
        updateData
      }, correlationId);

      return {
        success: true,
        message: 'Ad update request submitted successfully',
        correlationId,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error sending async update: ${error.message}`);

      return {
        success: false,
        message: 'Failed to submit ad update request',
        error: error.message,
        correlationId,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Delete ad (Authenticated users only - can only delete their own)
   */
  @Delete(':adId')
  @UseGuards(JwtAuthGuard)
  async deleteAd(
    @Param('adId') adId: string,
    @CurrentUser() user: any
  ) {
    this.logger.log(`REST: Deleting ad: ${adId} by user: ${user.id}`);

    try {
      await this.adsService.deleteAd(adId, user.id);

      // Emit delete event
      await this.adsService.emitAdDeleted(adId, user.id, uuidv4());

      return {
        success: true,
        message: 'Ad deleted successfully',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error deleting ad: ${error.message}`);

      return {
        success: false,
        message: 'Failed to delete ad',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // src/ads/ads.controller.ts
@Get('test-kafka')
async testKafka() {
  try {
    const result = await this.kafkaService.emit('test-topic', {
      message: 'Hello from GOLO Backend!',
      timestamp: new Date().toISOString()
    });
    return { success: true, message: 'Kafka message sent', result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

  /**
   * Delete ad via Kafka (async) - Authenticated users only
   */
  @Delete(':adId/async')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  async deleteAdAsync(
    @Param('adId') adId: string,
    @CurrentUser() user: any
  ) {
    this.logger.log(`REST: Sending async delete request for ad: ${adId}`);

    const correlationId = uuidv4();

    try {
      if (!this.kafkaService) {
        return {
          success: false,
          message: 'Kafka is disabled on server',
          timestamp: new Date().toISOString(),
        };
      }

      await this.kafkaService.send(KAFKA_TOPICS.AD_DELETE, {
        adId,
        userId: user.id
      }, correlationId);

      return {
        success: true,
        message: 'Ad delete request submitted successfully',
        correlationId,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error sending async delete: ${error.message}`);

      return {
        success: false,
        message: 'Failed to submit ad delete request',
        error: error.message,
        correlationId,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Promote an ad (Authenticated users only)
   */
  @Post(':adId/promote')
  @UseGuards(JwtAuthGuard)
  async promoteAd(
    @Param('adId') adId: string,
    @Body('package') promotionPackage: string,
    @Body('duration') duration: number,
    @CurrentUser() user: any
  ) {
    this.logger.log(`REST: Promoting ad: ${adId} with package: ${promotionPackage}`);

    try {
      const promotedUntil = new Date();
      promotedUntil.setDate(promotedUntil.getDate() + duration);

      const updateData: UpdateAdDto = {
        isPromoted: true,
        promotedUntil,
        promotionPackage
      };

      const updatedAd = await this.adsService.updateAd(adId, user.id, updateData);

      if (this.kafkaService) {
        await this.kafkaService.emit(KAFKA_TOPICS.AD_PROMOTED, {
        adId,
        userId: user.id,
        promotionPackage,
        promotedUntil,
        timestamp: new Date().toISOString()
        }, uuidv4());
      } else {
        this.logger.warn('Kafka disabled - AD_PROMOTED event not emitted');
      }

      return {
        success: true,
        message: 'Ad promoted successfully',
        data: updatedAd,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error promoting ad: ${error.message}`);

      return {
        success: false,
        message: 'Failed to promote ad',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // ==================== ADMIN ROUTES (Admin only) ====================

  /**
   * Admin: Delete any ad
   */
  @Delete('admin/:adId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminDeleteAd(@Param('adId') adId: string) {
    this.logger.log(`REST: Admin deleting ad: ${adId}`);

    try {
      await this.adsService.adminDeleteAd(adId);

      return {
        success: true,
        message: 'Ad deleted successfully by admin',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error in admin delete: ${error.message}`);

      return {
        success: false,
        message: 'Failed to delete ad',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Admin: Get all ads (including inactive/deleted)
   */
  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminGetAllAds() {
    this.logger.log('REST: Admin getting all ads');

    try {
      const ads = await this.adsService.adminGetAllAds();

      return {
        success: true,
        data: ads,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error in admin get all: ${error.message}`);

      return {
        success: false,
        message: 'Failed to get all ads',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Get('debug/user/:id')
  @UseGuards(JwtAuthGuard)
  async debugCheckUserInAds(@Param('id') id: string) {
    try {
      const exists = await this.adsService.verifyUser(id);
      return {
        success: true,
        data: { exists, userId: id },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Get('debug/user-check/:userId')
  @UseGuards(JwtAuthGuard)
  async debugUserCheck(@Param('userId') userId: string) {
    try {
      const exists = await this.adsService.verifyUser(userId);
      const userModel = (this.adsService as any).userModel;
      const count = await userModel.countDocuments();
      const sample = await userModel.findOne().exec();

      return {
        success: true,
        data: {
          userId,
          exists,
          totalUsersInAdsService: count,
          sampleUser: sample ? { id: sample._id, email: sample.email } : null,
          message: exists ? 'User found in AdsService' : 'User NOT found in AdsService'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Post('debug-create')
  @UseGuards(JwtAuthGuard)
  async debugCreateAd(@Body() createAdDto: CreateAdDto, @CurrentUser() user: any) {
    console.log('🔧 DEBUG CREATE AD CALLED');
    console.log('User from token:', user);
    console.log('DTO before:', JSON.stringify(createAdDto));

    // Set userId from token
    createAdDto.userId = user.id;
    createAdDto.userType = user.role === 'admin' ? 'Admin' : 'Customer';

    console.log('DTO after:', JSON.stringify(createAdDto));

    try {
      const ad = await this.adsService.createAd(createAdDto);
      return {
        success: true,
        message: 'Ad created successfully',
        data: ad,
      };
    } catch (error) {
      console.error('❌ Debug create error:', error);
      return {
        success: false,
        message: 'Failed to create ad',
        error: error.message,
      };
    }
  }

  @Get('home/featured')
  async getFeaturedDeals(@Query('limit') limit: string = '10') {
    this.logger.log('Fetching featured deals for home screen');
    try {
      const limitNum = parseInt(limit, 10);
      const deals = await this.adsService.getFeaturedDeals(limitNum);
      return { success: true, data: deals };
    } catch (error) {
      this.logger.error(`Error fetching featured deals: ${error.message}`);
      return { success: false, message: 'Failed to fetch featured deals' };
    }
  }

  @Get('home/trending')
  async getTrendingSearches(@Query('limit') limit: string = '10') {
    this.logger.log('Fetching trending searches');
    try {
      const limitNum = parseInt(limit, 10);
      const trending = await this.adsService.getTrendingSearches(limitNum);
      return { success: true, data: trending };
    } catch (error) {
      this.logger.error(`Error fetching trending searches: ${error.message}`);
      return { success: false, message: 'Failed to fetch trending searches' };
    }
  }

  @Get('home/recommended')
  async getRecommendedDeals(@CurrentUser() user: any, @Query('limit') limit: string = '10') {
    this.logger.log('Fetching recommended deals');
    try {
      const limitNum = parseInt(limit, 10);
      const userId = user?.id;
      const deals = await this.adsService.getRecommendedDeals(userId, limitNum);
      return { success: true, data: deals };
    } catch (error) {
      this.logger.error(`Error fetching recommended deals: ${error.message}`);
      return { success: false, message: 'Failed to fetch recommended deals' };
    }
  }

  @Get('home/popular-places')
  async getPopularPlaces(@Query('limit') limit: string = '10') {
    this.logger.log('Fetching popular places');
    try {
      const limitNum = parseInt(limit, 10);
      const places = await this.adsService.getPopularPlaces(limitNum);
      return { success: true, data: places };
    } catch (error) {
      this.logger.error(`Error fetching popular places: ${error.message}`);
      return { success: false, message: 'Failed to fetch popular places' };
    }
  }

  @Get('ad-details/:adId')
  async getAdDetails(@Param('adId') adId: string) {
    this.logger.log(`Fetching ad details for: ${adId}`);
    try {
      const ad = await this.adsService.getAdById(adId);

      // Increment view count
      await this.adsService.incrementViewCount(adId).catch(e =>
        this.logger.error(`Error incrementing views: ${e.message}`)
      );

      return { success: true, data: ad };
    } catch (error) {
      this.logger.error(`Error fetching ad details: ${error.message}`);
      return { success: false, message: 'Ad not found' };
    }
  }

  /**
   * Keep this dynamic GET route near the bottom so static routes always win.
   */
  @Get(':adId')
  async getAdById(@Param('adId') adId: string) {
    this.logger.log(`REST: Getting ad by ID: ${adId}`);

    try {
      const ad = await this.adsService.getAdById(adId);

      // Increment view count asynchronously
      this.adsService.incrementViewCount(adId).catch(error => {
        this.logger.error(`Error incrementing view count: ${error.message}`);
      });

      return {
        success: true,
        data: ad,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`REST: Error getting ad: ${error.message}`);

      return {
        success: false,
        message: 'Failed to get ad',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

}
