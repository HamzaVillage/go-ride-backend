ALTER TABLE city_to_city_services
ADD COLUMN IF NOT EXISTS minimum_required_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00
AFTER minimum_topup_amount;
