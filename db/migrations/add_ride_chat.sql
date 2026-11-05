-- Run before deploying chat. Existing ride/user tables are not modified.
CREATE TABLE IF NOT EXISTS ride_chat_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ride_id INT NOT NULL,
    sender_user_id INT NOT NULL,
    sender_role ENUM('customer','driver') NOT NULL,
    client_message_id VARCHAR(64) NOT NULL,
    message_text VARCHAR(1000) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uniq_chat_client_message (ride_id, sender_user_id, client_message_id),
    KEY idx_chat_ride (ride_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reported_Chat (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ride_id INT NOT NULL,
    reporter_user_id INT NOT NULL,
    reporter_role ENUM('customer','driver') NOT NULL,
    reason VARCHAR(1000) NOT NULL,
    transcript JSON NOT NULL,
    review_status ENUM('pending','reviewed','resolved') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uniq_chat_reporter (ride_id, reporter_user_id),
    KEY idx_reported_chat_status (review_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
