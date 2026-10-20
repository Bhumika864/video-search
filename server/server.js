require('dotenv').config();

const mongoose = require('mongoose');
const app = require('./app');
const { port } = require('./config');
const { getTokenSecret } = require('./services/auth');
const BackgroundJob = require('./models/BackgroundJob');
const { recoverJobs, startWorker, stop } = require('./workers/jobWorker');

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured.');
  getTokenSecret();
  await mongoose.connect(process.env.MONGODB_URI);
  await BackgroundJob.init();
  await recoverJobs();

  const httpServer = app.listen(port, () => {
    console.log(`JumpToThis API listening on port ${port}`);
  });
  const workerPromise = startWorker();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stop();
    const closeHttpServer = new Promise((resolve) => httpServer.close(resolve));
    await workerPromise;
    await closeHttpServer;
    await mongoose.disconnect();
  };
  process.once('SIGINT', () => shutdown().catch((error) => {
    console.error('Could not shut down cleanly:', error);
    process.exitCode = 1;
  }));
  process.once('SIGTERM', () => shutdown().catch((error) => {
    console.error('Could not shut down cleanly:', error);
    process.exitCode = 1;
  }));
}

start().catch((error) => {
  console.error('Could not start JumpToThis API:', error);
  process.exitCode = 1;
});
