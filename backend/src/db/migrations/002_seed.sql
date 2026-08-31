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
