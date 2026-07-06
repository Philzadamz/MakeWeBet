import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  MessageBody,
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type Redis from 'ioredis';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { LIVE_CHANNEL, type LiveEvent } from './live-publisher.service';

/**
 * Public live feed: clients join per-contest rooms and receive leaderboard,
 * prize-pool and status ticks. Read-only fan-out of already-public data, so
 * connections are unauthenticated by design.
 *
 * Scale note: with multiple gateway pods behind one LB, add
 * @socket.io/redis-adapter; the worker→Redis→gateway bridge already works
 * for N pods since every pod subscribes to the channel.
 */
@Injectable()
@WebSocketGateway({ namespace: '/live', cors: { origin: true } })
export class LiveGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(LiveGateway.name);
  private subscriber?: Redis;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onModuleInit(): void {
    // Subscribing hijacks a connection; use a dedicated duplicate.
    this.subscriber = this.redis.duplicate();
    void this.subscriber.subscribe(LIVE_CHANNEL);
    this.subscriber.on('message', (_channel, raw) => {
      try {
        const event = JSON.parse(raw) as LiveEvent;
        this.server.to(`contest:${event.contestId}`).emit(event.type, {
          contestId: event.contestId,
          slug: event.slug,
          ...event.payload,
        });
      } catch (err) {
        this.logger.warn(`bad live event: ${String(err)}`);
      }
    });
  }

  @SubscribeMessage('join')
  join(@ConnectedSocket() socket: Socket, @MessageBody() body: { contestId?: string }): void {
    if (typeof body?.contestId === 'string' && body.contestId.length <= 64) {
      void socket.join(`contest:${body.contestId}`);
    }
  }

  @SubscribeMessage('leave')
  leave(@ConnectedSocket() socket: Socket, @MessageBody() body: { contestId?: string }): void {
    if (typeof body?.contestId === 'string') void socket.leave(`contest:${body.contestId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
  }
}
