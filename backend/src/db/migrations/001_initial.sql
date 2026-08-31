-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Accounts (Asset balances)
CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id),
    asset VARCHAR(50) NOT NULL,
    available_units BIGINT NOT NULL DEFAULT 0,
    locked_units BIGINT NOT NULL DEFAULT 0,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT accounts_available_positive CHECK (available_units >= 0),
    CONSTRAINT accounts_locked_positive CHECK (locked_units >= 0),
    UNIQUE (user_id, asset)
);

-- 3. Settlement Events (Idempotency Tracking)
CREATE TABLE IF NOT EXISTS settlement_events (
    event_id VARCHAR(255) PRIMARY KEY,
    exchange_sequence BIGINT NOT NULL, 
    event_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_exchange_sequence UNIQUE (exchange_sequence),
    CONSTRAINT positive_exchange_sequence CHECK (exchange_sequence > 0)
);

-- 4. Trades (Relational read model)
CREATE TABLE IF NOT EXISTS trades (
    trade_id VARCHAR(255) PRIMARY KEY,
    exchange_event_id VARCHAR(255) NOT NULL REFERENCES settlement_events(event_id),
    market VARCHAR(50) NOT NULL,
    buyer_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    price_ticks BIGINT NOT NULL,
    quantity_lots BIGINT NOT NULL,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_trade_event UNIQUE (exchange_event_id)
);

-- 5. Ledger Transactions (Grouping for double-entry)
CREATE TABLE IF NOT EXISTS ledger_transactions (
    id VARCHAR(255) PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL REFERENCES settlement_events(event_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_ledger_tx_event UNIQUE (event_id)
);

-- 6. Ledger Entries (Double-entry accounting lines)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id VARCHAR(255) PRIMARY KEY,
    transaction_id VARCHAR(255) NOT NULL REFERENCES ledger_transactions(id),
    account_id VARCHAR(255) NOT NULL REFERENCES accounts(id),
    asset VARCHAR(50) NOT NULL,
    amount BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ledger_amount_nonzero CHECK (amount != 0)
);

-- Ledger balance enforcement trigger
CREATE OR REPLACE FUNCTION verify_ledger_balance()
RETURNS TRIGGER AS $$
DECLARE
    balance BIGINT;
BEGIN
    SELECT SUM(amount) INTO balance
    FROM ledger_entries
    WHERE transaction_id = NEW.transaction_id AND asset = NEW.asset;
    
    IF balance != 0 THEN
        RAISE EXCEPTION 'Ledger transaction % is unbalanced for asset % (balance: %)', NEW.transaction_id, NEW.asset, balance;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_ledger_balance ON ledger_entries;
CREATE CONSTRAINT TRIGGER enforce_ledger_balance
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_ledger_balance();

-- Block UPDATE and DELETE on ledger_entries for strict immutability
CREATE OR REPLACE FUNCTION block_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entries is append-only. UPDATE and DELETE operations are strictly prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_ledger_update ON ledger_entries;
CREATE TRIGGER prevent_ledger_update
BEFORE UPDATE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION block_ledger_mutation();

DROP TRIGGER IF EXISTS prevent_ledger_delete ON ledger_entries;
CREATE TRIGGER prevent_ledger_delete
BEFORE DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION block_ledger_mutation();
