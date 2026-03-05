import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true, collection: 'messages' })
export class Message {
  @Prop({ required: true, index: true })
  conversationId: string;

  @Prop({ required: true })
  adId: string;

  @Prop()
  adTitle?: string;

  @Prop()
  adImage?: string;

  @Prop()
  adPrice?: number;

  @Prop()
  adLocation?: string;

  @Prop({ required: true })
  senderId: string;

  @Prop({ required: true })
  text: string;

  @Prop({ type: [String], default: [] })
  readBy: string[];

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index({ adId: 1, createdAt: -1 });
