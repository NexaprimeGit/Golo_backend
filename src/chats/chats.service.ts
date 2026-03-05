import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';
import { StartConversationDto } from './dto/start-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ListMessagesDto } from './dto/list-messages.dto';
import { Ad, AdDocument } from '../ads/schemas/category-schemas/ad.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    @InjectModel(Conversation.name) private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(Ad.name) private adModel: Model<AdDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  private toConversationId(id: any): string {
    return id instanceof Types.ObjectId ? id.toString() : String(id);
  }

  private getParticipantKey(userA: string, userB: string): string {
    return [String(userA), String(userB)].sort().join('|');
  }

  private async findAdByAnyId(adId: string) {
    if (!adId) return null;
    return this.adModel
      .findOne({
        $or: [{ adId }, { _id: Types.ObjectId.isValid(adId) ? adId : null }],
      })
      .exec();
  }

  async startConversation(currentUserId: string, dto: StartConversationDto) {
    const ad = await this.findAdByAnyId(dto.adId);

    if (!ad) {
      throw new NotFoundException('Ad not found');
    }

    const sellerId = dto.sellerId || ad.userId;

    if (!sellerId) {
      throw new BadRequestException('Seller ID not found for this ad');
    }

    if (String(currentUserId) === String(sellerId)) {
      throw new BadRequestException('You cannot chat with yourself on your own ad');
    }

    const participantKey = this.getParticipantKey(currentUserId, sellerId);

    let conversation = await this.conversationModel
      .findOne({ participantKey })
      .exec();

    if (!conversation) {
      conversation = await this.conversationModel.create({
        adId: ad.adId || this.toConversationId(ad._id),
        adTitle: ad.title,
        participants: [String(currentUserId), String(sellerId)],
        participantKey,
        lastMessageAt: new Date(),
        messagesCount: 0,
      });
    } else {
      conversation.adId = ad.adId || this.toConversationId(ad._id);
      conversation.adTitle = ad.title;
      await conversation.save();
    }

    return this.enrichConversationForUser(conversation, currentUserId, ad);
  }

  async listConversations(userId: string) {
    const conversations = await this.conversationModel
      .find({ participants: String(userId) })
      .sort({ lastMessageAt: -1 })
      .limit(100)
      .exec();

    const adIds = [...new Set(conversations.map((c) => c.adId).filter(Boolean))];
    const ads = adIds.length
      ? await this.adModel.find({ adId: { $in: adIds } }).exec()
      : [];

    const adMap = new Map(ads.map((ad) => [ad.adId, ad]));

    const otherUserIds = new Set<string>();
    conversations.forEach((conversation) => {
      const otherUserId = conversation.participants.find((id) => id !== String(userId));
      if (otherUserId) otherUserIds.add(otherUserId);
    });

    const users = otherUserIds.size
      ? await this.userModel.find({ _id: { $in: [...otherUserIds] } }).exec()
      : [];
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    return conversations.map((conversation) => {
      const otherUserId = conversation.participants.find((id) => id !== String(userId));
      const otherUser = otherUserId ? userMap.get(otherUserId) : null;
      const ad = adMap.get(conversation.adId) || null;

      return {
        id: this.toConversationId(conversation._id),
        adId: conversation.adId,
        adTitle: conversation.adTitle || ad?.title || null,
        participants: conversation.participants,
        otherUser: otherUser
          ? {
              id: String(otherUser._id),
              name: otherUser.name,
              email: otherUser.email,
              avatar: otherUser.profile?.avatar || null,
            }
          : null,
        ad: ad
          ? {
              id: ad.adId || this.toConversationId(ad._id),
              title: ad.title,
              image: ad.images?.[0] || null,
              price: ad.price,
              location: ad.location,
            }
          : null,
        lastMessageText: conversation.lastMessageText || '',
        lastMessageAdId: conversation.lastMessageAdId || conversation.adId || null,
        lastMessageAdTitle: conversation.lastMessageAdTitle || conversation.adTitle || ad?.title || null,
        lastMessageAt: conversation.lastMessageAt,
        messagesCount: conversation.messagesCount || 0,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      };
    });
  }

  async listMessages(userId: string, conversationId: string, query: ListMessagesDto) {
    const conversation = await this.getConversationForUser(userId, conversationId);

    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      this.messageModel
        .find({ conversationId: this.toConversationId(conversation._id) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.messageModel.countDocuments({ conversationId: this.toConversationId(conversation._id) }),
    ]);

    const senderIds = [...new Set(messages.map((message) => message.senderId))];
    const senders = senderIds.length
      ? await this.userModel.find({ _id: { $in: senderIds } }).exec()
      : [];
    const senderMap = new Map(senders.map((sender) => [String(sender._id), sender]));

    return {
      conversationId: this.toConversationId(conversation._id),
      items: messages
        .reverse()
        .map((message) => ({
          id: this.toConversationId(message._id),
          conversationId: message.conversationId,
          adId: message.adId,
          adTitle: message.adTitle || null,
          adImage: message.adImage || null,
          adPrice: message.adPrice ?? null,
          adLocation: message.adLocation || null,
          senderId: message.senderId,
          sender: senderMap.get(message.senderId)
            ? {
                id: message.senderId,
                name: senderMap.get(message.senderId)?.name,
                avatar: senderMap.get(message.senderId)?.profile?.avatar || null,
              }
            : null,
          text: message.text,
          attachments: message.attachments || [],
          readBy: message.readBy || [],
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async sendMessage(userId: string, conversationId: string, dto: SendMessageDto) {
    const conversation = await this.getConversationForUser(userId, conversationId);

    const text = dto.text?.trim();
    const attachments = Array.isArray(dto.attachments)
      ? dto.attachments
          .filter((attachment) => attachment?.url && attachment?.name && attachment?.mimeType)
          .map((attachment) => ({
            name: attachment.name,
            mimeType: attachment.mimeType,
            url: attachment.url,
            type: attachment.type || (attachment.mimeType.startsWith('image/') ? 'image' : 'file'),
            size: attachment.size,
          }))
      : [];

    if (!text && attachments.length === 0) {
      throw new BadRequestException('Message text or attachment is required');
    }

    const adContextId = dto.adId || conversation.adId;
    const adContext = adContextId ? await this.findAdByAnyId(adContextId) : null;
    const resolvedAdId = adContext ? adContext.adId || this.toConversationId(adContext._id) : conversation.adId;
    const resolvedAdTitle = adContext?.title || conversation.adTitle || null;

    const message = await this.messageModel.create({
      conversationId: this.toConversationId(conversation._id),
      adId: resolvedAdId,
      adTitle: resolvedAdTitle,
      adImage: adContext?.images?.[0] || null,
      adPrice: adContext?.price ?? null,
      adLocation: adContext?.location || null,
      senderId: String(userId),
      text: text || '',
      attachments,
      readBy: [String(userId)],
    });

    conversation.adId = resolvedAdId;
    conversation.adTitle = resolvedAdTitle;
    conversation.lastMessageText = text || (attachments.length ? '📎 Attachment' : '');
    conversation.lastMessageAdId = resolvedAdId;
    conversation.lastMessageAdTitle = resolvedAdTitle;
    conversation.lastMessageAt = new Date();
    conversation.messagesCount = (conversation.messagesCount || 0) + 1;
    await conversation.save();

    const sender = await this.userModel.findById(userId).exec();

    return {
      id: this.toConversationId(message._id),
      conversationId: message.conversationId,
      adId: message.adId,
      adTitle: message.adTitle || null,
      adImage: message.adImage || null,
      adPrice: message.adPrice ?? null,
      adLocation: message.adLocation || null,
      senderId: message.senderId,
      sender: sender
        ? {
            id: String(sender._id),
            name: sender.name,
            avatar: sender.profile?.avatar || null,
          }
        : null,
      text: message.text,
      attachments: message.attachments || [],
      readBy: message.readBy || [],
      participants: conversation.participants,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  async markConversationAsRead(userId: string, conversationId: string) {
    const conversation = await this.getConversationForUser(userId, conversationId);

    const unreadMessages = await this.messageModel
      .find({
        conversationId: this.toConversationId(conversation._id),
        senderId: { $ne: String(userId) },
        readBy: { $ne: String(userId) },
      })
      .select('_id')
      .exec();

    if (unreadMessages.length === 0) {
      return {
        conversation,
        messageIds: [] as string[],
      };
    }

    const ids = unreadMessages.map((message) => message._id);

    await this.messageModel
      .updateMany(
        { _id: { $in: ids } },
        {
          $addToSet: { readBy: String(userId) },
        },
      )
      .exec();

    return {
      conversation,
      messageIds: ids.map((id) => this.toConversationId(id)),
    };
  }

  async getConversationPresenceForUser(userId: string, conversationId: string) {
    const conversation = await this.getConversationForUser(userId, conversationId);
    const otherUserId = conversation.participants.find((id) => id !== String(userId)) || null;
    return {
      conversation,
      otherUserId,
      participants: conversation.participants,
    };
  }

  async getConversationForUser(userId: string, conversationId: string) {
    const conversation = await this.conversationModel.findById(conversationId).exec();

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (!conversation.participants.includes(String(userId))) {
      throw new BadRequestException('You are not part of this conversation');
    }

    return conversation;
  }

  async deleteConversation(userId: string, conversationId: string) {
    const conversation = await this.getConversationForUser(userId, conversationId);

    await Promise.all([
      this.messageModel.deleteMany({ conversationId: this.toConversationId(conversation._id) }).exec(),
      this.conversationModel.deleteOne({ _id: conversation._id }).exec(),
    ]);

    this.logger.log(`Conversation ${conversationId} deleted by user ${userId}`);
  }

  private async enrichConversationForUser(
    conversation: ConversationDocument,
    currentUserId: string,
    adPrefetched?: AdDocument | null,
  ) {
    const otherUserId = conversation.participants.find((id) => id !== String(currentUserId));
    const [otherUser, ad] = await Promise.all([
      otherUserId ? this.userModel.findById(otherUserId).exec() : null,
      adPrefetched ? Promise.resolve(adPrefetched) : this.adModel.findOne({ adId: conversation.adId }).exec(),
    ]);

    return {
      id: this.toConversationId(conversation._id),
      adId: conversation.adId,
      adTitle: conversation.adTitle || ad?.title || null,
      participants: conversation.participants,
      otherUser: otherUser
        ? {
            id: String(otherUser._id),
            name: otherUser.name,
            email: otherUser.email,
            avatar: otherUser.profile?.avatar || null,
          }
        : null,
      ad: ad
        ? {
            id: ad.adId || this.toConversationId(ad._id),
            title: ad.title,
            image: ad.images?.[0] || null,
            price: ad.price,
            location: ad.location,
          }
        : null,
      lastMessageText: conversation.lastMessageText || '',
      lastMessageAdId: conversation.lastMessageAdId || conversation.adId || null,
      lastMessageAdTitle: conversation.lastMessageAdTitle || conversation.adTitle || ad?.title || null,
      lastMessageAt: conversation.lastMessageAt,
      messagesCount: conversation.messagesCount || 0,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }
}
