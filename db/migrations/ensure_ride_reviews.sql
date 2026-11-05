-- Apply once before deploying on an installation without ride_reviews.
-- Existing deployed tables are left unchanged. No schema DDL runs in review/profile requests.
CREATE TABLE IF NOT EXISTS ride_reviews (
    Review_ID_Pk INT AUTO_INCREMENT PRIMARY KEY,
    Ride_ID_Fk INT NOT NULL,
    Reviewer_ID_Fk INT NOT NULL,
    Reviewee_ID_Fk INT DEFAULT NULL,
    Reviewer_Role ENUM('User','Driver') NOT NULL,
    Rating TINYINT NOT NULL,
    Feedback_Tags TEXT DEFAULT NULL,
    Comment TEXT DEFAULT NULL,
    CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_review (Ride_ID_Fk, Reviewer_ID_Fk),
    KEY idx_reviewee_role (Reviewee_ID_Fk, Reviewer_Role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
