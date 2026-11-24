process.env.DATABASE_URL ??= "postgres://qrious:qrious_dev_password@localhost:5432/qrious_test";
process.env.QRIOUS_RECOVERY_PEPPER ??= "test-pepper-0123456789";
process.env.QRIOUS_IP_SALT ??= "test-salt";
process.env.QRIOUS_DISABLE_RATE_LIMIT ??= "1";
process.env.QRIOUS_STORAGE ??= "memory";
process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";
