/**
 * Domain event catalogue. Every cross-module side effect flows through
 * one of these topics via the transactional outbox. Consumers must be
 * idempotent (at-least-once delivery); dedupe on `eventId`.
 */

export const EventTopics = {
  ContestPublished: 'contest.published',
  ContestLocked: 'contest.locked',
  ContestCancelled: 'contest.cancelled',
  ContestScored: 'contest.scored',
  EntryPaid: 'entry.paid',
  MatchResultFinalized: 'match.result.finalized',
  PredictionScored: 'prediction.scored',
  PrizesDistributed: 'prizes.distributed',
  WalletCredited: 'wallet.credited',
  WalletDebited: 'wallet.debited',
  WithdrawalRequested: 'withdrawal.requested',
  WithdrawalApproved: 'withdrawal.approved',
  WithdrawalPaid: 'withdrawal.paid',
  WithdrawalFailed: 'withdrawal.failed',
  PaymentWebhookReceived: 'payment.webhook.received',
  UserRegistered: 'user.registered',
  FixtureSynced: 'fixture.synced',
} as const;

export type EventTopic = (typeof EventTopics)[keyof typeof EventTopics];

export interface DomainEventEnvelope<T = unknown> {
  eventId: string; // uuid, dedupe key
  topic: EventTopic;
  occurredAt: string; // ISO-8601
  payload: T;
}
