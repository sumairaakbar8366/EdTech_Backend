// Imported first by every CLI script: a one-off command must not start queue workers or
// scheduled jobs. Runs before AppModule is evaluated (ConfigModule never overrides a set variable).
process.env.JOBS_ENABLED = 'false';
