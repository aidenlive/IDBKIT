/**
 * Example: Transaction workflows
 * ------------------------------
 * Atomic, multi-store operations with automatic rollback. Money transfer is the
 * classic case: debit one account, credit another, and append a ledger entry —
 * all or nothing. If any step fails (insufficient funds, missing account), the
 * whole transaction aborts and no partial state is written.
 */
import {
  openDatabase,
  uuid,
  type Database,
  type Schema,
} from 'idbkit';

export interface Account {
  id: string;
  owner: string;
  balance: number;
}

export interface LedgerEntry {
  id: string;
  from: string;
  to: string;
  amount: number;
  at: number;
}

interface BankDB extends Schema {
  accounts: { key: string; value: Account };
  ledger: {
    key: string;
    value: LedgerEntry;
    indexes: { byAt: number };
  };
}

export class InsufficientFundsError extends Error {
  constructor(accountId: string) {
    super(`Insufficient funds in account ${accountId}`);
    this.name = 'InsufficientFundsError';
  }
}

export async function openBankDB(name = 'example-bank'): Promise<Database<BankDB>> {
  return openDatabase<BankDB>({
    name,
    version: 1,
    stores: {
      accounts: { keyPath: 'id' },
      ledger: { keyPath: 'id', indexes: { byAt: { keyPath: 'at' } } },
    },
  });
}

export function openAccount(db: Database<BankDB>, owner: string, balance = 0): Promise<string> {
  const id = uuid();
  return db
    .store('accounts')
    .add({ id, owner, balance })
    .then(() => id);
}

/**
 * Transfer `amount` from one account to another atomically.
 *
 * The whole operation runs in a single readwrite transaction spanning both
 * stores. Throwing inside the callback (e.g. on insufficient funds) aborts the
 * transaction, so balances and the ledger are never left inconsistent.
 */
export async function transfer(
  db: Database<BankDB>,
  fromId: string,
  toId: string,
  amount: number,
): Promise<LedgerEntry> {
  if (amount <= 0) throw new Error('Transfer amount must be positive');

  return db.transaction(['accounts', 'ledger'], 'readwrite', async (tx) => {
    const accounts = tx.store('accounts');

    const from = await accounts.get(fromId);
    const to = await accounts.get(toId);
    if (!from) throw new Error(`Account not found: ${fromId}`);
    if (!to) throw new Error(`Account not found: ${toId}`);
    if (from.balance < amount) throw new InsufficientFundsError(fromId);

    await accounts.put({ ...from, balance: from.balance - amount });
    await accounts.put({ ...to, balance: to.balance + amount });

    const entry: LedgerEntry = {
      id: uuid(),
      from: fromId,
      to: toId,
      amount,
      at: Date.now(),
    };
    await tx.store('ledger').add(entry);
    return entry;
  });
}

export function getBalance(db: Database<BankDB>, id: string): Promise<number | undefined> {
  return db.store('accounts').get(id).then((a) => a?.balance);
}

export function history(db: Database<BankDB>, limit = 20): Promise<LedgerEntry[]> {
  return db.store('ledger').query().index('byAt').reverse().limit(limit).toArray();
}

// Demo when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const run = async () => {
    const db = await openBankDB(`example-bank-${uuid()}`);
    const alice = await openAccount(db, 'Alice', 100);
    const bob = await openAccount(db, 'Bob', 0);

    await transfer(db, alice, bob, 30);
    console.log('After transfer → Alice:', await getBalance(db, alice), 'Bob:', await getBalance(db, bob));

    // This one fails and rolls back; balances are untouched.
    try {
      await transfer(db, alice, bob, 1_000);
    } catch (e) {
      console.log('Rejected:', (e as Error).message);
    }
    console.log('After failed transfer → Alice:', await getBalance(db, alice), 'Bob:', await getBalance(db, bob));

    console.log('Ledger:', (await history(db)).map((e) => `${e.amount} ${e.from.slice(0, 4)}→${e.to.slice(0, 4)}`));

    await db.delete();
  };
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
