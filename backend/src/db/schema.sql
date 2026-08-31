-- Exchange Settlement Ledger Schema

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Accounts (Asset balances)
-- Models both available and locked balances.
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
-- Tracks the deterministic exchange events that have been settled.
CREATE TABLE IF NOT EXISTS settlement_events (
    event_id VARCHAR(255) PRIMARY KEY, -- UNIQUE(event_id)
    exchange_sequence BIGINT NOT NULL, 
    event_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_exchange_sequence UNIQUE (exchange_sequence),
    CONSTRAINT positive_exchange_sequence CHECK (exchange_sequence > 0)
);

-- 4. Trades (Relational read model)
-- Represents filled trades between users.
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
    amount BIGINT NOT NULL, -- Negative for debits, positive for credits
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
AFTER INSERT OR UPDATE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_ledger_balance();

-- Insert the 'exchange' user (which holds fee accounts)
INSERT INTO users (id) VALUES ('exchange') ON CONFLICT DO NOTHING;
INSERT INTO accounts (id, user_id, asset, available_units) VALUES 
('exchange_USDC', 'exchange', 'USDC', 0),
('exchange_ETH', 'exchange', 'ETH', 0)
ON CONFLICT DO NOTHING;

-- Insert test users
INSERT INTO users (id) VALUES ('u1'), ('u2'), ('mm_user') ON CONFLICT DO NOTHING;

-- Initial test funding (all balances in 8-decimal integer units)
-- u1 gets 100k USDC, 100 ETH
-- u2 gets 100k USDC, 100 ETH
-- mm_user gets 1m USDC, 10k ETH
INSERT INTO accounts (id, user_id, asset, available_units) VALUES 
('u1_USDC', 'u1', 'USDC', 10000000000000),
('u1_ETH', 'u1', 'ETH', 10000000000),
('u2_USDC', 'u2', 'USDC', 10000000000000),
('u2_ETH', 'u2', 'ETH', 10000000000),
('mm_USDC', 'mm_user', 'USDC', 100000000000000),
('mm_ETH', 'mm_user', 'ETH', 1000000000000)
ON CONFLICT DO NOTHING;
