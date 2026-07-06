export class UnbalancedJournalError extends Error {
  constructor(sumMinor: bigint) {
    super(`Journal lines must sum to zero, got ${sumMinor}`);
    this.name = 'UnbalancedJournalError';
  }
}

export class EmptyJournalError extends Error {
  constructor() {
    super('A journal entry requires at least two lines');
    this.name = 'EmptyJournalError';
  }
}

export class ZeroAmountLineError extends Error {
  constructor() {
    super('Journal lines must have non-zero amounts');
    this.name = 'ZeroAmountLineError';
  }
}

export class InsufficientFundsError extends Error {
  constructor(accountId: string) {
    super(`Insufficient funds on account ${accountId}`);
    this.name = 'InsufficientFundsError';
  }
}
