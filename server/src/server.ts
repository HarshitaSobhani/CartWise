import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

createApp().listen(config.PORT, () => logger.info(`CartWise API listening on :${config.PORT}`));
