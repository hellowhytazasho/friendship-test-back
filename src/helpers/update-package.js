const config = require('config');
const { CronJob } = require('cron');

const { getPackageHistory } = require('../services/get-package-history.service');
const { Package } = require('../model/package');
const { updateDeliveryStatus } = require('./change-delivered-status');
const sendNotification = require('./notification');

const logger = require('../logger')('update');

const TWO_DAYS = 172800000;

const {
  timeOut: TIME_OUT,
  batchSize: BATCH_SIZE,
} = config.throttle;

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

const throttle = async ({
  elements = [],
  batchSize = BATCH_SIZE,
  timeOut = TIME_OUT,
  fn,
}) => {
  const elems = [...elements];
  logger.info('Batch size', { batchSize });

  while (elems.length) {
    const slicedElements = elems.splice(0, batchSize);
    logger.info('Sliced elements count', slicedElements.length);

    /* eslint-disable no-await-in-loop */
    await Promise.allSettled(slicedElements.map((item) => fn(item)));

    if (elems.length) {
      logger.info('wait', { timeOut });
      await wait(timeOut);
    }
    /* eslint-enable no-await-in-loop */
  }
};

const updatePackageHistory = async ({ packageNumber }) => {
  const ph = await getPackageHistory(packageNumber);

  await Package.updateOne({
    packageNumber,
    deliveredStatus: 0, // not delivered
  }, {
    $set: {
      ...ph,
      lastUpdate: new Date(),
    },
  });
};

async function updateHistoryData() {
  const data = await Package.find({
    deliveredStatus: 0,
    lastUpdate: {
      $lt: new Date(Date.now() - TWO_DAYS),
    },
  });
  logger.info('Data for update', data.length);

  await throttle({
    elements: data,
    timeOut: 3500,
    fn: updatePackageHistory,
  });
  updateDeliveryStatus();
  sendNotification(data);
  logger.info('Throttle done');
}

const job = new CronJob('0 0 20 * * *', () => {
  updateHistoryData();
  logger.info('Update started');
});

job.start();

module.exports = {
  updateHistoryData,
};
