/** Environment for the test run.
 *
 *  Set before any module is imported, because the configuration is resolved
 *  once at import time and a missing value stops the process.
 */
process.env['DATABASE_URL'] = 'postgres://localhost:5432/trekkapp_test';
process.env['JWT_SECRET'] = 'test-secret-long-enough-for-hs256-signing';
process.env['PORT'] = '0';
